import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TEXT_MENU, MAX_SEND_TEXT, textMenuItems, textMenuSize, lineAt, lineSpan, pathRef, sendBlock, selectionOf, fenceOf,
  editorMenu, readMenu, diffLineAt, hunkLine, hunkPatch, diffMenu, pendingTextAction,
} from "../mods/herdsidian/text-menu.js";
import { unifiedRows, splitRows, wrapRows } from "../mods/herdsidian/diff.js";
import { placeMenu } from "../mods/herdsidian/actions.js";

const ids = (items) => items.map((r) => (r.sep ? "-" : r.id));
const live = (items) => items.filter((r) => !r.sep && !r.disabled).map((r) => r.id);

// Rows
test("each surface has its rows in order, with one separator", () => {
  assert.deepEqual(ids(textMenuItems("read", [])), ["copy", "copy-md", "send", "-", "copy-path", "edit"]);
  assert.deepEqual(ids(textMenuItems("edit", [])), ["cut", "copy", "paste", "select-all", "-", "send", "copy-path"]);
  assert.deepEqual(ids(textMenuItems("file", [])), ["copy", "select-all", "-", "copy-ref", "copy-rel", "copy-path", "send"]);
  assert.deepEqual(ids(textMenuItems("diff", [])), ["copy-line", "copy-hunk", "-", "copy-ref", "copy-path", "open-files"]);
  assert.deepEqual(textMenuItems("nope", []), []);
});

test("rows that do not apply stay in the menu, disabled; hidden rows go", () => {
  const items = textMenuItems("diff", ["copy-path"], ["open-files"]);
  assert.deepEqual(ids(items), ["copy-line", "copy-hunk", "-", "copy-ref", "copy-path"]);
  assert.deepEqual(live(items), ["copy-path"]);
  assert.equal(items[0].label, "Copy line");
  assert.equal(textMenuItems("edit", [])[0].keys, "⌘X");
});

test("the size counts rows and separators; placeMenu takes it", () => {
  const items = textMenuItems("read", []);
  const size = textMenuSize(items);
  assert.deepEqual(size, { width: TEXT_MENU.width, height: 5 * TEXT_MENU.row + TEXT_MENU.sep + TEXT_MENU.pad });
  const r = placeMenu({ x: 1435, y: 880 }, 0, { width: 1440, height: 900 }, 1, size);
  assert.equal(r.width, size.width);
  assert.equal(r.height, size.height);
  assert.equal(r.at.x, 1440 - size.width - 8);
  assert.equal(r.at.y, 900 - size.height - 8);
  // Without a size it is the tree menu as before.
  assert.deepEqual(placeMenu({ x: 100, y: 200 }, 4, { width: 1440, height: 900 }), { at: { x: 100, y: 200 }, width: 180, height: 130 });
});

// Lines
test("lineAt and lineSpan count 1-based lines; an end right after a newline stays on its line", () => {
  const text = "a\nbb\nccc\n";
  assert.equal(lineAt(text, 0), 1);
  assert.equal(lineAt(text, 2), 2);
  assert.equal(lineAt(text, 99), 4);
  assert.deepEqual(lineSpan(text, { start: 2, end: 4 }), { from: 2, to: 2 });
  assert.deepEqual(lineSpan(text, { start: 2, end: 5 }), { from: 2, to: 2 });
  assert.deepEqual(lineSpan(text, { start: 2, end: 7 }), { from: 2, to: 3 });
  assert.deepEqual(lineSpan(text, { start: 7, end: 2 }), { from: 2, to: 3 });
  assert.deepEqual(lineSpan(text, { start: 5, end: 5 }), { from: 3, to: 3 });
});

test("pathRef names one line or a range", () => {
  assert.equal(pathRef("a.js", null), "a.js");
  assert.equal(pathRef("a.js", { from: 3, to: 3 }), "a.js:3");
  assert.equal(pathRef("a.js", { from: 3, to: 9 }), "a.js:3-9");
});

test("sendBlock fences code past its own backticks and cuts a long selection", () => {
  assert.equal(sendBlock("a.md", "hi"), "From a.md:\n\nhi");
  assert.equal(sendBlock("a.js:2", "x", "js"), "a.js:2\n```js\nx\n```");
  assert.equal(sendBlock("a.md:1", "```\ny\n```", "md"), "a.md:1\n````md\n```\ny\n```\n````");
  const long = sendBlock("a", "x".repeat(MAX_SEND_TEXT + 5));
  assert.ok(long.endsWith(`… (cut at ${MAX_SEND_TEXT} characters)`));
  assert.ok(long.length < MAX_SEND_TEXT + 60);
});

