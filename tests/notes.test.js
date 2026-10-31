import { test } from "node:test";
import assert from "node:assert/strict";
import { base, hidden, render, linkTarget, resolve } from "../mods/herdsidian/notes.js";

test("base drops the folder and .md", () => {
  assert.equal(base("03-Knowledge/Git.md"), "Git");
  assert.equal(base("Note.MD"), "Note");
  assert.equal(base("plain"), "plain");
});

test("hidden spots folders the panel never shows", () => {
  assert.equal(hidden("/v", "/v/.obsidian/workspace.json"), true);
  assert.equal(hidden("/v", "/v/a/.git/index"), true);
  assert.equal(hidden("/v", "/v/notes/today.md"), false);
});

test("render keeps plain Markdown as it is", () => {
  assert.equal(render("# Title\n\nText"), "# Title\n\nText");
});

test("render turns frontmatter into a yaml block", () => {
  assert.equal(render("---\ntags: [a]\n---\n# T\n"), "```yaml\ntags: [a]\n```\n\n# T\n");
});

test("render turns wikilinks into note: links", () => {
  assert.equal(render("[[Git]]"), "[Git](note:Git)");
  assert.equal(render("[[Git|the git note]]"), "[the git note](note:Git)");
  assert.equal(render("[[Git#Rebase]]"), "[Git#Rebase](note:Git)");
  assert.equal(render("[[My Note]]"), "[My Note](note:My%20Note)");
});

test("render embeds a note as a link and other files by name", () => {
  assert.equal(render("![[Git]]"), "[Git](note:Git)");
  assert.equal(render("![[shot.png]]"), "`shot.png`");
});

test("linkTarget decodes and drops the heading", () => {
  assert.equal(linkTarget("note:My%20Note"), "My Note");
  assert.equal(linkTarget("note:Git#Rebase"), "Git");
  assert.equal(linkTarget("note:100%"), "100%");
  assert.equal(linkTarget("#top"), "");
});

const all = ["Home.md", "a/Git.md", "b/Git.md", "b/sub/Deep.md", "Projects/Herdr.md"];

test("resolve prefers the linking note's folder", () => {
  assert.equal(resolve(all, "b/Index.md", "Git"), "b/Git.md");
  assert.equal(resolve(all, "a/Index.md", "Git"), "a/Git.md");
});

test("resolve finds a note by path or by name anywhere", () => {
  assert.equal(resolve(all, "Home.md", "Projects/Herdr"), "Projects/Herdr.md");
  assert.equal(resolve(all, "Home.md", "deep"), "b/sub/Deep.md");
  assert.equal(resolve(all, "a/Git.md", "home.md"), "Home.md");
});

test("resolve returns null for a missing note", () => {
  assert.equal(resolve(all, "Home.md", "Nope"), null);
});

test("hidden spots nested ignored folders", () => {
  assert.equal(hidden("/v", "/v/a/node_modules/x/readme.md"), true);
});

test("render reads CRLF frontmatter and leaves an unclosed one alone", () => {
  assert.equal(render("---\r\ntags: [a]\r\n---\r\n# T"), "```yaml\ntags: [a]\n```\n\n# T");
  assert.equal(render("---\nno end"), "---\nno end");
});

test("render treats an embedded .md as a note and keeps an embed's alias", () => {
  assert.equal(render("![[a.md]]"), "[a.md](note:a.md)");
  assert.equal(render("![[Git|see git]]"), "[see git](note:Git)");
});

test("linkTarget handles an empty link and an encoded #", () => {
  assert.equal(linkTarget("note:"), "");
  assert.equal(linkTarget("note:a%23b"), "a");
});

test("resolve ignores case, follows a partial path and works from the root", () => {
  assert.equal(resolve(all, "b/Index.md", "git.md"), "b/Git.md");
  assert.equal(resolve(all, "Home.md", "sub/Deep"), "b/sub/Deep.md");
  assert.equal(resolve(all, "Root.md", "Home"), "Home.md");
  assert.equal(resolve([], "Home.md", "Home"), null);
});
