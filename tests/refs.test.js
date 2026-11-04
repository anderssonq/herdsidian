import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketByBase, resolveIn } from "../mods/herdsidian/graph.js";
import { linkTarget, render, resolve } from "../mods/herdsidian/notes.js";
import { buildRewrite, findAttachment, indexFiles, rewriteNote, utf8Length } from "../mods/herdsidian/refs.js";

const rewrite = (rename, holder, text) => rewriteNote(buildRewrite({ isDir: false, files: null, ...rename }), holder, text);

// A note rename and a folder rename, from the old list.
const renameNote = (from, to, notes) => ({ from, to, isDir: false, notes, files: null });
const renameDir = (from, to, notes, files = null) => ({ from, to, isDir: true, notes, files });

const mapPath = ({ from, to, isDir }, path) =>
  (path === from || (isDir && path.startsWith(`${from}/`)) ? `${to}${path.slice(from.length)}` : path);

// What a click does in the app: render() makes the URL, the Markdown parser strips `<>` and escapes, and
// follow() runs linkTarget() and resolve(). -> the note each link in the text opens, in order.
function opened(text, holder, notes) {
  const urls = [...render(text).matchAll(/\]\([ \t]*(<[^<>\n]*>|(?:\\.|\([^\s()]*\)|[^\s()\\])*)/g)]
    .map(([, dest]) => dest.replace(/^<|>$/g, "").replace(/\\([!-/:-@[-`{-~])/g, "$1"));
  return urls.map((url) => resolve(notes, holder, linkTarget(url)));
}

// The rewrite gives exactly `want`, with `changed` links changed and nothing failed, and each link in it opens `opens`.
function assertRewrites(rename, holder, text, want, { changed = 1, opens = null } = {}) {
  const out = rewrite(rename, holder, text);
  assert.equal(out.text, want);
  assert.equal(out.changed, changed);
  assert.equal(out.failed, 0);
  if (opens) {
    const notes = rename.notes.map((path) => mapPath(rename, path)).sort();
    assert.deepEqual(opened(out.text, mapPath(rename, holder), notes), opens);
  }
}

// The link stays as written, and its note is reported.
function assertFails(rename, holder, text, failed = 1) {
  const out = rewrite(rename, holder, text);
  assert.equal(out.text, text);
  assert.equal(out.changed, 0);
  assert.equal(out.failed, failed);
}

function assertStays(rename, holder, text) {
  const out = rewrite(rename, holder, text);
  assert.equal(out.text, text);
  assert.equal(out.changed, 0);
  assert.equal(out.failed, 0);
}

// ---- AC24

test("AC24: frontmatter, code, web and mailto URLs, absolute paths and reference definitions stay byte for byte", () => {
  const text = [
    "---", 'up: "[[Old]]"', "---", "```", "[[Old]]", "```", "~~~", "[t](Old.md)", "~~~",
    "`[[Old]]` and ``[t](Old.md)``",
    "[w](https://x.dev/Old.md) [s](http://x.dev/Old.md) [m](mailto:Old.md) [a](/Old.md) [h](#Old) [u](<https://x.dev/Old.md>)",
    "[id]: Old.md", "[id2]: <Old.md> \"T\"", "",
  ].join("\n");
  // The absolute path is the one link here that the app opens at the renamed note, so its note is reported.
  assertFails(renameNote("Old.md", "New.md", ["Old.md", "h.md"]), "h.md", text);
});

// ---- Links the app opens that stay as written: not silent

test("a link with no .md, a ./ form and an absolute path open the note today, so they stay and are reported", () => {
  const rename = renameNote("Old.md", "New.md", ["Old.md", "h.md"]);
  for (const text of ["[t](Old)", "[t2](./Old)", "[[/Old]]", "[abs](/Old.md)"]) {
    assert.deepEqual(opened(text, "h.md", rename.notes), ["Old.md"], text);
    assertFails(rename, "h.md", text);
  }
});

test("a folder path with no .md or from the root names the old folder, so it stays and is reported", () => {
  const rename = renameDir("F", "G", ["F/n.md", "h.md"]);
  assertFails(rename, "h.md", "[t](F/n)");
  assertFails(rename, "h.md", "[abs](/F/n.md)");
  assertFails(rename, "h.md", "[[/F/n]]");
});

test("a form with no renamed part that still opens the note after a folder rename reports nothing", () => {
  const rename = renameDir("F", "G", ["F/h.md", "F/n.md", "h.md"]);
  assertStays(rename, "h.md", "[t](n) [[/n]] [a](/n.md)");
  assertStays(rename, "F/h.md", "[t](n)");
});

test("the same form that a sort flip hands to another note is reported", () => {
  assertFails(renameDir("F", "zz", ["F/x.md", "h.md", "z/x.md"]), "h.md", "[t](x)");
});

test("these forms report nothing for a note that did not move", () => {
  assertStays(renameNote("Old.md", "New.md", ["Old.md", "Other.md", "h.md"]), "h.md", "[t](Other) [t2](./Other) [[/Other]] [a](/Other.md)");
});

test("an absolute path to an attachment stays and reports nothing", () => {
  assertStays(renameDir("att", "media", ["h.md"], ["att/s.png"]), "h.md", "![](/att/s.png) ![[/att/s.png]]");
});

test("a URL-shaped wikilink stays byte for byte and is reported when it selects the renamed note (AC24)", () => {
  const rename = renameNote("Old.md", "New.md", ["Old.md", "h.md"]);
  assertFails(rename, "h.md", "[[https://a.com/Old]]");
  assertFails(rename, "h.md", "[[ftp://a.com/Old.md|x]]");
  assertFails(rename, "h.md", "![[https://a.com/Old]]");
  assertFails(renameDir("F", "G", ["F/n.md", "h.md"]), "h.md", "[[https://a.com/F/n]]");
});

test("a URL-shaped wikilink with no note behind it reports nothing", () => {
  assertStays(renameNote("Old.md", "New.md", ["Old.md", "h.md"]), "h.md", "[[https://a.com/Other]]");
});

test("AC24: the renamed note itself is checked", () => {
  assertRewrites(renameNote("Old.md", "New.md", ["Old.md"]), "Old.md", "[[Old]]", "[[New]]", { opens: ["New.md"] });
});

test("AC24: a note inside the renamed folder is checked", () => {
  assertRewrites(renameDir("F", "G", ["F/x.md", "F/y.md"]), "F/y.md", "[[F/x]]", "[[G/x]]", { opens: ["G/x.md"] });
});

// ---- Only what follow() treats as external is skipped

// One rename after another: each output is the next input, and the list follows the renames.
function renameTwice(notes, holder, text, first, second) {
  const out1 = rewrite(renameNote(first[0], first[1], notes), holder, text);
  const notes1 = notes.map((path) => (path === first[0] ? first[1] : path)).sort();
  const out2 = rewrite(renameNote(second[0], second[1], notes1), holder, out1.text);
  const notes2 = notes1.map((path) => (path === second[0] ? second[1] : path)).sort();
  return { out1, notes1, out2, notes2 };
}

test("a colon in a note name: the link still opens the new path after a second rename", () => {
  const { out1, notes1, out2, notes2 } = renameTwice(["Old.md", "h.md"], "h.md", "[[Old]] ![[Old#s|a]] [t](Old.md) [u](<Old.md>)",
    ["Old.md", "v1: x.md"], ["v1: x.md", "v2: y.md"]);
  assert.equal(out1.text, "[[v1: x]] ![[v1: x#s|a]] [t](v1:%20x.md) [u](<v1:%20x.md>)");
  assert.deepEqual(opened(out1.text, "h.md", notes1), ["v1: x.md", "v1: x.md", "v1: x.md", "v1: x.md"]);
  assert.equal(out2.text, "[[v2: y]] ![[v2: y#s|a]] [t](v2:%20y.md) [u](<v2:%20y.md>)");
  assert.equal(out2.changed, 4);
  assert.equal(out2.failed, 0);
  assert.deepEqual(opened(out2.text, "h.md", notes2), ["v2: y.md", "v2: y.md", "v2: y.md", "v2: y.md"]);
});

test("a colon in a note name: a rename to a plain name changes the link", () => {
  assertRewrites(renameNote("v1: x.md", "New.md", ["h.md", "v1: x.md"]), "h.md", "[[v1: x]] [t](v1:%20x.md)", "[[New]] [t](New.md)",
    { changed: 2, opens: ["New.md", "New.md"] });
});

test("a colon in a folder name: note and attachment links change", () => {
  const rename = renameDir("v1: d", "v2: d", ["h.md", "v1: d/x.md"], ["v1: d/s.png"]);
  assertRewrites(rename, "h.md", "[[v1: d/x]] [t](v1:%20d/x.md) ![[v1: d/s.png]] ![](v1:%20d/s.png)",
    "[[v2: d/x]] [t](v2:%20d/x.md) ![[v2: d/s.png]] ![](v2:%20d/s.png)", { changed: 4 });
});

test("[x](v1: x.md) with a raw space is not a link, for the app or for the rewrite", () => {
  const out = rewrite(renameNote("v1: x.md", "New.md", ["h.md", "v1: x.md"]), "h.md", "[x](v1: x.md)");
  assert.deepEqual(out, { text: "[x](v1: x.md)", changed: 0, failed: 0, captured: 0 });
});

test("a wikilink is never external: its rendered URL is note:, so [[http: x]] still changes", () => {
  assert.match(render("[[http: x]]"), /\(note:http/);
  assertRewrites(renameNote("http: x.md", "New.md", ["h.md", "http: x.md"]), "h.md", "[[http: x]]", "[[New]]", { opens: ["New.md"] });
});

test("a Markdown link follow() sends to the system stays, also when a note has that name", () => {
  assertStays(renameNote("http: x.md", "New.md", ["h.md", "http: x.md"]), "h.md", "[t](http:%20x.md)");
  assertStays(renameNote("mailto:a.md", "New.md", ["h.md", "mailto:a.md"]), "h.md", "[t](mailto:a.md)");
});

test("a hand-written note: link is what follow() opens, so it changes and keeps its prefix", () => {
  assertRewrites(renameNote("Old.md", "New.md", ["Old.md", "h.md"]), "h.md", "[n](note:Old.md)", "[n](note:New.md)", { opens: ["New.md"] });
  assertRewrites(renameNote("Old.md", "a b.md", ["Old.md", "h.md"]), "h.md", "[n](<note:Old.md>)", "[n](<note:a%20b.md>)", { opens: ["a b.md"] });
});

test("a scheme URL follow() would open as a note stays byte for byte, and its note is reported", () => {
  const rename = renameNote("Old.md", "New.md", ["Old.md", "h.md"]);
  assert.equal(linkTarget("ftp://x.dev/Old.md"), "ftp://x.dev/Old.md");
  assert.equal(resolve(rename.notes, "h.md", "ftp://x.dev/Old.md"), "Old.md");
  assertFails(rename, "h.md", "[f](ftp://x.dev/Old.md)");
  assertFails(rename, "h.md", "[w](HTTPS://x.dev/Old.md)");
});

test("an unknown scheme with no note behind it stays and reports nothing", () => {
  assertStays(renameNote("Old.md", "New.md", ["Old.md", "h.md"]), "h.md", "[f](ftp://x.dev/a.pdf) [t](tel:555)");
});

// ---- AC25

test("AC25: renaming a/Foo.md changes [[Foo]] in a/x.md and not in b/y.md", () => {
  const notes = ["a/Foo.md", "a/x.md", "b/Foo.md", "b/y.md"];
  const rename = renameNote("a/Foo.md", "a/Bar.md", notes);
  assertRewrites(rename, "a/x.md", "[[Foo]]", "[[Bar]]", { opens: ["a/Bar.md"] });
  assertStays(rename, "b/y.md", "[[Foo]]");
});

// ---- AC26

test("AC26: a changed link keeps the heading, alias, embed mark, link text, title, .md ending and line endings", () => {
  const rename = renameNote("Old.md", "New.md", ["Old.md", "h.md"]);
  assertRewrites(rename, "h.md",
    "A ![[Old#h|al]] [[ Old ]] [[Old.md]]\r\n\r\n[t [b]](Old.md#sec \"T\") [u]( Old.md 'q' )\r\nend",
    "A ![[New#h|al]] [[ New ]] [[New.md]]\r\n\r\n[t [b]](New.md#sec \"T\") [u]( New.md 'q' )\r\nend",
    { changed: 5 });
});

test("AC26: a note with no changed link comes back unchanged", () => {
  const text = "[[Other]] [t](Other.md)\n";
  const out = rewrite(renameNote("Old.md", "New.md", ["Old.md", "Other.md", "h.md"]), "h.md", text);
  assert.deepEqual(out, { text, changed: 0, failed: 0, captured: 0 });
});

test("AC26: a dollar pattern in the new name stays literal", () => {
  assertRewrites(renameNote("Old.md", "a$&b.md", ["Old.md", "h.md"]), "h.md", "x [[Old]] y", "x [[a$&b]] y", { opens: ["a$&b.md"] });
});

// ---- AC27

test("AC27: a bare link stays bare", () => {
  assertRewrites(renameNote("a/Old.md", "a/New.md", ["a/Old.md", "h.md"]), "h.md", "[[Old]]", "[[New]]", { opens: ["a/New.md"] });
});

test("AC27: a path link keeps its path and changes the last part", () => {
  const rename = renameNote("a/Old.md", "a/New.md", ["a/Old.md", "h.md"]);
  assertRewrites(rename, "h.md", "[[a/Old]]", "[[a/New]]", { opens: ["a/New.md"] });
  assertRewrites(rename, "h.md", "[t](a/Old.md)", "[t](a/New.md)", { opens: ["a/New.md"] });
});

test("AC27: the match ignores case", () => {
  const rename = renameNote("a/Old.md", "a/New.md", ["a/Old.md", "h.md"]);
  assertRewrites(rename, "h.md", "[[OLD]] [[A/old]]", "[[New]] [[A/New]]", { changed: 2, opens: ["a/New.md", "a/New.md"] });
});

test("AC27: a path resolve() found by name changes only the last part", () => {
  assertRewrites(renameNote("a/Old.md", "a/New.md", ["a/Old.md", "h.md"]), "h.md", "[[zz/Old]]", "[[zz/New]]", { opens: ["a/New.md"] });
});

test("AC26, AC27: a .md ending keeps the case it was written in", () => {
  assertRewrites(renameNote("Old.md", "New.md", ["Old.md", "h.md"]), "h.md", "[[Old.MD]] [t](Old.MD)", "[[New.MD]] [t](New.MD)",
    { changed: 2, opens: ["New.md", "New.md"] });
});

// ---- AC28

test("AC28: [t](my%20old.md) renamed to my new gives [t](my%20new.md), and follow() opens it", () => {
  assertRewrites(renameNote("my old.md", "my new.md", ["h.md", "my old.md"]), "h.md", "[t](my%20old.md)", "[t](my%20new.md)", { opens: ["my new.md"] });
});

test("AC28: a space and parens in the new name are percent-encoded, and follow() opens it", () => {
  assertRewrites(renameNote("Old.md", "a (b).md", ["Old.md", "h.md"]), "h.md", "[t](Old.md)", "[t](a%20%28b%29.md)", { opens: ["a (b).md"] });
});

// ---- AC29

test("AC29: only the part of a written path that names the folder changes", () => {
  assertRewrites(renameDir("F", "G", ["F/x.md", "h.md"]), "h.md", "[[F/x]]", "[[G/x]]", { opens: ["G/x.md"] });
  assertRewrites(renameDir("a/F", "a/G", ["a/F/x.md", "h.md"]), "h.md", "[[a/F/x]]", "[[a/G/x]]", { opens: ["a/G/x.md"] });
});

test("AC29: a bare link and a path below the folder stay while they still resolve to the same note", () => {
  const notes = ["F/h.md", "F/sub/y.md", "F/x.md", "other.md"];
  const rename = renameDir("F", "G", notes);
  assertStays(rename, "F/h.md", "[[x]] [t](sub/y.md)");
  assertStays(rename, "other.md", "[[x]]");
});

// ---- AC30

test("AC30: a kept form that became ambiguous uses the path from the vault root", () => {
  assertRewrites(renameNote("z/Old.md", "z/New.md", ["b/New.md", "h.md", "z/Old.md"]), "h.md", "[[Old]]", "[[z/New]]", { opens: ["z/New.md"] });
});

test("AC30: a bare link whose sort order flips after a folder rename goes to the root form", () => {
  assertRewrites(renameDir("F", "zz", ["F/x.md", "h.md", "z/x.md"]), "h.md", "[[x]]", "[[zz/x]]", { opens: ["zz/x.md"] });
});

test("AC30: the root form keeps a written .md ending and is encoded in a Markdown link", () => {
  const rename = renameNote("my z/Old.md", "my z/New.md", ["b/New.md", "h.md", "my z/Old.md"]);
  assertRewrites(rename, "h.md", "[[Old.md]]", "[[my z/New.md]]", { opens: ["my z/New.md"] });
  assertRewrites(rename, "h.md", "[t](Old.md)", "[t](my%20z/New.md)", { opens: ["my z/New.md"] });
});

// ---- AC31

test("AC31: # in a new name stays and fails for both link kinds", () => {
  assertFails(renameNote("Old.md", "a#b.md", ["Old.md", "h.md"]), "h.md", "[[Old]] [t](Old.md)", 2);
});

test("AC31: | in a new name stays and fails, and the Markdown link in the same note changes", () => {
  const out = rewrite(renameNote("Old.md", "a|b.md", ["Old.md", "h.md"]), "h.md", "[[Old]] [t](Old.md)");
  assert.equal(out.text, "[[Old]] [t](a|b.md)");
  assert.equal(out.failed, 1);
  assert.equal(out.changed, 1);
});

test("AC31: ] in a new name stays and fails, and the Markdown link in the same note changes", () => {
  const out = rewrite(renameNote("Old.md", "a]b.md", ["Old.md", "h.md"]), "h.md", "[[Old]] [t](Old.md)");
  assert.equal(out.text, "[[Old]] [t](a]b.md)");
  assert.equal(out.failed, 1);
  assert.equal(out.changed, 1);
});

test("AC31: a shadowing note fails that link, and other links in the same note change", () => {
  const notes = ["A/G/a.md", "F/a.md", "F/b.md", "m/h.md"];
  const out = rewrite(renameDir("F", "G", notes), "m/h.md", "[[F/a]] and [[F/b]]");
  assert.equal(out.text, "[[F/a]] and [[G/b]]");
  assert.equal(out.failed, 1);
  assert.equal(out.changed, 1);
});

test("AC31: a new folder name that reads as a heading or alias stays and fails, even when the short target would open the note", () => {
  const notes = ["F/a.md", "h.md"];
  assertFails(renameDir("F", "a#", notes), "h.md", "[[F/a]] [t](F/a.md)", 2);
  assertFails(renameDir("F", "a|", notes), "h.md", "[[F/a]]");
});

test("AC31: a new name holding [[x]] stays and fails in a Markdown link, because render() would read a wikilink", () => {
  const rename = renameNote("Old.md", "[[x]].md", ["Old.md", "h.md"]);
  assert.match(render("[t]([[x]].md)"), /note:x/);
  assertFails(rename, "h.md", "[t](Old.md)");
  assertFails(rename, "h.md", "[t](<Old.md>)");
  assertFails(rename, "h.md", "[[Old]] [t](Old.md)", 2);
});

test("AC31: half of a wikilink in a new name stays and fails, because render() could close it with nearby text", () => {
  assert.match(render("[t]([[x.md) and ]]"), /note:x/);
  assertFails(renameNote("Old.md", "[[x.md", ["Old.md", "h.md"]), "h.md", "[t](Old.md) and ]]");
  assert.match(render("[t]([[d/x]].md)"), /note:d/);
  assertFails(renameNote("[[d/Old.md", "[[d/x]].md", ["[[d/Old.md", "h.md"]), "h.md", "[t]([[d/Old.md)");
  assertFails(renameNote("Old.md", "x]].md", ["Old.md", "h.md"]), "h.md", "[t](Old.md)");
  assertFails(renameNote("Old.md", "a[[b.md", ["Old.md", "h.md"]), "h.md", "[[Old]]");
});

test("AC44: a new folder holding [[x]] stays and fails in a Markdown attachment link", () => {
  assertFails(renameDir("att", "[[m]]", ["h.md"], ["att/s.png"]), "h.md", "![](att/s.png)");
  assertFails(renameDir("att", "[[m]]", ["h.md"], ["att/s.png"]), "h.md", "![[att/s.png]]");
});

test("AC31: a kept segment that already holds [[ does not fail, because the rename adds nothing new", () => {
  assertRewrites(renameNote("[[d/Old.md", "[[d/New.md", ["[[d/Old.md", "h.md"]), "h.md", "[t]([[d/Old.md)", "[t]([[d/New.md)");
});

test("AC31: ![[Old]] renamed to v1.2 stays and fails, because the app would read a file embed", () => {
  assertFails(renameNote("Old.md", "v1.2.md", ["Old.md", "h.md"]), "h.md", "![[Old]]");
});

test("AC31: [[Old]] renamed to v1.2 changes, because only an embed reads as a file", () => {
  assertRewrites(renameNote("Old.md", "v1.2.md", ["Old.md", "h.md"]), "h.md", "[[Old]]", "[[v1.2]]", { opens: ["v1.2.md"] });
});

test("AC31: a new name follow() would send to the browser stays and fails in a Markdown link", () => {
  const out = rewrite(renameNote("Old.md", "http: x.md", ["Old.md", "h.md"]), "h.md", "[t](Old.md) [[Old]]");
  assert.equal(out.text, "[t](Old.md) [[http: x]]");
  assert.equal(out.failed, 1);
  assert.equal(out.changed, 1);
});

test("AC31: a new backtick stays and fails, because mapProse() could turn the link into code", () => {
  assertFails(renameNote("Old.md", "a`b.md", ["Old.md", "h.md"]), "h.md", "[[Old]] and `x", 1);
  assertFails(renameNote("Old.md", "a`b.md", ["Old.md", "h.md"]), "h.md", "[t](Old.md)", 1);
});

// ---- AC32

test("AC32: [[New]] that resolved to other/New.md stays and counts as captured", () => {
  const notes = ["a/Old.md", "a/h.md", "other/New.md"];
  const out = rewrite(renameNote("a/Old.md", "a/New.md", notes), "a/h.md", "[[New]]");
  assert.deepEqual(out, { text: "[[New]]", changed: 0, failed: 0, captured: 1 });
});

test("AC32: a link that resolved to nothing stays and counts as captured", () => {
  const rename = renameNote("a/Old.md", "a/New.md", ["a/Old.md", "a/h.md"]);
  assert.deepEqual(rewrite(rename, "a/h.md", "[[New]]"), { text: "[[New]]", changed: 0, failed: 0, captured: 1 });
  assert.deepEqual(rewrite(rename, "a/h.md", "[t](New.md)"), { text: "[t](New.md)", changed: 0, failed: 0, captured: 1 });
});

test("AC32: a link the sort order hands to the renamed folder stays and counts as captured", () => {
  const out = rewrite(renameDir("b", "0b", ["a/x.md", "b/x.md", "h.md"]), "h.md", "[[x]]");
  assert.deepEqual(out, { text: "[[x]]", changed: 0, failed: 0, captured: 1 });
});

test("AC32: a link that still resolves to its own note does not count as captured", () => {
  const out = rewrite(renameNote("a/Old.md", "a/New.md", ["a/Old.md", "a/h.md", "other/x.md"]), "a/h.md", "[[x]] [[missing]]");
  assert.deepEqual(out, { text: "[[x]] [[missing]]", changed: 0, failed: 0, captured: 0 });
});

// ---- AC38

test("AC38: a same-name, case-only or Unicode-form-only rename changes nothing", () => {
  assertStays(renameNote("foo.md", "foo.md", ["foo.md", "h.md"]), "h.md", "[[FOO]] [t](foo.md)");
  assertStays(renameNote("foo.md", "Foo.md", ["foo.md", "h.md"]), "h.md", "[[foo]] [t](foo.md)");
  assertStays(renameDir("docs", "Docs", ["docs/x.md", "h.md"], ["docs/a.png"]), "h.md", "[[docs/x]] ![[docs/a.png]]");
  assertStays(renameNote("Café.md", "Café.md", ["Café.md", "h.md"]), "h.md", "[[Café]]");
});

// ---- Agreement: render(), linkTarget() and resolve() open the new path

const AGREEMENT = [
  ["bare wikilink", renameNote("Old.md", "New.md", ["Old.md", "h.md"]), "h.md", "[[Old]]", "New.md"],
  ["embed", renameNote("Old.md", "New.md", ["Old.md", "h.md"]), "h.md", "![[Old]]", "New.md"],
  ["heading and alias", renameNote("Old.md", "New.md", ["Old.md", "h.md"]), "h.md", "[[Old#x|y]]", "New.md"],
  ["inner spaces", renameNote("a b.md", "c d.md", ["a b.md", "h.md"]), "h.md", "[[ a b ]]", "c d.md"],
  ["percent in a wikilink", renameNote("Old.md", "50%.md", ["Old.md", "h.md"]), "h.md", "[[Old]]", "50%.md"],
  ["percent in a Markdown link", renameNote("Old.md", "50%.md", ["Old.md", "h.md"]), "h.md", "[t](Old.md)", "50%.md"],
  ["parens in a wikilink", renameNote("Old.md", "a (b).md", ["Old.md", "h.md"]), "h.md", "[[Old]]", "a (b).md"],
  ["parens in a Markdown link", renameNote("Old.md", "a (b).md", ["Old.md", "h.md"]), "h.md", "[t](Old.md)", "a (b).md"],
  ["angle form", renameNote("a b.md", "c d.md", ["a b.md", "h.md"]), "h.md", "[t](<a b.md>)", "c d.md"],
  ["angles in the new name", renameNote("Old.md", "a<b>.md", ["Old.md", "h.md"]), "h.md", "[t](Old.md)", "a<b>.md"],
  ["question mark in the new name", renameNote("Old.md", "a?.md", ["Old.md", "h.md"]), "h.md", "[t](Old.md)", "a?.md"],
  ["a colon in the new name", renameNote("Old.md", "v1: x.md", ["Old.md", "h.md"]), "h.md", "[t](Old.md)", "v1: x.md"],
  ["sort flip", renameDir("F", "zz", ["F/x.md", "h.md", "z/x.md"]), "h.md", "[[x]]", "zz/x.md"],
  ["holder in the folder", renameDir("F", "G", ["F/h.md", "F/x.md"]), "F/h.md", "[[F/x]]", "G/x.md"],
  ["folder with spaces", renameDir("a b", "c d", ["a b/x.md", "h.md"]), "h.md", "[t](a%20b/x.md)", "c d/x.md"],
  ["parent path", renameNote("a/Old.md", "a/New.md", ["a/Old.md", "b/h.md"]), "b/h.md", "[t](../a/Old.md)", "a/New.md"],
];

for (const [name, rename, holder, text, goal] of AGREEMENT) {
  test(`agreement: ${name}: render(), linkTarget() and resolve() open the new path`, () => {
    const notes = rename.notes.map((path) => mapPath(rename, path)).sort();
    const out = rewrite(rename, holder, text);
    assert.equal(out.changed, 1);
    assert.equal(out.failed, 0);
    assert.notEqual(out.text, text);
    assert.deepEqual(opened(out.text, mapPath(rename, holder), notes), [goal]);
  });
}

// ---- resolve and resolveIn

test("resolve and resolveIn agree on the fixture lists", () => {
  const lists = [
    ["F/F.md", "F/h.md", "F/x.md", "a/F/F/x.md", "b/New.md", "h.md", "my old.md", "z/x.md"],
    ["A/x.md", "a b/x.md", "Old.MD", "zz/x.md", "x.md.md"],
  ];
  const targets = ["x", "X", "F", "F/x", "f/F", "New", "Old", "Old.md", "OLD.MD", "my old", "../x", "./x", "zz/x", "x.md", "missing", "a/F/F/x"];
  for (const list of lists) {
    const buckets = bucketByBase(list);
    for (const holder of ["h.md", "F/h.md", "a/F/F/n.md"]) {
      for (const target of targets) assert.equal(resolveIn(buckets, holder, target), resolve(list, holder, target), `${holder} -> ${target}`);
    }
  }
});

// ---- Holder inside the renamed folder

test("a holder inside the renamed folder is selected by its old path and checked by its new one", () => {
  const out = rewrite(renameDir("f", "g", ["a/x.md", "f/h.md", "f/x.md"]), "f/h.md", "[[x]]");
  assert.deepEqual(out, { text: "[[x]]", changed: 0, failed: 0, captured: 0 });
});

test("a relative Markdown link in a holder inside the renamed folder stays", () => {
  const out = rewrite(renameDir("f", "g", ["a/y.md", "f/h.md", "f/y.md"]), "f/h.md", "[t](y.md)");
  assert.deepEqual(out, { text: "[t](y.md)", changed: 0, failed: 0, captured: 0 });
});

test("AC29: a bare link and a path below the folder stay when only the same-folder step finds them", () => {
  const notes = ["a/sub/y.md", "a/x.md", "f/h.md", "f/sub/y.md", "f/x.md"];
  const out = rewrite(renameDir("f", "g", notes), "f/h.md", "[[x]] [t](sub/y.md)");
  assert.deepEqual(out, { text: "[[x]] [t](sub/y.md)", changed: 0, failed: 0, captured: 0 });
  const after = notes.map((path) => mapPath(renameDir("f", "g", notes), path)).sort();
  assert.deepEqual(opened(out.text, "g/h.md", after), ["g/x.md", "g/sub/y.md"]);
});

test("AC29: a holder in a folder with a capital keeps a bare link to its same-folder note", () => {
  const notes = ["A/x.md", "F/h.md", "F/x.md"];
  assert.equal(resolve(notes, "F/h.md", "x"), "F/x.md");
  const out = rewrite(renameDir("F", "G", notes), "F/h.md", "[[x]]");
  assert.deepEqual(out, { text: "[[x]]", changed: 0, failed: 0, captured: 0 });
  assert.deepEqual(opened(out.text, "G/h.md", ["A/x.md", "G/h.md", "G/x.md"]), ["G/x.md"]);
});

test("AC25: a rename of the same-folder note in a folder with a capital changes the link, and one elsewhere does not", () => {
  const notes = ["A/x.md", "F/h.md", "F/x.md"];
  assertRewrites(renameNote("F/x.md", "F/y.md", notes), "F/h.md", "[[x]]", "[[y]]", { opens: ["F/y.md"] });
  assertStays(renameNote("A/x.md", "A/y.md", notes), "F/h.md", "[[x]]");
});

test("AC29: a folder renamed from lowercase to a capital keeps the short form, because the same-folder step still finds it", () => {
  const notes = ["A/x.md", "f/h.md", "f/x.md"];
  const out = rewrite(renameDir("f", "G", notes), "f/h.md", "[[x]]");
  assert.deepEqual(out, { text: "[[x]]", changed: 0, failed: 0, captured: 0 });
  assert.deepEqual(opened(out.text, "G/h.md", ["A/x.md", "G/h.md", "G/x.md"]), ["G/x.md"]);
});

// ---- The right segment

test("[[F/F]]: only the folder segment changes, not the note with the same name", () => {
  assertRewrites(renameDir("F", "G", ["F/F.md", "h.md"]), "h.md", "[[F/F]]", "[[G/F]]", { opens: ["G/F.md"] });
});

test("a/F/F/x: only the segment of the renamed folder changes", () => {
  const notes = ["a/F/F/x.md", "h.md"];
  assertRewrites(renameDir("a/F", "a/G", notes), "h.md", "[[a/F/F/x]]", "[[a/G/F/x]]", { opens: ["a/G/F/x.md"] });
  assertRewrites(renameDir("a/F/F", "a/F/G", notes), "h.md", "[[a/F/F/x]]", "[[a/F/G/x]]", { opens: ["a/F/G/x.md"] });
});

test("a note F.md beside folder F: a folder rename leaves [[F]] and a note rename leaves [[F/x]]", () => {
  const notes = ["F.md", "F/x.md", "h.md"];
  assertRewrites(renameDir("F", "G", notes), "h.md", "[[F]] [[F/x]]", "[[F]] [[G/x]]", { opens: ["F.md", "G/x.md"] });
  assertRewrites(renameNote("F.md", "G.md", notes), "h.md", "[[F]] [[F/x]]", "[[G]] [[F/x]]", { opens: ["G.md", "F/x.md"] });
});

test("folder ab is not touched by a rename of folder a", () => {
  const rename = renameDir("a", "c", ["a/x.md", "ab/y.md", "h.md"]);
  assertStays(rename, "h.md", "[[ab/y]] [[y]]");
});

// ---- Markdown forms

test("markdown: an angle destination stays in angles, and a space in an unchanged segment stays raw", () => {
  assertRewrites(renameNote("a b.md", "c.md", ["a b.md", "h.md"]), "h.md", "[t](<a b.md>)", "[t](<c.md>)", { opens: ["c.md"] });
  assertRewrites(renameDir("a b", "c d", ["a b/x y.md", "h.md"]), "h.md", "[t](<a b/x y.md>)", "[t](<c%20d/x y.md>)", { opens: ["c d/x y.md"] });
});

test("markdown: a title and the spaces around the destination stay", () => {
  assertRewrites(renameNote("Old.md", "New.md", ["Old.md", "h.md"]), "h.md", "[t](  Old.md   \"My (title)\"  )", "[t](  New.md   \"My (title)\"  )", { opens: ["New.md"] });
  assertRewrites(renameNote("Old.md", "New.md", ["Old.md", "h.md"]), "h.md", "[t](<Old.md> 'x')", "[t](<New.md> 'x')", { opens: ["New.md"] });
});

test("markdown: %20 stays in unchanged segments", () => {
  assertRewrites(renameNote("my dir/Old.md", "my dir/New.md", ["h.md", "my dir/Old.md"]), "h.md", "[t](my%20dir/Old.md)", "[t](my%20dir/New.md)", { opens: ["my dir/New.md"] });
});

test("markdown: a new %, space and parens are encoded", () => {
  assertRewrites(renameNote("Old.md", "50% (a).md", ["Old.md", "h.md"]), "h.md", "[t](Old.md)", "[t](50%25%20%28a%29.md)", { opens: ["50% (a).md"] });
});

test("markdown: a fragment stays", () => {
  assertRewrites(renameNote("Old.md", "New.md", ["Old.md", "h.md"]), "h.md", "[t](Old.md#a-b)", "[t](New.md#a-b)", { opens: ["New.md"] });
});

test("markdown: backslash escapes in a written name are read and a kept segment stays escaped", () => {
  assertRewrites(renameNote("a(b).md", "New.md", ["a(b).md", "h.md"]), "h.md", "[t](a\\(b\\).md)", "[t](New.md)", { opens: ["New.md"] });
  assertRewrites(renameNote("d(1)/Old.md", "d(1)/New.md", ["d(1)/Old.md", "h.md"]), "h.md", "[t](d\\(1\\)/Old.md)", "[t](d\\(1\\)/New.md)", { opens: ["d(1)/New.md"] });
});

test("markdown: a bad percent in the written path does not stop the rename", () => {
  assertRewrites(renameNote("100%.md", "New.md", ["100%.md", "h.md"]), "h.md", "[t](100%.md)", "[t](New.md)", { opens: ["New.md"] });
});

test("markdown: a nested image in the link text stays and the outer destination changes", () => {
  assertRewrites(renameNote("Old.md", "New.md", ["Old.md", "h.md"]), "h.md", "[![alt](pic.png)](Old.md)", "[![alt](pic.png)](New.md)");
});

test("markdown: a code span in the link text does not hide the opener", () => {
  assertRewrites(renameNote("Old.md", "New.md", ["Old.md", "h.md"]), "h.md", "[`code` x](Old.md) [`y`](Old.md)", "[`code` x](New.md) [`y`](New.md)", { changed: 2 });
});

test("markdown: link text over two lines still finds its opener", () => {
  assertRewrites(renameNote("Old.md", "New.md", ["Old.md", "h.md"]), "h.md", "[a\r\nb](Old.md)", "[a\r\nb](New.md)");
});

test("markdown: an escaped ] is not a link", () => {
  assertStays(renameNote("Old.md", "New.md", ["Old.md", "h.md"]), "h.md", "[a\\](Old.md)");
});

test("markdown: an escaped backslash before ] is still a link", () => {
  assertRewrites(renameNote("Old.md", "New.md", ["Old.md", "h.md"]), "h.md", "[a\\\\](Old.md)", "[a\\\\](New.md)");
});

test("markdown: plain text with no opener stays", () => {
  const rename = renameNote("Old.md", "New.md", ["Old.md", "h.md"]);
  assertStays(rename, "h.md", "x](Old.md)");
  assertStays(rename, "h.md", "\\[x](Old.md)");
  assertStays(rename, "h.md", "[x]y](Old.md)");
});

test("markdown: an opener before a blank line does not count", () => {
  const rename = renameNote("Old.md", "New.md", ["Old.md", "h.md"]);
  assertStays(rename, "h.md", "[x\n\ny](Old.md)");
  assertStays(rename, "h.md", "[x\r\n \t\r\ny](Old.md)");
  assertStays(rename, "h.md", "[`c`\n\n`d`](Old.md)");
});

test("markdown: a reference definition stays and its use is not a link", () => {
  assertStays(renameNote("Old.md", "New.md", ["Old.md", "h.md"]), "h.md", "[t][id]\n\n[id]: Old.md\n");
});

test("markdown: [[x]](y.md) is one wikilink plus plain text", () => {
  const rename = renameNote("y.md", "z.md", ["h.md", "x.md", "y.md"]);
  assertStays(rename, "h.md", "[[x]](y.md)");
  assertRewrites(rename, "h.md", "[[y]](y.md)", "[[z]](y.md)");
});

test("markdown: a link with no .md that resolves to the renamed note stays and is reported", () => {
  assertFails(renameNote("Old.md", "New.md", ["Old.md", "h.md"]), "h.md", "[t](Old)");
});

test("markdown: an opener before a fence does not count, for either fence kind", () => {
  const rename = renameNote("Old.md", "New.md", ["Old.md", "h.md"]);
  assertStays(rename, "h.md", "[ open\n```\ncode\n```\nfoo](Old.md)\n");
  assertStays(rename, "h.md", "[ open\n~~~\ncode\n~~~\nfoo](Old.md)\n");
  assertStays(rename, "h.md", "[ open\n```\ncode\n```\n`a` foo](Old.md)\n");
});

test("markdown: a link after a fence with its own opener still changes", () => {
  assertRewrites(renameNote("Old.md", "New.md", ["Old.md", "h.md"]), "h.md", "[ open\n```\ncode\n```\n[foo](Old.md)\n", "[ open\n```\ncode\n```\n[foo](New.md)\n");
});

// ---- The identity property

const UNRELATED = renameNote("zz/Unrelated.md", "zz/Renamed.md", ["a/F/x.md", "a/Old.md", "h.md", "other.md", "zz/Unrelated.md"]);
const BODY = [
  "# Title", "", "[[Old]] ![[Old#h|a]] [[ other ]] [[missing]] [[]] [[|x]]", "[t](a/Old.md \"T\") [u](<a/Old.md>) ![i](p.png)", "",
  "```js", "[[Unrelated]] `open", "~~~", "```", "~~~~", "[t](zz/Unrelated.md)", "```", "~~~~",
  "`[[Unrelated]]` ``a`b`` ]( x](a.md) [[unclosed \\] [y", "",
  "[id]: zz/Unrelated.md", "---", "tail",
];
const IDENTITY = {
  "LF": BODY.join("\n"),
  "LF with a final newline": `${BODY.join("\n")}\n`,
  "CRLF": BODY.join("\r\n"),
  "CRLF with a final newline": `${BODY.join("\r\n")}\r\n`,
  "BOM": `﻿${BODY.join("\n")}\n`,
  "BOM and frontmatter": `﻿---\nup: x\n---\n${BODY.join("\n")}`,
  "frontmatter": `---\nup: "[[Unrelated]]"\n---\n${BODY.join("\n")}`,
  "CRLF frontmatter": `---\r\nup: "[[Unrelated]]"\r\n---\r\n${BODY.join("\r\n")}`,
  "frontmatter only, no final newline": "---\nup: x\n---",
  "unclosed frontmatter": `---\nup: x\n${BODY.join("\n")}`,
  "mixed line endings": "a\r\n[[other]]\nb\r\n```\n[[Unrelated]]\r\n```\nc",
  "an unclosed tilde fence": "[[other]]\n~~~\n[[Unrelated]]\n```\n",
  "an unclosed backtick fence": "```\n[[Unrelated]]\n~~~\n",
  "a long fence": "````\n```\n[[Unrelated]]\n````\n[[other]]\n",
  "empty": "",
  "one newline": "\n",
  "no final newline": "[[other]]",
};

for (const [name, text] of Object.entries(IDENTITY)) {
  test(`identity: no selected link returns the same string (${name})`, () => {
    const out = rewrite(UNRELATED, "h.md", text);
    assert.equal(out.text === text, true);
    assert.equal(out.changed, 0);
    assert.equal(out.failed, 0);
  });
}

test("a changed link leaves frontmatter, code and mixed line endings as written", () => {
  const out = rewrite(UNRELATED, "h.md","---\nup: \"[[Unrelated]]\"\n---\r\n```\n[[Unrelated]]\n```\n`[[Unrelated]]`\r\n[[Unrelated]]");
  assert.equal(out.text, "---\nup: \"[[Unrelated]]\"\n---\r\n```\n[[Unrelated]]\n```\n`[[Unrelated]]`\r\n[[Renamed]]");
});

test("a BOM hides frontmatter from render(), so its links are prose, as in the app", () => {
  const rename = renameNote("Old.md", "New.md", ["Old.md", "h.md"]);
  assertRewrites(rename, "h.md", "﻿---\nup: [[Old]]\n---\n", "﻿---\nup: [[New]]\n---\n");
  assert.match(render("﻿---\nup: [[Old]]\n---\n"), /note:Old/);
});

// ---- AC40

test("AC40: ![[att/shot.png]] gives ![[media/shot.png]]", () => {
  assertRewrites(renameDir("att", "media", ["h.md"], ["att/shot.png"]), "h.md", "![[att/shot.png]]", "![[media/shot.png]]");
});

test("AC40: [[docs/att/file.pdf]] gives [[docs/media/file.pdf]]", () => {
  assertRewrites(renameDir("docs/att", "docs/media", ["h.md"], ["docs/att/file.pdf"]), "h.md", "[[docs/att/file.pdf]]", "[[docs/media/file.pdf]]");
});

test("AC40: ![](../att/shot.png) gives ![](../media/shot.png)", () => {
  assertRewrites(renameDir("att", "media", ["notes/x.md"], ["att/shot.png"]), "notes/x.md", "![](../att/shot.png)", "![](../media/shot.png)");
});

test("AC40: a file at any depth in the folder changes", () => {
  assertRewrites(renameDir("att", "media", ["h.md"], ["att/a/b/shot.png"]), "h.md", "![[att/a/b/shot.png]]", "![[media/a/b/shot.png]]");
});

test("AC40: a note inside the renamed folder is checked", () => {
  assertRewrites(renameDir("att", "media", ["att/n.md"], ["att/shot.png"]), "att/n.md", "![[att/shot.png]]", "![[media/shot.png]]");
});

// ---- AC41

const attRename = (files,notes = ["h.md", "other/x.md"]) => renameDir("att", "media", notes, files);

test("AC41: the holder's folder comes first: a match outside the folder stays", () => {
  assertStays(attRename(["att/shot.png", "other/att/shot.png"]), "other/x.md", "![[att/shot.png]]");
});

test("AC41: the holder's folder comes first: a match inside the folder changes", () => {
  const rename = renameDir("other/att", "other/media", ["other/x.md"], ["att/shot.png", "other/att/shot.png"]);
  assertRewrites(rename, "other/x.md", "![[att/shot.png]]", "![[media/shot.png]]");
});

test("AC41: the vault root comes second, ahead of a path ending", () => {
  assertRewrites(attRename(["att/shot.png", "z/att/shot.png"]), "other/x.md", "![[att/shot.png]]", "![[media/shot.png]]");
  assertStays(renameDir("z/att", "z/media", ["other/x.md"], ["att/shot.png", "z/att/shot.png"]), "other/x.md", "![[att/shot.png]]");
});

test("AC41: a path ending with exactly one match changes", () => {
  assertRewrites(renameDir("z/att", "z/media", ["other/x.md"], ["z/att/shot.png"]), "other/x.md", "![[att/shot.png]]", "![[media/shot.png]]");
});

test("AC41: several path endings with one in the folder stay and fail", () => {
  assertFails(renameDir("z/att", "z/media", ["h.md"], ["b/att/shot.png", "z/att/shot.png"]), "h.md", "![[att/shot.png]]");
});

test("AC41: several path endings with none in the folder stay and do not fail", () => {
  assertStays(renameDir("q", "r", ["h.md"], ["a/att/shot.png", "b/att/shot.png", "q/other.png"]), "h.md", "![[att/shot.png]]");
});

test("AC41: nothing found stays", () => {
  assertStays(attRename(["att/other.png"]), "h.md", "![[att/shot.png]] [t](att/none.pdf)");
});

test("AC41: case and Unicode form are ignored", () => {
  assertRewrites(attRename(["att/shot.png"]), "h.md", "![[ATT/Shot.PNG]]", "![[media/Shot.PNG]]");
  assertRewrites(renameDir("Café", "Bar", ["h.md"], ["Café/x.png"]), "h.md", "![[Café/x.png]]", "![[Bar/x.png]]");
  assertRewrites(renameDir("Café/att", "Café/media", ["h.md"], ["Café/att/x.png"]), "h.md", "![[Café/att/x.png]]", "![[Café/media/x.png]]");
});

test("AC41: a file known only from the disk, not the note list, changes", () => {
  assertRewrites(attRename(["att/deep/report.pdf"]), "h.md", "[r](att/deep/report.pdf)", "[r](media/deep/report.pdf)");
});

test("AC41: ../ forms: inside, past the root, and to another file", () => {
  const notes = ["a/b/h.md"];
  assertRewrites(renameDir("att", "media", notes, ["att/x.png"]), "a/b/h.md", "![](../../att/x.png)", "![](../../media/x.png)");
  assertRewrites(renameDir("att", "media", notes, ["att/x.png"]), "a/b/h.md", "![](../../../att/x.png)", "![](../../../media/x.png)");
  assertRewrites(renameDir("att", "media", notes, ["att/x.png"]), "a/b/h.md", "![](./../../att/x.png)", "![](./../../media/x.png)");
  assertStays(renameDir("att", "media", notes, ["a/att/x.png", "att/x.png"]), "a/b/h.md", "![](../att/x.png)");
});

test("findAttachment: the first match wins, in the AC41 order", () => {
  const index = indexFiles(["att/x.png", "d/att/x.png", "z/att/y.png", "p/s.png", "q/s.png"]);
  assert.deepEqual(findAttachment(index, "d", "att/x.png"), { file: "d/att/x.png" });
  assert.deepEqual(findAttachment(index, "n", "att/x.png"), { file: "att/x.png" });
  assert.deepEqual(findAttachment(index, "", "att/y.png"), { file: "z/att/y.png" });
  assert.deepEqual(findAttachment(index, "", "s.png"), { several: ["p/s.png", "q/s.png"] });
  assert.equal(findAttachment(index, "", "none.png"), null);
});

test("findAttachment: ./ and ../ are normalized, and going above the root falls through to the path ending", () => {
  const index = indexFiles(["att/x.png"]);
  assert.deepEqual(findAttachment(index, "d", "../att/./x.png"), { file: "att/x.png" });
  assert.deepEqual(findAttachment(index, "", "../../att/x.png"), { file: "att/x.png" });
  assert.equal(findAttachment(index, "", "../../x/x.png"), null);
});

test("findAttachment: a .md target is never an attachment", () => {
  assert.equal(findAttachment(indexFiles(["att/x.md"]), "", "att/x.md"), null);
  assert.equal(findAttachment(indexFiles(["att/x.MD"]), "", "att/x.MD"), null);
});

test("findAttachment: NFC and NFD and case compare equal, and the path on disk comes back", () => {
  assert.deepEqual(findAttachment(indexFiles(["Café/X.png"]), "", "café/x.PNG"), { file: "Café/X.png" });
});

test("findAttachment: two files equal under case folding are several, as on a case-sensitive disk", () => {
  assert.deepEqual(findAttachment(indexFiles(["a/x.png", "A/x.png"]), "", "a/x.png"), { several: ["a/x.png", "A/x.png"] });
});

// ---- AC42

test("AC42: a same-looking path that finds another file stays", () => {
  assertStays(attRename(["att/shot.png", "other/att/shot.png"]), "other/x.md", "![[att/shot.png]] ![](att/shot.png)");
});

test("AC42: a web URL and an absolute path stay", () => {
  assertStays(attRename(["att/shot.png"]), "h.md", "![](https://x.dev/att/shot.png) ![](/att/shot.png) ![[/att/shot.png]]");
});

test("AC42: a bare name stays, also with ./ or ../", () => {
  assertStays(attRename(["att/shot.png"]), "h.md", "![[shot.png]] ![](shot.png) ![](./shot.png) ![](../shot.png)");
});

test("AC42: a path below the renamed folder, in a note inside it, stays", () => {
  assertStays(renameDir("docs", "papers", ["docs/x.md"], ["docs/att/shot.png"]), "docs/x.md", "![](att/shot.png) ![[att/shot.png]]");
});

test("AC42: a link resolve() sends to a note stays", () => {
  const notes = ["h.md", "x/shot.png.md"];
  assertStays(renameDir("att", "media", notes, ["att/shot.png"]), "h.md", "[[att/shot.png]]");
  assertStays(renameDir("att", "media", ["h.md", "x/foo.md"], ["att/foo"]), "h.md", "[t](att/foo)");
});

// ---- AC43

test("AC43: a changed attachment link keeps everything except the folder part", () => {
  assertRewrites(attRename(["att/s.png", "att/f.pdf"]), "h.md",
    "![[att/s.png|300]] ![[att/f.pdf#page=2]] [[att/f.pdf#page=2|the file]]\r\n![alt [x]](att/s.png \"T\") [p](att/f.pdf#page=2)\r\n",
    "![[media/s.png|300]] ![[media/f.pdf#page=2]] [[media/f.pdf#page=2|the file]]\r\n![alt [x]](media/s.png \"T\") [p](media/f.pdf#page=2)\r\n",
    { changed: 5 });
});

test("AC43: code, frontmatter and reference definitions stay", () => {
  const text = "---\nup: ![[att/s.png]]\n---\n```\n![[att/s.png]]\n```\n`![](att/s.png)`\n[id]: att/s.png\n";
  assertStays(attRename(["att/s.png"]), "h.md", text);
});

// ---- AC44

test("AC44: a space and parens in the new folder are encoded in a Markdown link", () => {
  assertRewrites(renameDir("att", "my (m)", ["h.md"], ["att/s.png"]), "h.md", "![](att/s.png)", "![](my%20%28m%29/s.png)");
});

test("AC44: a wikilink holds a space and parens raw", () => {
  assertRewrites(renameDir("att", "my (m)", ["h.md"], ["att/s.png"]), "h.md", "![[att/s.png]]", "![[my (m)/s.png]]");
});

test("AC44: a path that was encoded stays encoded", () => {
  assertRewrites(renameDir("my att", "my media", ["h.md"], ["my att/a b.png"]), "h.md", "![](my%20att/a%20b.png)", "![](my%20media/a%20b.png)");
});

test("AC44: # and | in the new folder stay and fail in a wikilink", () => {
  assertFails(renameDir("att", "a#b", ["h.md"], ["att/s.png"]), "h.md", "![[att/s.png]]");
  assertFails(renameDir("att", "a|b", ["h.md"], ["att/s.png"]), "h.md", "![[att/s.png]]");
});

test("AC44: # in the new folder stays and fails in a Markdown link, and | changes it", () => {
  assertFails(renameDir("att", "a#b", ["h.md"], ["att/s.png"]), "h.md", "![](att/s.png)");
  assertRewrites(renameDir("att", "a|b", ["h.md"], ["att/s.png"]), "h.md", "![](att/s.png)", "![](a|b/s.png)");
});

test("AC44: a kept form that finds another file after the rename uses the root form", () => {
  const rename = renameDir("z/att", "z/media", ["h.md"], ["media/s.png", "z/att/s.png"]);
  assertRewrites(rename, "h.md", "![[att/s.png]]", "![[z/media/s.png]]");
});

test("AC44: when no form finds the file, the link stays and fails", () => {
  assertFails(renameDir("z/att", "z/media", ["q/h.md"], ["q/z/media/s.png", "z/att/s.png"]), "q/h.md", "![[z/att/s.png]]");
});

const ATTACHMENT_AGREEMENT = [
  ["wikilink", "att", "my media", "h.md", "![[att/s.png]]", "att/s.png", "my media/s.png", /\[\[(.*)\]\]/],
  ["encoded Markdown", "att", "my (m)", "h.md", "![](att/s.png)", "att/s.png", "my (m)/s.png", /\]\((.*)\)/],
  ["../ from a note", "att", "50%", "n/h.md", "![](../att/s.png)", "att/s.png", "50%/s.png", /\]\((.*)\)/],
  ["holder in the folder", "att", "media", "att/h.md", "![[att/s.png]]", "att/s.png", "media/s.png", /\[\[(.*)\]\]/],
  ["path ending", "z/att", "z/media", "h.md", "![](att/s.png)", "z/att/s.png", "z/media/s.png", /\]\((.*)\)/],
];

for (const [name, from, to, holder, text, file, goal, written] of ATTACHMENT_AGREEMENT) {
  test(`AC44 agreement: ${name}: the changed link finds the new path by the AC41 order`, () => {
    const out = rewrite(renameDir(from, to, [holder], [file]), holder, text);
    assert.equal(out.changed, 1);
    const target = text.includes("[[") ? out.text.match(written)[1] : linkTarget(out.text.match(written)[1]);
    const holderNew = holder.startsWith(`${from}/`) ? `${to}${holder.slice(from.length)}` : holder;
    const dir = holderNew.includes("/") ? holderNew.slice(0, holderNew.lastIndexOf("/")) : "";
    assert.deepEqual(findAttachment(indexFiles([goal]), dir, target), { file: goal });
  });
}

// ---- AC45

test("AC45: a note rename changes no attachment link, also from the renamed note", () => {
  const rename = { from: "Old.md", to: "New.md", isDir: false, notes: ["Old.md", "h.md"], files: ["att/s.png"] };
  assertStays(rename, "Old.md", "![[att/s.png]] ![](att/s.png) [[att/s.png]] ![](../att/s.png)");
  assertStays(rename, "h.md", "![[att/s.png]]");
});

// ---- files: null

test("AC46: files null changes no attachment link, and note links still change", () => {
  const rename = renameDir("att", "media", ["att/n.md", "h.md"], null);
  assertRewrites(rename, "h.md", "![[att/s.png]] ![](att/s.png) [[att/n]]", "![[att/s.png]] ![](att/s.png) [[media/n]]");
});

// ---- utf8Length

test("utf8Length counts 1, 2, 3 and 4 byte characters", () => {
  assert.equal(utf8Length(""), 0);
  assert.equal(utf8Length("abc\n"), 4);
  assert.equal(utf8Length("é"), 2);
  assert.equal(utf8Length("€"), 3);
  assert.equal(utf8Length("\u{1F600}"), 4);
});

test("utf8Length agrees with the bytes of a mixed text", () => {
  const text = "aé€\u{1F600}\r\n﻿z߿ࠀ￿\u{10000}";
  assert.equal(utf8Length(text), Buffer.byteLength(text, "utf8"));
});
