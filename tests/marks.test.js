// Pure logic of the change marks: line diff, block split, block mapping, per-block render.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DIFF_CAP, blocksToMark, changeMarks, diffLines, renderBlock, splitBlocks, toLines } from "../mods/herdsidian/marks.js";
import { render } from "../mods/herdsidian/notes.js";

const split = (text) => splitBlocks(toLines(text)).map((b) => [b.start, b.end]);
const diff = (a, b, cap) => diffLines(toLines(a), toLines(b), cap);

// AC6
test("line endings and trailing end-of-file whitespace mark nothing", () => {
  assert.equal(changeMarks("a\nb\n", "a\r\nb\r\n"), null);
  assert.equal(changeMarks("a\r\nb\r\n", "a\nb\n"), null);
  assert.equal(changeMarks("a\nb", "a\nb\n\n  \n"), null);
  assert.equal(changeMarks("a\nb", "a\nb   \n"), null);
  assert.deepEqual(toLines("a\r\nb\r\n\r\n"), ["a", "b"]);
});

// AC17
test("diffLines reports added, modified and deleted lines on the new text", () => {
  assert.deepEqual(diff("a\nb\nc", "a\nb\nc\nd"), { changed: [3], deletions: [] });
  assert.deepEqual(diff("a\nb\nc", "a\nX\nc"), { changed: [1], deletions: [] }); // modified = added
  assert.deepEqual(diff("a\nb\nc", "a\nb\nX\nc"), { changed: [2], deletions: [] });
  assert.deepEqual(diff("a\nb\nc", "a\nc"), { changed: [], deletions: [1] });
  assert.deepEqual(diff("a\nb\nc", "a\nb"), { changed: [], deletions: [2] }); // at the end: past the last line
  assert.deepEqual(diff("a\nb\nc", "b\nc"), { changed: [], deletions: [0] });
  assert.deepEqual(diff("same", "same"), { changed: [], deletions: [] });
});

test("diffLines: a replaced run is changed lines, not a deletion", () => {
  assert.deepEqual(diff("a\nb\nc\nd", "a\nX\nY\nd"), { changed: [1, 2], deletions: [] });
  assert.deepEqual(diff("a\nb\nc\nd\ne", "a\nX\nd\nY\ne"), { changed: [1, 3], deletions: [] });
});

test("diffLines: a deleted line and an added line apart are one deletion point and one change", () => {
  assert.deepEqual(diff("a\nb\nc\nd\ne", "a\nc\nd\nX\ne"), { changed: [3], deletions: [1] });
});

test("diffLines trims the common first and last lines, and stops at the cap", () => {
  const old = Array.from({ length: 3000 }, (_, i) => `o${i}`).join("\n");
  const next = Array.from({ length: 3000 }, (_, i) => `n${i}`).join("\n");
  // 9,000,000 pairs: over the cap, so every new line is changed, with no diff run.
  assert.equal(3000 * 3000 > DIFF_CAP, true);
  assert.equal(diff(old, next).changed.length, 3000);
  // The same two notes with one changed line in the middle trim down to nothing to compare.
  const lines = old.split("\n");
  const edited = [...lines.slice(0, 1500), "CHANGED", ...lines.slice(1501)].join("\n");
  assert.deepEqual(diff(old, edited), { changed: [1500], deletions: [] });
  // A small cap forces the same all-changed answer for a small diff.
  assert.deepEqual(diff("a\nb\nc\nd", "a\nX\nY\nd", 3), { changed: [1, 2], deletions: [] });
  assert.deepEqual(diff("a\nb\nc\nd\ne", "a\nX\nd\nY\ne", 3), { changed: [1, 2, 3], deletions: [] });
});

test("DIFF_CAP is the spec value", () => {
  assert.equal(DIFF_CAP, 4_000_000);
});

test("splitBlocks: a fence at column 0 ends the list and runs to its closing fence, blank line inside", () => {
  const text = "- item\n```\ncode\n\nmore\n```\n\nAfter";
  assert.deepEqual(split(text), [[0, 1], [1, 6], [7, 8]]);
  assert.deepEqual(splitBlocks(toLines(text)).map((b) => b.kind), ["list", "fence", "text"]);
  // the fences do not pair off by one for the rest of the note
  const more = splitBlocks(toLines(`${text}\n\n\`\`\`\nx\n\`\`\`\n\nEnd`));
  assert.deepEqual(more.map((b) => b.kind), ["list", "fence", "text", "fence", "text"]);
});

test("splitBlocks: a fence with a blank line inside an indented list item stays in the item", () => {
  const text = "- item\n  ```\n  code\n\n  more\n  ```\n- next\n\nAfter";
  assert.deepEqual(split(text), [[0, 7], [8, 9]]);
  assert.deepEqual(splitBlocks(toLines(text)).map((b) => b.kind), ["list", "text"]);
  // also when the fence content is not indented
  assert.deepEqual(split("- item\n  ```\ncode\n\nmore\n  ```\n\nAfter"), [[0, 6], [7, 8]]);
});

