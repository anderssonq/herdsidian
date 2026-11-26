// Changes V2, the pure view model: diff.js plus isBinaryPatch and capLines of changes.js. Written from the plan's contracts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { badgeOf, splitPath, maxChange, sizeBar, ago, neighbors, unifiedRows, viewMode, wrapRows, wrapCols, cellWidth, CHAR_W } from "../mods/herdsidian/diff.js";
import { isBinaryPatch, capLines } from "../mods/herdsidian/changes.js";
import * as diff from "../mods/herdsidian/diff.js";
import * as changes from "../mods/herdsidian/changes.js";
import { readFileSync } from "node:fs";
const line = (kind, old, nu, text) => ({ kind, old, new: nu, text });
const hunk = (lines, over = {}) => ({ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, section: "", lines, ...over });
const many = (n, prefix = "l") => Array.from({ length: n }, (_, i) => line("add", null, i + 1, `${prefix}${i}`));

test("AC7: badgeOf gives the letter and theme color of each of the 6 statuses", () => {
  const cases = { added: ["A", "ansi2"], untracked: ["A", "ansi2"], deleted: ["D", "ansi1"], conflict: ["U", "ansi1"], modified: ["M", "ansi3"], renamed: ["R", "ansi4"] };
  for (const [status, [letter, color]] of Object.entries(cases)) assert.deepEqual(badgeOf(status), { letter, color }, status);
});

test("AC6: splitPath splits the folder part and the name; a root file has no folder part", () => {
  assert.deepEqual(splitPath("src/ui/panel.js"), { dir: "src/ui/", name: "panel.js" });
  assert.deepEqual(splitPath("a/b.txt"), { dir: "a/", name: "b.txt" });
  assert.deepEqual(splitPath("README.md"), { dir: "", name: "README.md" });
});

test("AC8: maxChange is the largest add + del and counts null as 0", () => {
  assert.equal(maxChange([{ add: 3, del: 2 }, { add: null, del: null }, { add: 1, del: 10 }]), 11);
  assert.equal(maxChange([{ add: null, del: null }]), 0);
  assert.equal(maxChange([]), 0);
});

test("AC8: sizeBar fills ceil(5 * change / max) blocks and splits them green and red by round", () => {
  assert.deepEqual(sizeBar({ add: 10, del: 0 }, 10), { add: 5, del: 0 });
  assert.deepEqual(sizeBar({ add: 0, del: 10 }, 10), { add: 0, del: 5 });
  assert.deepEqual(sizeBar({ add: 3, del: 3 }, 12), { add: 2, del: 1 }); // filled 3, green round(1.5)
  assert.deepEqual(sizeBar({ add: 1, del: 1 }, 5), { add: 1, del: 1 }); // filled 2, one block each
});

test("AC8: with 2 or more filled blocks, a side that has lines gets at least 1 block", () => {
  assert.deepEqual(sizeBar({ add: 1, del: 99 }, 100), { add: 1, del: 4 });
  assert.deepEqual(sizeBar({ add: 99, del: 1 }, 100), { add: 4, del: 1 });
});

test("AC8: with 1 filled block the larger side gets it, and a tie is green", () => {
  assert.deepEqual(sizeBar({ add: 1, del: 0 }, 100), { add: 1, del: 0 });
  assert.deepEqual(sizeBar({ add: 0, del: 1 }, 100), { add: 0, del: 1 });
  assert.deepEqual(sizeBar({ add: 2, del: 1 }, 100), { add: 1, del: 0 });
  assert.deepEqual(sizeBar({ add: 1, del: 2 }, 100), { add: 0, del: 1 });
  assert.deepEqual(sizeBar({ add: 1, del: 1 }, 100), { add: 1, del: 0 });
});

