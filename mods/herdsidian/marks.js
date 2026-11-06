// Change marks for the Notes read view: which blocks of the note an outside program changed.
// Pure (no Herdr or GPUI imports) so node tests can run it.

import { FRONTMATTER, render } from "./notes.js";

// Line pairs (old lines x new lines) above which the diff stops: every remaining new line counts as changed.
export const DIFF_CAP = 4_000_000;

// The lines of a note as compared and split: "\r" off each line end, trailing blank lines and the
// trailing whitespace of the last line dropped (so a line-ending or end-of-file change marks nothing).
export function toLines(text) {
  const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length) lines[lines.length - 1] = lines[lines.length - 1].trimEnd();
  return lines;
}

const FENCE_OPEN = /^ {0,3}(`{3,}(?![^\n]*`)|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`+|~+)[ \t]*$/;
const ITEM_FENCE_OPEN = /^[ \t]+(`{3,}(?![^\n]*`)|~{3,})/; // a fence inside a list item, any indent
const ITEM_FENCE_CLOSE = /^[ \t]*(`+|~+)[ \t]*$/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?: |\t|$)/;
const blank = (l) => l.trim() === "";

// Splits note lines into blocks: [{ start, end, kind }], 0-based start and exclusive end.
// Blank lines between blocks belong to none. Rules in order: frontmatter, fenced code, list, anything else.
export function splitBlocks(lines) {
  const blocks = [];
  let i = 0;
  const front = lines.length ? lines.join("\n").match(FRONTMATTER) : null;
  if (front) {
    const n = front[0].replace(/\r?\n$/, "").split("\n").length;
    blocks.push({ start: 0, end: n, kind: "frontmatter" });
    i = n;
  }
  const nextNonBlank = (from) => {
    let k = from;
    while (k < lines.length && blank(lines[k])) k++;
    return k;
  };
  while (i < lines.length) {
    if (blank(lines[i])) { i++; continue; }
    const start = i, open = lines[i].match(FENCE_OPEN);
    if (open) {
      let j = i + 1;
      for (; j < lines.length; j++) {
        const close = lines[j].match(FENCE_CLOSE);
        if (close && close[1][0] === open[1][0] && close[1].length >= open[1].length) { j++; break; }
      }
      blocks.push({ start, end: Math.min(j, lines.length), kind: "fence" });
      i = Math.min(j, lines.length);
      continue;
    }
    const list = LIST_ITEM.test(lines[i]);
    let j = i + 1;
    while (j < lines.length) {
      if (!blank(lines[j])) {
        // Fence rules come before list rules. A fence ends the paragraph above it, and a list when it
        // opens at under 2 spaces; deeper in a list item, it is part of the item up to its closing fence.
        if (FENCE_OPEN.test(lines[j]) && (!list || !/^ {2}/.test(lines[j]))) break;
        const inner = list && lines[j].match(ITEM_FENCE_OPEN);
        if (inner) {
          let k = j + 1;
          for (; k < lines.length; k++) {
            const close = lines[k].match(ITEM_FENCE_CLOSE);
            if (close && close[1][0] === inner[1][0] && close[1].length >= inner[1].length) break;
          }
          j = Math.min(k + 1, lines.length);
          continue;
        }
        j++;
        continue;
      }
      const k = nextNonBlank(j);
      if (k >= lines.length) break;
      const next = lines[k];
      const joins = list ? /^[ \t]/.test(next) || LIST_ITEM.test(next) : /^(?: {4,}|\t)/.test(next);
      if (!joins) break;
      j = k; // line k goes through the fence checks above
    }
    blocks.push({ start, end: j, kind: list ? "list" : "text" });
    i = j;
  }
  return blocks;
}

// The line diff of two notes' lines, on the new lines: { changed, deletions }.
// changed: sorted indexes of new lines the old text does not have. deletions: indexes of the new line
// right after a run of removed lines that nothing replaced (may equal newLines.length).
export function diffLines(oldLines, newLines, cap = DIFF_CAP) {
  const na = oldLines.length, nb = newLines.length;
  let p = 0;
  while (p < na && p < nb && oldLines[p] === newLines[p]) p++;
  let s = 0;
  while (s < na - p && s < nb - p && oldLines[na - 1 - s] === newLines[nb - 1 - s]) s++;
  const A = oldLines.slice(p, na - s), B = newLines.slice(p, nb - s);
  const changed = [], deletions = [];
  if (!A.length && !B.length) return { changed, deletions };
  if (A.length * B.length > cap) {
    for (let j = 0; j < B.length; j++) changed.push(p + j);
    return { changed, deletions };
  }
  const n = A.length, m = B.length, w = m + 1;
  // table[i * w + j]: length of the longest common run of lines of A[i..] and B[j..].
  const table = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * w + j] = A[i] === B[j] ? table[(i + 1) * w + j + 1] + 1 : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
    }
  }
  let i = 0, j = 0, removed = 0, added = 0;
  const flush = () => {
    if (removed && !added) deletions.push(p + j);
    removed = 0; added = 0;
  };
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { flush(); i++; j++; }
    else if (j >= m || (i < n && table[(i + 1) * w + j] >= table[i * w + j + 1])) { removed++; i++; }
    else { changed.push(p + j); added++; j++; }
  }
  flush();
  return { changed, deletions };
}

// The indexes of the blocks to mark: the block holding a changed line, and for a deletion point the
// block that now holds the line after the removed ones (the next block when that line is blank, the
// last block at the end of the note). Changed blank lines mark nothing.
export function blocksToMark(blocks, changed, deletions) {
  const marked = new Set();
  const at = (line) => blocks.findIndex((b) => line >= b.start && line < b.end);
  for (const line of changed) {
    const k = at(line);
    if (k >= 0) marked.add(k);
  }
  for (const line of deletions) {
    let k = blocks.findIndex((b) => b.end > line);
    if (k < 0) k = blocks.length - 1;
    if (k >= 0) marked.add(k);
  }
  return [...marked].sort((a, b) => a - b);
}

// What to mark in the current text against the baseline: { lines, blocks, marked, rendered } with `marked`
// the block indexes, or null when nothing is marked.
export function changeMarks(baseline, current) {
  const lines = toLines(current);
  const { changed, deletions } = diffLines(toLines(baseline), lines);
  if (!changed.length && !deletions.length) return null;
  const blocks = splitBlocks(lines);
  const marked = blocksToMark(blocks, changed, deletions);
  // `rendered`: each block's Markdown, made once here so a re-render does not render the blocks again.
  return marked.length ? { lines, blocks, marked, rendered: blocks.map((b) => renderBlock(lines, b)) } : null;
}

// The Markdown of one block, as render() makes it for the whole note. A block that only looks like
// frontmatter (a rule, text, a rule) gets a blank line first so render() does not read it as one.
export function renderBlock(lines, block) {
  const text = lines.slice(block.start, block.end).join("\n");
  return block.kind !== "frontmatter" && FRONTMATTER.test(text) ? render("\n" + text) : render(text);
}
