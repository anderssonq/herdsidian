// Changes V2, the diff row model (AC26, AC27): pairing of del and add runs, changed-word ranges, and the exact
// unified and split rows. A range is [start, end) in UTF-16 units, as String.prototype.slice reads it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wordRanges, unifiedRows, splitRows } from "../mods/herdsidian/diff.js";

// Line and hunk fixtures in the shape parseHunks gives (plan, `## Contracts`).
const ctx = (old, nu, text) => ({ kind: "context", old, new: nu, text });
const del = (old, text) => ({ kind: "del", old, new: null, text });
const add = (nu, text) => ({ kind: "add", old: null, new: nu, text });
const note = (text = "\\ No newline at end of file") => ({ kind: "note", old: null, new: null, text });
const hunk = (oldStart, newStart, lines, section = "") => ({
  oldStart, newStart, section, lines,
  oldCount: lines.filter((l) => l.kind === "context" || l.kind === "del").length,
  newCount: lines.filter((l) => l.kind === "context" || l.kind === "add").length,
});

// The word range of each unified line row, in order; a note row gives "note".
const words = (rows) => rows.filter((r) => r.type !== "hunk").map((r) => (r.type === "note" ? "note" : r.word));

// Split cells, short: [kind, no, text, word] or null for the filler.
const cell = (c) => (c === null ? null : [c.kind, c.no, c.text, c.word]);
const cells = (rows) => rows.filter((r) => r.type === "pair").map((r) => [cell(r.left), cell(r.right)]);

// --- Pairing (AC26) ---

test("AC26 pairing: a run of k = m pairs del i with add i", () => {
  const h = hunk(1, 1, [del(1, "a = 1"), del(2, "b = 1"), add(1, "a = 2"), add(2, "b = 2")]);
  assert.deepEqual(words(unifiedRows([h])), [[4, 5], [4, 5], [4, 5], [4, 5]]);
  assert.deepEqual(cells(splitRows([h])), [
    [["del", 1, "a = 1", [4, 5]], ["add", 1, "a = 2", [4, 5]]],
    [["del", 2, "b = 1", [4, 5]], ["add", 2, "b = 2", [4, 5]]],
  ]);
});

test("AC26 pairing: a run of k > m pairs the first m dels; the other dels get no word range", () => {
  const h = hunk(1, 1, [del(1, "a = 1"), del(2, "b = 1"), del(3, "c = 1"), add(1, "a = 2")]);
  assert.deepEqual(words(unifiedRows([h])), [[4, 5], null, null, [4, 5]]);
  assert.deepEqual(cells(splitRows([h])), [
    [["del", 1, "a = 1", [4, 5]], ["add", 1, "a = 2", [4, 5]]],
    [["del", 2, "b = 1", null], null],
    [["del", 3, "c = 1", null], null],
  ]);
});

test("AC26 pairing: a run of k < m pairs del 0 with add 0, not with a later add", () => {
  const h = hunk(1, 1, [del(1, "alpha = 1"), add(1, "alpha = 2"), add(2, "beta = 3")]);
  assert.deepEqual(words(unifiedRows([h])), [[8, 9], [8, 9], null]);
  assert.deepEqual(cells(splitRows([h])), [
    [["del", 1, "alpha = 1", [8, 9]], ["add", 1, "alpha = 2", [8, 9]]],
    [null, ["add", 2, "beta = 3", null]],
  ]);
});

test("AC26 pairing: a del run with no add gets no word range", () => {
  const h = hunk(1, 1, [ctx(1, 1, "keep"), del(2, "a = 1"), del(3, "b = 1"), ctx(4, 2, "tail")]);
  assert.deepEqual(words(unifiedRows([h])), [null, null, null, null]);
  assert.deepEqual(cells(splitRows([h])), [
    [["context", 1, "keep", null], ["context", 1, "keep", null]],
    [["del", 2, "a = 1", null], null],
    [["del", 3, "b = 1", null], null],
    [["context", 4, "tail", null], ["context", 2, "tail", null]],
  ]);
});

test("AC26 pairing: an add run with no del gets no word range", () => {
  const h = hunk(1, 1, [ctx(1, 1, "keep"), add(2, "a = 1"), add(3, "b = 1")]);
  assert.deepEqual(words(unifiedRows([h])), [null, null, null]);
  assert.deepEqual(cells(splitRows([h])), [
    [["context", 1, "keep", null], ["context", 1, "keep", null]],
    [null, ["add", 2, "a = 1", null]],
    [null, ["add", 3, "b = 1", null]],
  ]);
});