test("AC8: untracked, binary and zero-change files get an empty bar; add + del never passes 5", () => {
  assert.deepEqual(sizeBar({ status: "untracked", add: null, del: null }, 10), { add: 0, del: 0 });
  assert.deepEqual(sizeBar({ status: "modified", add: null, del: null }, 10), { add: 0, del: 0 });
  assert.deepEqual(sizeBar({ status: "modified", add: 0, del: 0 }, 10), { add: 0, del: 0 });
  for (const add of [0, 1, 3, 7, 50, 100]) for (const del of [0, 1, 3, 7, 50, 100]) {
    const bar = sizeBar({ add, del }, 100);
    assert.ok(bar.add + bar.del <= 5, `${add}/${del}`);
  }
});

test("Q8: ago changes unit at each boundary", () => {
  const now = 10_000_000_000;
  const at = (ms) => ago(now - ms, now);
  assert.equal(at(0), "now");
  assert.equal(at(59_999), "now");
  assert.equal(at(60_000), "1 min ago");
  assert.equal(at(59 * 60_000 + 59_999), "59 min ago");
  assert.equal(at(60 * 60_000), "1 h ago");
  assert.equal(at(24 * 3_600_000 - 1), "23 h ago");
  assert.equal(at(24 * 3_600_000), "1 d ago");
  assert.equal(at(49 * 3_600_000), "2 d ago");
});

test("Q8: ago gives an empty text for a time that is not a number", () => {
  assert.equal(ago(Number.NaN, 1000), "");
  assert.equal(ago(undefined, 1000), "");
  assert.equal(ago("soon", 1000), "");
});

test("AC20: neighbors gives the row before and after, null at the ends", () => {
  const files = [{ path: "a" }, { path: "b" }, { path: "c" }];
  assert.deepEqual(neighbors(files, "a"), { index: 0, prev: null, next: "b" });
  assert.deepEqual(neighbors(files, "b"), { index: 1, prev: "a", next: "c" });
  assert.deepEqual(neighbors(files, "c"), { index: 2, prev: "b", next: null });
});

test("AC20: neighbors of a path not in the list has no index and no neighbors", () => {
  assert.deepEqual(neighbors([{ path: "a" }, { path: "b" }], "zzz"), { index: -1, prev: null, next: null });
  assert.deepEqual(neighbors([], "a"), { index: -1, prev: null, next: null });
});

test("AC25: unifiedRows gives a hunk title, numbered lines and a note row with no numbers", () => {
  const h = hunk([
    line("context", 10, 10, "keep"),
    line("del", 11, null, "old"),
    line("add", null, 11, "new"),
    { kind: "note", old: null, new: null, text: "\\ No newline at end of file" },
  ], { oldStart: 10, oldCount: 2, newStart: 10, newCount: 2, section: "export class X {" });
  const rows = unifiedRows([h]);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], { type: "hunk", title: "Line 10 · export class X {" });
  const shape = ({ type, kind, old, new: nu, text }) => ({ type, kind, old, new: nu, text });
  assert.deepEqual(shape(rows[1]), { type: "line", kind: "context", old: 10, new: 10, text: "keep" });
  assert.deepEqual(shape(rows[2]), { type: "line", kind: "del", old: 11, new: null, text: "old" });
  assert.deepEqual(shape(rows[3]), { type: "line", kind: "add", old: null, new: 11, text: "new" });
  assert.equal(rows[4].type, "note");
  assert.equal(rows[4].text, "\\ No newline at end of file");
});

test("AC25: unifiedRows titles a hunk with no section as just the line, and a second hunk gets its own row", () => {
  const rows = unifiedRows([
    hunk([line("context", 1, 1, "a")]),
    hunk([line("context", 40, 41, "b")], { oldStart: 40, newStart: 41 }),
  ]);
  assert.deepEqual(rows.filter((r) => r.type === "hunk"), [{ type: "hunk", title: "Line 1" }, { type: "hunk", title: "Line 41" }]);
});