test("selectionOf never throws; fenceOf is the file's extension", () => {
  assert.deepEqual(selectionOf({ selected_range: () => ({ start: 1, end: 3 }) }), { start: 1, end: 3 });
  assert.deepEqual(selectionOf({ selected_range: () => { throw new Error("no"); } }), { start: 0, end: 0 });
  assert.deepEqual(selectionOf({}), { start: 0, end: 0 });
  assert.equal(fenceOf("src/a.TS"), "ts");
  assert.equal(fenceOf("Makefile"), "");
  assert.equal(fenceOf(".env"), "");
});

// Editor and read menus
test("the note editor: paste and select all always; cut, copy and send only with a selection", () => {
  const none = editorMenu({ surface: "edit", value: "one\ntwo", range: { start: 2, end: 2 }, path: "/v/n.md" });
  assert.deepEqual(live(none.items).sort(), ["copy-path", "paste", "select-all"]);
  const some = editorMenu({ surface: "edit", value: "one\ntwo", range: { start: 4, end: 7 }, path: "/v/n.md" });
  assert.deepEqual(live(some.items).sort(), ["copy", "copy-path", "cut", "paste", "select-all", "send"]);
  assert.equal(some.texts.copy, "two");
  assert.equal(some.texts.send, "From /v/n.md:2:\n\ntwo");
  // Whitespace alone is no selection.
  assert.equal(editorMenu({ surface: "edit", value: "a  b", range: { start: 1, end: 3 }, path: "/p" }).texts.copy, undefined);
});

test("the Files preview: path:line from the selection or the cursor, the relative path only below the root", () => {
  const m = editorMenu({ surface: "file", value: "l1\nl2\nl3\n", range: { start: 3, end: 8 }, path: "/r/src/a.js", rel: "src/a.js", language: "js" });
  assert.equal(m.texts["copy-ref"], "src/a.js:2-3");
  assert.equal(m.texts["copy-rel"], "src/a.js");
  assert.equal(m.texts["copy-path"], "/r/src/a.js");
  assert.equal(m.texts.send, "src/a.js:2-3\n```js\nl2\nl3\n```");
  assert.ok(!live(m.items).includes("cut") && !live(m.items).includes("paste"));
  const cursor = editorMenu({ surface: "file", value: "l1\nl2", range: { start: 4, end: 4 }, path: "/r/a", rel: "a" });
  assert.equal(cursor.texts["copy-ref"], "a:2");
  assert.deepEqual(live(cursor.items).sort(), ["copy-path", "copy-ref", "copy-rel", "select-all"]);
  const outside = editorMenu({ surface: "file", value: "x", range: { start: 0, end: 1 }, path: "/elsewhere/x.txt", rel: null });
  assert.ok(!ids(outside.items).includes("copy-rel"));
  assert.equal(outside.texts["copy-ref"], "/elsewhere/x.txt:1");
});

test("the rendered note: copy as Markdown slices the source the view rendered", () => {
  const markdown = "Some **bold** text";
  const m = readMenu({ selection: { text: "bold", range: { start: 5, end: 13 } }, markdown, path: "/v/n.md" });
  assert.equal(m.texts.copy, "bold");
  assert.equal(m.texts["copy-md"], "**bold**");
  assert.equal(m.texts.send, "From /v/n.md:\n\nbold");
  assert.deepEqual(live(m.items).sort(), ["copy", "copy-md", "copy-path", "edit", "send"]);
  const plain = readMenu({ selection: { text: "bold" }, markdown, path: "/v/n.md" });
  assert.equal(plain.texts["copy-md"], undefined);
  const none = readMenu({ selection: null, markdown, path: "/v/n.md" });
  assert.deepEqual(live(none.items).sort(), ["copy-path", "edit"]);
  // A range past the source (a stale one) copies no Markdown; Copy still works.
  const bad = readMenu({ selection: { text: "x", range: { start: 0, end: 99 } }, markdown, path: "/p" });
  assert.equal(bad.texts["copy-md"], undefined);
  assert.equal(bad.texts.copy, "x");
});

// Diff
const hunks = [
  { oldStart: 3, oldCount: 3, newStart: 3, newCount: 3, section: " function f()", lines: [
    { kind: "context", old: 3, new: 3, text: "keep" },
    { kind: "del", old: 4, new: null, text: "old line" },
    { kind: "add", old: null, new: 4, text: "new line" },
    { kind: "context", old: 5, new: 5, text: "tail" },
  ] },
  { oldStart: 20, oldCount: 1, newStart: 20, newCount: 2, section: "", lines: [
    { kind: "context", old: 20, new: 20, text: "x" },
    { kind: "add", old: null, new: 21, text: "y".repeat(30) },
    { kind: "note", old: null, new: null, text: "\\ No newline at end of file" },
  ] },
];