test("AC26 pairing: two runs in one hunk pair inside each run only", () => {
  const h = hunk(1, 1, [
    del(1, "a = 1"), add(1, "a = 2"),
    ctx(2, 2, "keep"),
    del(3, "b = 3"), add(3, "b = 4"), add(4, "c = 5"),
  ]);
  assert.deepEqual(words(unifiedRows([h])), [[4, 5], [4, 5], null, [4, 5], [4, 5], null]);
  assert.deepEqual(cells(splitRows([h])), [
    [["del", 1, "a = 1", [4, 5]], ["add", 1, "a = 2", [4, 5]]],
    [["context", 2, "keep", null], ["context", 2, "keep", null]],
    [["del", 3, "b = 3", [4, 5]], ["add", 3, "b = 4", [4, 5]]],
    [null, ["add", 4, "c = 5", null]],
  ]);
});

test("AC26 pairing: a note line between the del and the add lines does not break the run", () => {
  const h = hunk(5, 5, [del(5, "x = 1"), note(), add(5, "x = 2")]);
  const unified = unifiedRows([h]);
  assert.deepEqual(unified.slice(1), [
    { type: "line", kind: "del", old: 5, new: null, text: "x = 1", word: [4, 5] },
    { type: "note", text: "\\ No newline at end of file" },
    { type: "line", kind: "add", old: null, new: 5, text: "x = 2", word: [4, 5] },
  ]);
  // The notes of a run come after its rows, on their own side.
  assert.deepEqual(cells(splitRows([h])), [
    [["del", 5, "x = 1", [4, 5]], ["add", 5, "x = 2", [4, 5]]],
    [["note", null, "\\ No newline at end of file", null], null],
  ]);
});

// --- wordRanges (AC26) ---

test("AC26 wordRanges: a change in the middle", () => {
  assert.deepEqual(wordRanges("const a = 1;", "const a = 2;"), { del: [10, 11], add: [10, 11] });
});

test("AC26 wordRanges: a change at the start", () => {
  assert.deepEqual(wordRanges("foo(x)", "bar(x)"), { del: [0, 3], add: [0, 3] });
});

test("AC26 wordRanges: a change at the end", () => {
  assert.deepEqual(wordRanges("let x = 1", "let x = 22"), { del: [8, 9], add: [8, 10] });
});

test("AC26 wordRanges: a pure insert leaves the other side null", () => {
  assert.deepEqual(wordRanges("call(a, b)", "call(a, x, b)"), { del: null, add: [8, 11] });
  assert.deepEqual(wordRanges("call(a, x, b)", "call(a, b)"), { del: [8, 11], add: null });
});

test("AC26 wordRanges: equal lines give null on both sides", () => {
  assert.deepEqual(wordRanges("same text", "same text"), { del: null, add: null });
});

test("AC26 wordRanges: the prefix and the suffix do not overlap (aaa to aaaa)", () => {
  assert.deepEqual(wordRanges("aaa", "aaaa"), { del: null, add: [3, 4] });
  assert.deepEqual(wordRanges("aaaa", "aaa"), { del: [3, 4], add: null });
});

test("AC26 wordRanges: a range of exactly 70 % of its line keeps the word tint", () => {
  // Prefix "a", suffix "yz": 7 of 10 units on each side.
  assert.deepEqual(wordRanges("a1234567yz", "a7654321yz"), { del: [1, 8], add: [1, 8] });
});

test("AC26 wordRanges: a range just over 70 % of either line gives null on both sides", () => {
  // The del range is 7 of 10 (70 %), the add range 8 of 11 (73 %): neither line gets a word tint.
  assert.deepEqual(wordRanges("a1234567yz", "a76543210yz"), { del: null, add: null });
  assert.deepEqual(wordRanges("a76543210yz", "a1234567yz"), { del: null, add: null });
});

test("AC26 wordRanges: an emoji at the start of the range is not split (same high surrogate)", () => {
  // U+1F600 and U+1F603 share their first UTF-16 unit; the range starts before it, not between the two units.
  assert.deepEqual(wordRanges("x\u{1F600}y", "x\u{1F603}y"), { del: [1, 3], add: [1, 3] });
});

test("AC26 wordRanges: a combined pair at the end of the range is not split (same low surrogate)", () => {
  // U+1F600 and U+20600 share their second UTF-16 unit; the range ends after it, not between the two units.
  assert.deepEqual(wordRanges("x\u{1F600}y", "x\u{20600}y"), { del: [1, 3], add: [1, 3] });
});

test("AC26 wordRanges: an empty line", () => {
  assert.deepEqual(wordRanges("", ""), { del: null, add: null });
  // The whole add line changed: 100 % is over the limit, so neither side is tinted.
  assert.deepEqual(wordRanges("", "abc"), { del: null, add: null });
  assert.deepEqual(wordRanges("abc", ""), { del: null, add: null });
});

// --- splitRows (AC27) ---

const sample = hunk(10, 10, [
  ctx(10, 10, "start"),
  del(11, "let a = 1;"), del(12, "let b = 2;"),
  add(11, "let a = 5;"), add(12, "let b = 7;"), add(13, "let c = 3;"),
  ctx(13, 14, "middle"),
  del(14, "gone();"),
  ctx(15, 15, "end"),
], "function f() {");