test("AC28: viewMode follows the picked mode and the width", () => {
  assert.deepEqual(viewMode("split", 700), { mode: "split", note: false });
  assert.deepEqual(viewMode("split", 520), { mode: "split", note: false });
  assert.deepEqual(viewMode("split", 519), { mode: "unified", note: true });
  assert.deepEqual(viewMode("split", null), { mode: "unified", note: false });
  assert.deepEqual(viewMode("split", undefined), { mode: "unified", note: false });
  assert.deepEqual(viewMode("unified", 300), { mode: "unified", note: false });
  assert.deepEqual(viewMode("unified", 900), { mode: "unified", note: false });
});

test("AC30: capLines keeps all of 2000 lines", () => {
  const out = capLines([hunk(many(2000))]);
  assert.equal(out.total, 2000);
  assert.equal(out.shown, 2000);
  assert.equal(out.hunks[0].lines.length, 2000);
});

test("AC30: capLines cuts 2001 lines to 2000 and reports the total", () => {
  const out = capLines([hunk(many(2001))]);
  assert.equal(out.total, 2001);
  assert.equal(out.shown, 2000);
  assert.equal(out.hunks[0].lines.length, 2000);
  assert.equal(out.hunks[0].lines.at(-1).text, "l1999");
});

test("AC30: capLines cuts across two hunks and takes a custom max", () => {
  const out = capLines([hunk(many(1500, "a")), hunk(many(1000, "b"))]);
  assert.equal(out.total, 2500);
  assert.equal(out.shown, 2000);
  assert.equal(out.hunks[0].lines.length, 1500);
  assert.equal(out.hunks[1].lines.length, 500);
  const small = capLines([hunk(many(2)), hunk(many(2))], 3);
  assert.deepEqual([small.total, small.shown], [4, 3]);
});