test("diffLineAt maps a unified row (and a wrapped piece) to its hunk line", () => {
  const rows = wrapRows(unifiedRows(hunks), "unified", 10);
  assert.equal(diffLineAt(rows, 0), null); // hunk title
  assert.deepEqual(diffLineAt(rows, 2), { hunk: 0, kind: "del", old: 4, new: null });
  const last = rows.findLastIndex((r) => r.type === "line");
  assert.ok(rows[last].cont, "the long add line wraps");
  const at = diffLineAt(rows, last);
  assert.deepEqual(at, { hunk: 1, kind: "add", old: null, new: 21 });
  assert.equal(hunkLine(hunks, at).text, "y".repeat(30));
  assert.equal(diffLineAt(rows, rows.length - 1), null); // the note
});

test("diffLineAt reads the side under the pointer in split", () => {
  const rows = splitRows(hunks);
  const pair = rows.findIndex((r) => r.left?.kind === "del");
  assert.deepEqual(diffLineAt(rows, pair, "left"), { hunk: 0, kind: "del", old: 4, new: null });
  assert.deepEqual(diffLineAt(rows, pair, "right"), { hunk: 0, kind: "add", old: null, new: 4 });
  assert.equal(hunkLine(hunks, diffLineAt(rows, pair, "left")).text, "old line");
});

test("hunkPatch writes a patch with counts from its own lines", () => {
  assert.equal(hunkPatch("a.js", null, hunks[0]),
    "--- a/a.js\n+++ b/a.js\n@@ -3,3 +3,3 @@ function f()\n keep\n-old line\n+new line\n tail\n");
  assert.equal(hunkPatch("b.js", "old.js", hunks[1]),
    `--- a/old.js\n+++ b/b.js\n@@ -20,1 +20,2 @@\n x\n+${"y".repeat(30)}\n\\ No newline at end of file\n`);
  const capped = { ...hunks[0], lines: hunks[0].lines.slice(0, 2) };
  assert.ok(hunkPatch("a.js", null, capped).includes("@@ -3,2 +3,1 @@"));
});

test("diffMenu: line rows copy the line, title rows the hunk; Open in Files only where it can", () => {
  const rows = unifiedRows(hunks);
  const m = diffMenu({ rows, hunks, index: 3, side: "right", path: "src/a.js", full: "/r/src/a.js", canOpen: true });
  assert.equal(m.texts["copy-line"], "new line");
  assert.equal(m.texts["copy-ref"], "src/a.js:4");
  assert.equal(m.texts["copy-path"], "/r/src/a.js");
  assert.ok(m.texts["copy-hunk"].startsWith("--- a/src/a.js"));
  assert.deepEqual(live(m.items).sort(), ["copy-hunk", "copy-line", "copy-path", "copy-ref", "open-files"]);
  const title = diffMenu({ rows, hunks, index: 5, side: "right", path: "src/a.js", canOpen: false });
  assert.ok(title.texts["copy-hunk"].includes("@@ -20,1 +20,2 @@"));
  assert.equal(title.texts["copy-line"], undefined);
  assert.equal(title.texts["copy-path"], "src/a.js");
  assert.ok(!ids(title.items).includes("open-files"));
});

// Requests
test("a request runs once, while fresh, for an op Notes knows", () => {
  const now = 10_000;
  assert.deepEqual(pendingTextAction(null, null, now), { run: false, id: null });
  assert.deepEqual(pendingTextAction({ id: "a", at: now - 100, op: "paste" }, null, now), { run: true, id: "a" });
  assert.deepEqual(pendingTextAction({ id: "a", at: now - 100, op: "paste" }, "a", now), { run: false, id: "a" });
  assert.deepEqual(pendingTextAction({ id: "b", at: now - 6000, op: "paste" }, null, now), { run: false, id: "b" });
  assert.deepEqual(pendingTextAction({ id: "c", at: now, op: "copy" }, null, now), { run: false, id: "c" });
  assert.deepEqual(pendingTextAction({ id: "d", op: "cut" }, null, now), { run: false, id: "d" });
});

// Review finding 1: in split, the left cell's number is the OLD line, also for context lines.
const shifted = [{ oldStart: 10, oldCount: 3, newStart: 12, newCount: 3, section: "", lines: [
  { kind: "context", old: 10, new: 12, text: "A" },
  { kind: "context", old: 11, new: 13, text: "B" },
  { kind: "context", old: 12, new: 14, text: "C".repeat(30) },
] }];