test("splitBlocks: a fence indented in a list item after a blank line does not hide the next top-level fence", () => {
  const text = "- item\n\n  ```\n  a\n\n  b\n  ```\n\nText\n\n```\nx\n\ny\n```\n\nEnd";
  const lines = toLines(text);
  const blocks = splitBlocks(lines);
  assert.deepEqual(blocks.map((b) => b.kind), ["list", "text", "fence", "text"]);
  assert.deepEqual(blocks.map((b) => [b.start, b.end]), [[0, 7], [8, 9], [10, 15], [16, 17]]);
  for (const b of blocks) {
    const fences = renderBlock(lines, b).split("\n").filter((l) => /^\s*```/.test(l)).length;
    assert.equal(fences % 2, 0, `balanced fences in block ${b.start}`);
  }
});

test("changeMarks: rendered holds the Markdown of every block", () => {
  const m = changeMarks("A\n\nB", "A\n\nB2");
  assert.deepEqual(m.rendered, m.blocks.map((b) => renderBlock(m.lines, b)));
});

// AC14
test("splitBlocks: paragraphs end at a blank line; blank lines belong to no block", () => {
  assert.deepEqual(split("# Title\n\nOne\ntwo\n\n\nThree"), [[0, 1], [2, 4], [6, 7]]);
});

test("splitBlocks: frontmatter is one block", () => {
  assert.deepEqual(split("---\ntags: [a]\n\nk: v\n---\n\nText"), [[0, 5], [6, 7]]);
  assert.equal(splitBlocks(toLines("---\nk: v\n---\nText"))[0].kind, "frontmatter");
});

test("splitBlocks: a fence keeps its blank lines; an unclosed fence runs to the end", () => {
  assert.deepEqual(split("Text\n\n```js\na\n\nb\n```\n\nAfter"), [[0, 1], [2, 7], [8, 9]]);
  assert.deepEqual(split("```\na\n\nb"), [[0, 4]]);
  // Same character, at least the same length closes it; ``` inside ~~~ does not.
  assert.deepEqual(split("~~~\n```\n\n~~~\nx"), [[0, 4], [4, 5]]);
  assert.deepEqual(split("````\n```\n\n````\nx"), [[0, 4], [4, 5]]);
  // A fence right after a paragraph line starts its own block.
  assert.deepEqual(split("Text\n```\ncode\n```"), [[0, 1], [1, 4]]);
});

test("splitBlocks: a list is one block with blank lines between items and before indented lines", () => {
  const text = "1. one\n\n2. two\n   - nested\n\n   more\n\n3. three\n\nAfter";
  assert.deepEqual(split(text), [[0, 8], [9, 10]]);
  assert.deepEqual(split("- a\n- b\n\n* c\n\n+ d"), [[0, 6]]);
  assert.deepEqual(split("1) a\n2) b\n\nPara"), [[0, 2], [3, 4]]);
  assert.deepEqual(split("- a\nlazy\n\nPara"), [[0, 2], [3, 4]]);
});

test("splitBlocks: quote lines and table lines stay together", () => {
  assert.deepEqual(split("> a\n> b\n\n| h | i |\n|---|---|\n| 1 | 2 |\n\nx"), [[0, 2], [3, 6], [7, 8]]);
});

test("splitBlocks: a line indented by 4 or a tab after a blank line joins the block before", () => {
  assert.deepEqual(split("Text\n\n    indented\n\nNext"), [[0, 3], [4, 5]]);
  assert.deepEqual(split("Text\n\n\tindented\n\nNext"), [[0, 3], [4, 5]]);
  assert.deepEqual(split("Text\n\n   three spaces\n\nNext"), [[0, 1], [2, 3], [4, 5]]);
});

test("splitBlocks: an empty note has no blocks", () => {
  assert.deepEqual(splitBlocks(toLines("")), []);
  assert.deepEqual(splitBlocks(toLines("\n\n")), []);
});

const FIXTURE = [
  "---", "tags: [a]", "---", "", "# Heading", "", "1. one", "", "2. two", "   - nested", "", "3. three", "",
  "Between", "", "- x", "- y", "", "```js", "a", "", "b", "```", "", "| h | i |", "|---|---|", "| 1 | 2 |", "", "> quote", "", "Para [[Other]]",
].join("\n");

// AC18
test("changeMarks: one word changed in a list item marks the whole list", () => {
  const next = FIXTURE.replace("2. two", "2. TWO");
  const m = changeMarks(FIXTURE, next);
  assert.deepEqual(m.marked.map((i) => [m.blocks[i].start, m.blocks[i].end]), [[6, 12]]);
});

test("changeMarks: a line added inside a code fence marks the whole fence", () => {
  const m = changeMarks(FIXTURE, FIXTURE.replace("\nb\n", "\nb\nc\n"));
  assert.deepEqual(m.marked.map((i) => m.blocks[i].kind), ["fence"]);
});

test("changeMarks: a paragraph deleted between two paragraphs marks the paragraph after it", () => {
  const m = changeMarks("A\n\nB\n\nC", "A\n\nC");
  assert.deepEqual(m.marked.map((i) => [m.blocks[i].start, m.blocks[i].end]), [[2, 3]]);
});

test("changeMarks: a deletion at the end marks the last block; an emptied note marks nothing", () => {
  const m = changeMarks("A\n\nB\n\nC", "A\n\nB");
  assert.deepEqual(m.marked.map((i) => [m.blocks[i].start, m.blocks[i].end]), [[2, 3]]);
  assert.equal(changeMarks("A\n\nB", ""), null);
  assert.equal(changeMarks("A\n\nB", "\n\n"), null);
});

test("changeMarks: a changed frontmatter value marks the frontmatter block", () => {
  const m = changeMarks(FIXTURE, FIXTURE.replace("tags: [a]", "tags: [b]"));
  assert.deepEqual(m.marked.map((i) => m.blocks[i].kind), ["frontmatter"]);
});

// AC7
test("changeMarks: an added or changed blank line marks nothing", () => {
  assert.equal(changeMarks("A\n\nB", "A\n\n\n\nB"), null);
  assert.equal(changeMarks("A\n \nB", "A\n\t\nB"), null);
});

test("changeMarks: nothing changed gives no marks", () => {
  assert.equal(changeMarks(FIXTURE, FIXTURE), null);
});

// AC5 (S3), at the level of the pure function: the baseline stays, the newest text is diffed
test("changeMarks: against one baseline, marks accumulate and an undone change loses its mark", () => {
  const base = "A\n\nB\n\nC";
  const first = changeMarks(base, "A\n\nB2\n\nC");
  assert.deepEqual(first.marked, [1]);
  const second = changeMarks(base, "A\n\nB2\n\nC2");
  assert.deepEqual(second.marked, [1, 2]);
  const undone = changeMarks(base, "A\n\nB\n\nC2");
  assert.deepEqual(undone.marked, [2]);
  assert.equal(changeMarks(base, base), null);
});

test("blocksToMark takes block ranges, changed lines and deletion points", () => {
  const blocks = [{ start: 0, end: 2 }, { start: 3, end: 4 }];
  assert.deepEqual(blocksToMark(blocks, [1], []), [0]);
  assert.deepEqual(blocksToMark(blocks, [2], []), []); // a blank line
  assert.deepEqual(blocksToMark(blocks, [], [2]), [1]); // the point is blank: the next block
  assert.deepEqual(blocksToMark(blocks, [], [9]), [1]); // past the end: the last block
  assert.deepEqual(blocksToMark([], [], [0]), []);
});

// AC15
test("renderBlock is render() on the block's own lines: wikilinks, file embeds and inline code", () => {
  const lines = toLines("Para [[Other|alias]] ![[shot.png]] `[[code]]`\n\nNext");
  const [first] = splitBlocks(lines);
  assert.equal(renderBlock(lines, first), render("Para [[Other|alias]] ![[shot.png]] `[[code]]`"));
  assert.match(renderBlock(lines, first), /\[alias\]\(note:Other\)/);
});

test("renderBlock shows the frontmatter block as the same yaml code block as today", () => {
  const lines = toLines(FIXTURE);
  const [front] = splitBlocks(lines);
  assert.equal(renderBlock(lines, front), "```yaml\ntags: [a]\n```\n\n");
  assert.ok(render(FIXTURE).startsWith(renderBlock(lines, front)));
});

test("renderBlock does not read a rule-text-rule block as frontmatter", () => {
  const lines = toLines("Intro\n\n---\ntext\n---\n");
  const block = splitBlocks(lines).find((b) => lines[b.start] === "---");
  assert.equal(renderBlock(lines, block).includes("yaml"), false);
});

// AC16, the part a Node test can cover: the blocks together keep every source line of the fixture,
// and the numbered list is one block (its numbers 1, 2, 3 stay in one TextView).
test("every non-blank fixture line is in exactly one block; the numbered list is one block", () => {
  const lines = toLines(FIXTURE), blocks = splitBlocks(lines);
  lines.forEach((line, i) => {
    const holders = blocks.filter((b) => i >= b.start && i < b.end).length;
    assert.equal(holders, line.trim() === "" ? holders : 1, `line ${i}`);
    assert.ok(holders <= 1);
  });
  const numbered = blocks.find((b) => lines[b.start].startsWith("1. "));
  assert.deepEqual(lines.slice(numbered.start, numbered.end).filter((l) => /^\d\./.test(l)), ["1. one", "2. two", "3. three"]);
  assert.deepEqual(blocks.map((b) => b.kind), ["frontmatter", "text", "list", "text", "list", "fence", "text", "text", "text"]);
});