test("AC30: MAX_LINES has one source: changes.js owns it and diff.js re-exports it", () => {
  assert.equal(typeof changes.MAX_LINES, "number");
  assert.equal(diff.MAX_LINES, changes.MAX_LINES);
  const source = readFileSync(new URL("../mods/herdsidian/diff.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bMAX_LINES\s*=/, "diff.js must not declare its own MAX_LINES");
  assert.match(source, /MAX_LINES[^;]*from\s+["']\.\/changes\.js["']/, "diff.js must import or re-export it from ./changes.js");
});

// The number column grows with the widest line number, so the wrap width follows it (AC25, AC31).
const uRow = (old, nu) => ({ type: "line", kind: "context", old, new: nu, text: "x" });
const pRow = (left, right) => ({ type: "pair", left: left === null ? null : { kind: "del", no: left, text: "x", word: null }, right: right === null ? null : { kind: "add", no: right, text: "x", word: null } });
const noise = [{ type: "hunk", title: "Line 1" }, { type: "note", text: "\\ No newline at end of file" }];
const colOf = (digits) => Math.ceil(digits * CHAR_W) + diff.NUM_PAD;

test("AC31: NUM_PAD and SIGN_W are exported as positive finite numbers", () => {
  for (const value of [diff.NUM_PAD, diff.SIGN_W]) assert.ok(Number.isFinite(value) && value > 0);
});

test("AC31: numWidth of unified rows follows the widest old or new number, at least 2 digits", () => {
  assert.equal(diff.numWidth([...noise, uRow(3, 3)]), colOf(2));
  assert.equal(diff.numWidth([...noise, uRow(99, 100)]), colOf(3));
  assert.equal(diff.numWidth([...noise, uRow(12345, 7)]), colOf(5));
  assert.equal(diff.numWidth([...noise, uRow(8, 123456)]), colOf(6));
  assert.equal(diff.numWidth([uRow(null, 99999), uRow(100000, null)]), colOf(6));
});

test("AC31: numWidth of split rows follows left.no and right.no, and ignores empty cells", () => {
  assert.equal(diff.numWidth([...noise, pRow(3, 3)]), colOf(2));
  assert.equal(diff.numWidth([...noise, pRow(12345, null), pRow(null, 4)]), colOf(5));
  assert.equal(diff.numWidth([...noise, pRow(null, 123456)]), colOf(6));
  assert.equal(diff.numWidth([pRow(1, 2), pRow(100000, 1)]), colOf(6));
});

test("AC31: numWidth of no rows, or rows with no numbers, is 2 digits", () => {
  assert.equal(diff.numWidth([]), colOf(2));
  assert.equal(diff.numWidth(noise), colOf(2));
});

test("AC31: gutter is one number column plus the sign in split, two plus the sign in unified", () => {
  const rows = [...noise, uRow(12345, 12345)];
  const split = [...noise, pRow(12345, 12345)];
  assert.equal(diff.gutter(split, "split"), colOf(5) + diff.SIGN_W);
  assert.equal(diff.gutter(rows, "unified"), 2 * colOf(5) + diff.SIGN_W);
  assert.equal(diff.gutter([], "split"), colOf(2) + diff.SIGN_W);
  assert.equal(diff.gutter([], "unified"), 2 * colOf(2) + diff.SIGN_W);
});

// AC31 (2026-11-26, scope change by Andersson): a long line wraps onto more rows of the same height; there is no pan.
const uLine = (kind, old, nu, text, word = null) => ({ type: "line", kind, old, new: nu, text, word });
const cell = (kind, no, text, word = null) => ({ kind, no, text, word });

test("AC31: wrapCols is the whole characters that fit, at least 1, and Infinity while the width is unknown", () => {
  assert.equal(wrapCols(null), Infinity);
  assert.equal(wrapCols(undefined), Infinity);
  assert.equal(wrapCols(0), 1);
  const cols = wrapCols(400);
  assert.ok(Number.isInteger(cols) && cols >= 1);
  assert.ok(cols * CHAR_W <= 400, "the cut text fits in the cell");
  assert.ok(wrapCols(800) > cols, "a wider cell holds more characters");
});

test("AC31: cellWidth is the area less the gutter in unified, and half the area less one number column in split", () => {
  const rows = [uRow(1, 1)];
  assert.equal(cellWidth(600, rows, "unified"), 600 - diff.gutter(rows, "unified"));
  const split = [pRow(1, 1)];
  assert.equal(cellWidth(601, split, "split"), 300 - diff.gutter(split, "split"));
});

test("AC31: unified: a long line becomes rows of at most cols characters; only the first keeps the numbers", () => {
  const rows = [{ type: "hunk", title: "Line 1" }, uLine("add", null, 7, "abcdefghij"), uLine("context", 8, 8, "xy")];
  const out = wrapRows(rows, "unified", 4);
  assert.deepEqual(out.map((r) => r.text ?? r.title), ["Line 1", "abcd", "efgh", "ij", "xy"]);
  assert.deepEqual([out[1].old, out[1].new, out[1].cont], [null, 7, undefined]);
  for (const r of out.slice(2, 4)) assert.deepEqual([r.type, r.kind, r.old, r.new, r.cont], ["line", "add", null, null, true]);
  assert.equal(out[4], rows[2], "a line that fits is kept as it is");
});

test("AC31: the changed-word range is cut with the line, and a piece with none of it has null", () => {
  const out = wrapRows([uLine("del", 3, null, "abcdefghij", [2, 6])], "unified", 4);
  assert.deepEqual(out.map((r) => r.word), [[2, 4], [0, 2], null]);
});

test("AC31: Infinity or lines that fit return the same rows", () => {
  const rows = [uLine("add", null, 1, "a".repeat(500))];
  assert.equal(wrapRows(rows, "unified", Infinity), rows);
  const short = [uLine("add", null, 1, "abc"), { type: "note", text: "\\ No newline at end of file" }];
  assert.deepEqual(wrapRows(short, "unified", 3), short);
});

test("AC31: split: a pair takes the rows of its longer side; the shorter side goes on with an empty cell of its kind", () => {
  const row = { type: "pair", left: cell("del", 4, "abcdefghij"), right: cell("add", 4, "abc") };
  const out = wrapRows([row], "split", 4);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((r) => r.left.text), ["abcd", "efgh", "ij"]);
  assert.deepEqual(out.map((r) => r.left.no), [4, null, null]);
  assert.deepEqual(out.map((r) => r.right.text), ["abc", "", ""]);
  assert.deepEqual(out.map((r) => r.right.no), [4, null, null]);
  assert.ok(out.slice(1).every((r) => r.left.cont && r.right.cont && r.left.kind === "del" && r.right.kind === "add"));
});

test("AC31: split: a side with no line stays null (the filler) on every row of the pair", () => {
  const out = wrapRows([{ type: "pair", left: null, right: cell("add", 9, "abcdefghij", [5, 10]) }], "split", 4);
  assert.equal(out.length, 3);
  assert.ok(out.every((r) => r.left === null));
  assert.deepEqual(out.map((r) => r.right.word), [null, [1, 4], [0, 2]]);
});

test("AC31: a cut never splits an emoji, and wide characters and tabs take more than one cell", () => {
  const emoji = wrapRows([uLine("add", null, 1, "abc\u{1F600}def")], "unified", 4).map((r) => r.text);
  assert.deepEqual(emoji, ["abc", "\u{1F600}de", "f"], "the emoji takes 2 cells and stays whole");
  const cjk = wrapRows([uLine("add", null, 1, "\u6f22\u5b57\u6f22\u5b57\u6f22")], "unified", 4).map((r) => r.text);
  assert.deepEqual(cjk, ["\u6f22\u5b57", "\u6f22\u5b57", "\u6f22"], "2 wide characters fill 4 cells");
  const tab = wrapRows([uLine("context", 1, 1, "\tab")], "unified", 4).map((r) => r.text);
  assert.deepEqual(tab, ["\t", "ab"], "a tab takes 4 cells");
  const short = wrapRows([uLine("add", null, 1, "\u6f22\u5b57\u6f22")], "unified", 4).map((r) => r.text);
  assert.deepEqual(short, ["\u6f22\u5b57", "\u6f22"], "3 units but 6 cells is still cut");
  const checks = wrapRows([uLine("add", null, 1, "\u2705\u2705\u2705\u2b50")], "unified", 4).map((r) => r.text);
  assert.deepEqual(checks, ["\u2705\u2705", "\u2705\u2b50"], "emoji symbols below U+1F300 take 2 cells");
  const word = wrapRows([uLine("add", null, 1, "ab\u{1F600}\u{1F600}cd", [2, 6])], "unified", 4).map((r) => [r.text, r.word]);
  assert.deepEqual(word, [["ab\u{1F600}", [2, 4]], ["\u{1F600}cd", [0, 2]]], "the word range is cut on code-point edges");
  const one = wrapRows([uLine("add", null, 1, "\u6f22")], "unified", 1).map((r) => r.text);
  assert.deepEqual(one, ["\u6f22"], "a piece holds at least one character, even when it is wider than the cell");
});

test("AC31: hunk titles are never cut, and the unified rule does not touch split rows", () => {
  const rows = [{ type: "hunk", title: "x".repeat(50) }];
  assert.deepEqual(wrapRows(rows, "split", 4), rows);
  assert.deepEqual(wrapRows(rows, "unified", 4), rows);
});

test("AC35: isBinaryPatch is true for both git texts before the first hunk", () => {
  assert.equal(isBinaryPatch("diff --git a/x.png b/x.png\nindex 1..2 100644\nBinary files a/x.png and b/x.png differ\n"), true);
  assert.equal(isBinaryPatch("diff --git a/x.bin b/x.bin\nindex 1..2 100644\nGIT binary patch\nliteral 12\nzc$@\n"), true);
});

test("AC35: isBinaryPatch is false for a text patch and when the words sit inside a hunk", () => {
  assert.equal(isBinaryPatch(""), false);
  assert.equal(isBinaryPatch("diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-x\n+y\n"), false);
  assert.equal(isBinaryPatch("diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,2 +1,2 @@\n-Binary files a and b differ\n+GIT binary patch\n"), false);
});