test("AC27 splitRows: the exact rows of a hunk with context, a 2-del 3-add run and a 1-del run", () => {
  const C = (no, text) => ({ kind: "context", no, text, word: null });
  assert.deepEqual(splitRows([sample]), [
    { type: "hunk", title: "Line 10 · function f() {" },
    { type: "pair", left: C(10, "start"), right: C(10, "start") },
    { type: "pair", left: { kind: "del", no: 11, text: "let a = 1;", word: [8, 9] },
      right: { kind: "add", no: 11, text: "let a = 5;", word: [8, 9] } },
    { type: "pair", left: { kind: "del", no: 12, text: "let b = 2;", word: [8, 9] },
      right: { kind: "add", no: 12, text: "let b = 7;", word: [8, 9] } },
    { type: "pair", left: null, right: { kind: "add", no: 13, text: "let c = 3;", word: null } },
    { type: "pair", left: C(13, "middle"), right: C(14, "middle") },
    { type: "pair", left: { kind: "del", no: 14, text: "gone();", word: null }, right: null },
    { type: "pair", left: C(15, "end"), right: C(15, "end") },
  ]);
});

test("AC27 splitRows: a run of k del and m add lines takes max(k, m) rows", () => {
  const run = (k, m) => hunk(1, 1, [
    ...Array.from({ length: k }, (_, i) => del(i + 1, `old ${i}`)),
    ...Array.from({ length: m }, (_, i) => add(i + 1, `new ${i}`)),
  ]);
  for (const [k, m] of [[1, 1], [2, 3], [3, 2], [4, 0], [0, 4], [1, 5]]) {
    assert.equal(splitRows([run(k, m)]).filter((r) => r.type === "pair").length, Math.max(k, m), `k=${k} m=${m}`);
  }
});

test("AC27 splitRows: the missing side of a row is the null filler", () => {
  const rows = splitRows([sample]).filter((r) => r.type === "pair");
  assert.deepEqual(rows.map((r) => [r.left === null, r.right === null]), [
    [false, false], [false, false], [false, false], [true, false], [false, false], [false, true], [false, false],
  ]);
});

test("AC27 splitRows: a context line is in both cells with its old and its new number", () => {
  const h = hunk(40, 52, [ctx(40, 52, "same line")]);
  assert.deepEqual(splitRows([h]), [
    { type: "hunk", title: "Line 52" },
    { type: "pair", left: { kind: "context", no: 40, text: "same line", word: null },
      right: { kind: "context", no: 52, text: "same line", word: null } },
  ]);
});

test("AC27 splitRows: one full-width hunk row per hunk, before its lines", () => {
  const first = hunk(3, 3, [del(3, "a = 1"), add(3, "a = 2")], "init()");
  const second = hunk(30, 30, [ctx(30, 30, "z")]);
  const rows = splitRows([first, second]);
  assert.deepEqual(rows.map((r) => r.type), ["hunk", "pair", "hunk", "pair"]);
  assert.deepEqual(rows.filter((r) => r.type === "hunk"), [
    { type: "hunk", title: "Line 3 · init()" },
    { type: "hunk", title: "Line 30" },
  ]);
});

// --- unifiedRows (AC26) ---

test("AC26 unifiedRows carries the same word ranges as splitRows for the same pair", () => {
  const unified = unifiedRows([sample]);
  assert.deepEqual(unified, [
    { type: "hunk", title: "Line 10 · function f() {" },
    { type: "line", kind: "context", old: 10, new: 10, text: "start", word: null },
    { type: "line", kind: "del", old: 11, new: null, text: "let a = 1;", word: [8, 9] },
    { type: "line", kind: "del", old: 12, new: null, text: "let b = 2;", word: [8, 9] },
    { type: "line", kind: "add", old: null, new: 11, text: "let a = 5;", word: [8, 9] },
    { type: "line", kind: "add", old: null, new: 12, text: "let b = 7;", word: [8, 9] },
    { type: "line", kind: "add", old: null, new: 13, text: "let c = 3;", word: null },
    { type: "line", kind: "context", old: 13, new: 14, text: "middle", word: null },
    { type: "line", kind: "del", old: 14, new: null, text: "gone();", word: null },
    { type: "line", kind: "context", old: 15, new: 15, text: "end", word: null },
  ]);
  // Every split cell has the word of the unified row for the same line.
  const byLine = new Map(unified.filter((r) => r.type === "line" && r.kind !== "context")
    .map((r) => [`${r.kind}:${r.old ?? r.new}`, r.word]));
  for (const row of splitRows([sample]).filter((r) => r.type === "pair")) {
    for (const c of [row.left, row.right]) {
      if (c && c.kind !== "context") assert.deepEqual(c.word, byLine.get(`${c.kind}:${c.no}`), `${c.kind} ${c.no}`);
    }
  }
});