test("split: a context line reads the same line from either side when old and new numbers differ", () => {
  const rows = splitRows(shifted);
  for (const side of ["left", "right"]) {
    for (const [i, text] of [[1, "A"], [2, "B"]]) {
      const m = diffMenu({ rows, hunks: shifted, index: i, side, path: "p", canOpen: false });
      assert.equal(m.texts["copy-line"], text, `${side} ${text}`);
      assert.equal(m.texts["copy-ref"], `p:${i + 11}`, "path:line is the new file's line");
    }
  }
  assert.deepEqual(diffLineAt(rows, 1, "left"), { hunk: 0, kind: "context", old: 10, new: null });
});

test("split: a wrapped context cell on the left walks back to its line", () => {
  const rows = wrapRows(splitRows(shifted), "split", 10);
  const last = rows.length - 1;
  assert.ok(rows[last].left.cont, "the long line wraps");
  const m = diffMenu({ rows, hunks: shifted, index: last, side: "left", path: "p", canOpen: false });
  assert.equal(m.texts["copy-line"], "C".repeat(30));
  assert.equal(m.texts["copy-ref"], "p:14");
});

test("split: a filler side reads the other side's line", () => {
  const rows = splitRows([{ oldStart: 1, oldCount: 0, newStart: 2, newCount: 1, section: "", lines: [{ kind: "add", old: null, new: 2, text: "x" }] }]);
  const m = diffMenu({ rows, hunks: [{ oldStart: 1, oldCount: 0, newStart: 2, newCount: 1, section: "", lines: [{ kind: "add", old: null, new: 2, text: "x" }] }],
    index: 1, side: "left", path: "p", canOpen: false });
  assert.equal(m.texts["copy-line"], "x");
});

// Review finding 7: a deleted line is not in the file as it is now.
test("a deleted line copies its text but offers no path:line", () => {
  const rows = unifiedRows(hunks);
  const m = diffMenu({ rows, hunks, index: 2, side: "right", path: "src/a.js", canOpen: false });
  assert.equal(m.texts["copy-line"], "old line");
  assert.equal(m.texts["copy-ref"], undefined);
  assert.ok(m.items.find((r) => r.id === "copy-ref").disabled);
});

// Review finding 3: headers git applies.
test("hunkPatch: a new or deleted FILE is /dev/null; a side cut to 0 lines names the line before", () => {
  const added = { oldStart: 0, oldCount: 0, newStart: 1, newCount: 1, section: "", lines: [{ kind: "add", old: null, new: 1, text: "a" }] };
  assert.equal(hunkPatch("n.txt", null, added, "added"), "--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,1 @@\n+a\n");
  assert.equal(hunkPatch("n.txt", null, added, "untracked"), "--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,1 @@\n+a\n");
  // A tracked file that was empty gets content: same hunk numbers, but the file exists.
  assert.equal(hunkPatch("n.txt", null, added, "modified"), "--- a/n.txt\n+++ b/n.txt\n@@ -0,0 +1,1 @@\n+a\n");
  const deleted = { oldStart: 1, oldCount: 1, newStart: 0, newCount: 0, section: "", lines: [{ kind: "del", old: 1, new: null, text: "a" }] };
  assert.equal(hunkPatch("d.txt", null, deleted, "deleted"), "--- a/d.txt\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-a\n");
  // A tracked file emptied to 0 bytes stays a file.
  assert.equal(hunkPatch("d.txt", null, deleted, "modified"), "--- a/d.txt\n+++ b/d.txt\n@@ -1,1 +0,0 @@\n-a\n");
  // No commit yet: "AD" lists as added but the hunk deletes the whole file.
  assert.equal(hunkPatch("d.txt", null, deleted, "added"), "--- a/d.txt\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-a\n");
  // No commit yet: "AM" lists as added but the hunk is an edit against the index: a/ and b/.
  const edited = { oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, section: "", lines: [
    { kind: "del", old: 1, new: null, text: "a" }, { kind: "add", old: null, new: 1, text: "b" }] };
  assert.equal(hunkPatch("e.txt", null, edited, "added"), "--- a/e.txt\n+++ b/e.txt\n@@ -1,1 +1,1 @@\n-a\n+b\n");
  // A conflict that creates the file ("AA", "DU").
  assert.equal(hunkPatch("n.txt", null, added, "conflict"), "--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,1 @@\n+a\n");
  const cut = { oldStart: 50, oldCount: 2, newStart: 50, newCount: 4, section: "", lines: [
    { kind: "add", old: null, new: 50, text: "x" }, { kind: "add", old: null, new: 51, text: "y" }] };
  assert.ok(hunkPatch("c.txt", null, cut).includes("@@ -49,0 +50,2 @@"));
});

test("a long send is cut without splitting an emoji", () => {
  const text = "a".repeat(MAX_SEND_TEXT - 1) + "😀" + "b";
  const out = sendBlock("p", text);
  assert.ok(!/[\ud800-\udbff]\n/.test(out), "no lone high surrogate before the note");
  assert.ok(out.includes("… (cut at"));
});
