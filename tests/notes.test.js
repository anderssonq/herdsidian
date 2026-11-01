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

test("render leaves wikilinks inside fenced blocks as written", () => {
  assert.equal(render("[[A]]\n```js\n[[B]]\n```\n[[C]]"), "[A](note:A)\n```js\n[[B]]\n```\n[C](note:C)");
  assert.equal(render("~~~\n[[B]]\n~~~\n[[C]]"), "~~~\n[[B]]\n~~~\n[C](note:C)");
  assert.equal(render("````\n```\n[[B]]\n````\n[[C]]"), "````\n```\n[[B]]\n````\n[C](note:C)");
  assert.equal(render("```\n[[B]]\n[[C]]"), "```\n[[B]]\n[[C]]");
});

test("render reads a line starting with an inline code span as prose, not a fence", () => {
  assert.equal(render("```npm i``` first.\nSee [[Setup]]\n"), "```npm i``` first.\nSee [Setup](note:Setup)\n");
  // The first line is a span, so the lone ``` after [[B]] is what opens a fence.
  assert.equal(render("``` `x`\n[[B]]\n```\n[[C]]"), "``` `x`\n[B](note:B)\n```\n[[C]]");
});

test("render does not close a fence with a line that mixes backticks and tildes", () => {
  assert.equal(render("```\n[[B]]\n```~~\n[[C]]\n```\n[[D]]"), "```\n[[B]]\n```~~\n[[C]]\n```\n[D](note:D)");
});

test("render leaves a wikilink alone when a code span cuts it", () => {
  assert.equal(render("[[Note|alias `c` x]] [[K]]"), "[[Note|alias `c` x]] [K](note:K)");
});

test("render leaves wikilinks inside inline code as written", () => {
  assert.equal(render("`[[B]]` [[C]]"), "`[[B]]` [C](note:C)");
  assert.equal(render("``[[B]] ` [[D]]`` [[C]]"), "``[[B]] ` [[D]]`` [C](note:C)");
  assert.equal(render("a ` [[C]]"), "a ` [C](note:C)");
});

test("render escapes parentheses so a note named 'Smile :)' round-trips through linkTarget", () => {
  const out = render("[[Smile :)]] and [[f(x)]]");
  assert.equal(out, "[Smile :)](note:Smile%20%3A%29) and [f(x)](note:f%28x%29)");
  const urls = [...out.matchAll(/\]\((note:[^)]*)\)/g)].map((m) => m[1]);
  assert.deepEqual(urls.map(linkTarget), ["Smile :)", "f(x)"]);
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
