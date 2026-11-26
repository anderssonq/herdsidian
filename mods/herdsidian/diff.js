// The Changes tab's pure view model, with no Herdr or GPUI imports so it can be tested with node:
// list badges and size bars, the diff rows (unified and split, with changed-word ranges), the view mode and the wrap.
export const ROW_H = 20;
export const CODE_SIZE = 12;
export const CHAR_W = 7.68; // the advance of one monospace character at CODE_SIZE
// The cap lives with capLines; one source so the view's "first N lines" note cannot drift from it.
export { MAX_LINES } from "./changes.js";
export const NUM_PAD = 8; // the number column is digits of CHAR_W plus this
export const SIGN_W = 16;
const SPLIT_MIN = 520;
const WRAP_PAD = 8; // room at the right of a code cell, under the vertical scrollbar
const WORD_LIMIT = 0.7;

const BAR_BLOCKS = 5;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// The same letters as the Files tab (Q4); colors are theme keys (Q5).
const BADGES = {
  added: { letter: "A", color: "ansi2" },
  untracked: { letter: "A", color: "ansi2" },
  deleted: { letter: "D", color: "ansi1" },
  conflict: { letter: "U", color: "ansi1" },
  modified: { letter: "M", color: "ansi3" },
  renamed: { letter: "R", color: "ansi4" },
};

export const badgeOf = (status) => BADGES[status] ?? BADGES.modified;

export const splitPath = (path) => {
  const cut = path.lastIndexOf("/") + 1;
  return { dir: path.slice(0, cut), name: path.slice(cut) };
};

const changeOf = (file) => (file.add ?? 0) + (file.del ?? 0);

export const maxChange = (files) => files.reduce((max, file) => Math.max(max, changeOf(file)), 0);

// Q6: filled = ceil(5 * change / max), split green and red by round; a side with lines keeps a block when it can.
export function sizeBar(file, max) {
  const add = file.add ?? 0;
  const del = file.del ?? 0;
  const total = add + del;
  if (file.status === "untracked" || total === 0 || !(max > 0)) return { add: 0, del: 0 };
  const filled = Math.min(BAR_BLOCKS, Math.max(1, Math.ceil((BAR_BLOCKS * total) / max)));
  if (filled === 1) return add >= del ? { add: 1, del: 0 } : { add: 0, del: 1 };
  let green = Math.round((filled * add) / total);
  if (add > 0 && green === 0) green = 1;
  if (del > 0 && green === filled) green = filled - 1;
  return { add: green, del: filled - green };
}

// Q8: the age of a commit in one unit, floored.
export function ago(atMs, nowMs) {
  if (!Number.isFinite(atMs) || !Number.isFinite(nowMs)) return "";
  const age = nowMs - atMs;
  if (age < MINUTE) return "now";
  if (age < HOUR) return `${Math.floor(age / MINUTE)} min ago`;
  if (age < DAY) return `${Math.floor(age / HOUR)} h ago`;
  return `${Math.floor(age / DAY)} d ago`;
}

// AC24: a hunk that only deletes has no new line to name, so it names the old one.
export const hunkTitle = (hunk) => {
  const n = hunk.newCount === 0 ? hunk.oldStart : hunk.newStart;
  return hunk.section ? `Line ${n} · ${hunk.section}` : `Line ${n}`;
};

const isHigh = (code) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code) => code >= 0xdc00 && code <= 0xdfff;

// AC26: the range left after the common prefix, then the common suffix inside the rest. [start, end) in UTF-16 units.
export function wordRanges(del, add) {
  const shorter = Math.min(del.length, add.length);
  let prefix = 0;
  while (prefix < shorter && del.charCodeAt(prefix) === add.charCodeAt(prefix)) prefix += 1;
  // A prefix that ends on a high surrogate would cut a character in two.
  if (prefix > 0 && isHigh(del.charCodeAt(prefix - 1))) prefix -= 1;
  let suffix = 0;
  while (suffix < shorter - prefix
    && del.charCodeAt(del.length - 1 - suffix) === add.charCodeAt(add.length - 1 - suffix)) suffix += 1;
  // A suffix that starts on a low surrogate would cut a character in two.
  if (suffix > 0 && isLow(del.charCodeAt(del.length - suffix))) suffix -= 1;
  const range = (text) => (text.length - suffix > prefix ? [prefix, text.length - suffix] : null);
  const out = { del: range(del), add: range(add) };
  // Over the limit the word tint marks most of the line and says nothing: drop it on both sides.
  // A division, not WORD_LIMIT * length: 0.7 * 90 is just under 63, so an exact 70 % would count as over.
  const over = (r, text) => r !== null && (r[1] - r[0]) / text.length > WORD_LIMIT;
  if (over(out.del, del) || over(out.add, add)) return { del: null, add: null };
  return out;
}

// Splits a hunk's lines into context lines, lone notes and runs of dels followed directly by adds.
// A note inside a run stays in it, on the side of the line before it (AC26: a note does not break a run).
function segments(lines) {
  const out = [];
  let run = null;
  for (const line of lines) {
    if (line.kind === "del" || (line.kind === "add" && !run)) {
      if (!run || run.adds.length > 0) {
        run = { dels: [], adds: [], left: [], right: [] };
        out.push(run);
      }
    }
    if (line.kind === "del") run.dels.push(line);
    else if (line.kind === "add") run.adds.push(line);
    else if (line.kind === "note" && run) (run.adds.length > 0 ? run.right : run.left).push(line);
    else {
      run = null;
      out.push(line);
    }
  }
  return out;
}

// The word range of each paired line: del i with add i, for i under min(k, m).
function pairWords(run, words) {
  const pairs = Math.min(run.dels.length, run.adds.length);
  for (let i = 0; i < pairs; i += 1) {
    const ranges = wordRanges(run.dels[i].text, run.adds[i].text);
    words.set(run.dels[i], ranges.del);
    words.set(run.adds[i], ranges.add);
  }
}

const isRun = (segment) => Array.isArray(segment.dels);

export function unifiedRows(hunks) {
  const rows = [];
  for (const hunk of hunks) {
    rows.push({ type: "hunk", title: hunkTitle(hunk) });
    const words = new Map();
    for (const segment of segments(hunk.lines)) if (isRun(segment)) pairWords(segment, words);
    for (const line of hunk.lines) {
      if (line.kind === "note") rows.push({ type: "note", text: line.text });
      else rows.push({ type: "line", kind: line.kind, old: line.old, new: line.new, text: line.text, word: words.get(line) ?? null });
    }
  }
  return rows;
}

const cellOf = (line, no, word = null) => ({ kind: line.kind, no, text: line.text, word });

// AC27: a run takes max(k, m) rows with pair i on row i, then its notes, each on its own side.
function runRows(run, rows) {
  const words = new Map();
  pairWords(run, words);
  const side = (line, no) => (line ? cellOf(line, no, words.get(line) ?? null) : null);
  for (let i = 0; i < Math.max(run.dels.length, run.adds.length); i += 1) {
    const del = run.dels[i];
    const add = run.adds[i];
    rows.push({ type: "pair", left: side(del, del?.old), right: side(add, add?.new) });
  }
  for (let i = 0; i < Math.max(run.left.length, run.right.length); i += 1) {
    rows.push({ type: "pair", left: side(run.left[i], null), right: side(run.right[i], null) });
  }
}

export function splitRows(hunks) {
  const rows = [];
  for (const hunk of hunks) {
    rows.push({ type: "hunk", title: hunkTitle(hunk) });
    for (const segment of segments(hunk.lines)) {
      if (isRun(segment)) runRows(segment, rows);
      // A note after a context line ends both sides, so it shows on both.
      else if (segment.kind === "note") rows.push({ type: "pair", left: cellOf(segment, null), right: cellOf(segment, null) });
      else rows.push({ type: "pair", left: cellOf(segment, segment.old), right: cellOf(segment, segment.new) });
    }
  }
  return rows;
}

// The number column follows the widest line number of the shown rows; two digits at least.
export function numWidth(rows) {
  let widest = 2;
  const see = (n) => { if (n !== null && n !== undefined) widest = Math.max(widest, String(n).length); };
  for (const r of rows) {
    if (r.type === "line") { see(r.old); see(r.new); } else if (r.type === "pair") { see(r.left?.no); see(r.right?.no); }
  }
  return Math.ceil(widest * CHAR_W) + NUM_PAD;
}

// The space before the code: one number column per side in split, both columns in unified, then the sign.
export const gutter = (rows, mode) => (mode === "split" ? 1 : 2) * numWidth(rows) + SIGN_W;

// AC28: until the width is known the diff is unified with no note, so a first frame never flashes the note.
export const viewMode = (pick, width) => {
  if (pick === "unified" || !Number.isFinite(width)) return { mode: "unified", note: false };
  if (width < SPLIT_MIN) return { mode: "unified", note: true };
  return { mode: "split", note: false };
};

// The diff keys of both tabs: [ and ] the previous and next file, s the other mode, escape back. -> its handler, or null.
export const diffKey = (keystroke, on) => ({ "[": on.prev, "]": on.next, s: on.toggle, escape: on.close })[keystroke] ?? null;

export function neighbors(files, path) {
  const index = files.findIndex((file) => file.path === path);
  if (index < 0) return { index: -1, prev: null, next: null };
  return { index, prev: files[index - 1]?.path ?? null, next: files[index + 1]?.path ?? null };
}

// AC31: the characters that fit in a code cell of `cellWidth` px; Infinity (no wrap) while the width is unknown.
export const wrapCols = (cellWidth) => (Number.isFinite(cellWidth) ? Math.max(1, Math.floor((cellWidth - WRAP_PAD) / CHAR_W)) : Infinity);

// The code cell width of `mode` in a code area of `width` px: the area less the gutter, halved in split around the 1 px line.
export const cellWidth = (width, rows, mode) => (mode === "split" ? (width - 1) / 2 : width) - gutter(rows, mode);

// The cells one code point takes: a tab TAB_COLS (assumed; the host's tab width is not checked live), an East Asian
// wide character or an emoji 2, anything else 1. Symbol blocks are counted wide as a whole: too many cells only wraps
// earlier. Every WIDE range is at U+1100 or above, which the fast path of chunks relies on.
// Limit: the cut is per code point, so it can fall inside a grapheme (a skin tone, a flag, a combining mark).
const TAB_COLS = 4;
const WIDE = /[\u1100-\u115f\u231a-\u231b\u23e9-\u23f3\u25fd-\u25fe\u2600-\u27bf\u2b1b-\u2b1c\u2b50\u2b55\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{1b000}-\u{1b16f}\u{1f000}-\u{1faff}\u{20000}-\u{3fffd}]/u;
const colsOf = (ch) => (ch === "\t" ? TAB_COLS : WIDE.test(ch) ? 2 : 1);

// The pieces of `text` that take at most `cols` cells (colsOf), each with the part of `word` it holds ([start, end)
// in UTF-16 units, or null). A cut never splits a code point; a piece holds at least one.
function chunks(text, word, cols) {
  // Fast path: no tab and nothing at U+1100 or above, so one UTF-16 unit is one cell.
  if (text.length <= cols && !/[\t\u1100-\u{3fffd}]/u.test(text)) return [{ text, word }];
  const ends = [];
  let used = 0;
  let i = 0;
  for (const ch of text) {
    const w = colsOf(ch);
    if (used > 0 && used + w > cols) { ends.push(i); used = 0; }
    used += w;
    i += ch.length;
  }
  if (ends.length === 0) return [{ text, word }];
  ends.push(text.length);
  let s = 0;
  return ends.map((e) => {
    const a = word ? Math.max(word[0], s) : 0, b = word ? Math.min(word[1], e) : 0;
    const piece = { text: text.slice(s, e), word: word && a < b ? [a - s, b - s] : null };
    s = e;
    return piece;
  });
}

// One split cell cut into pieces; a later piece has no number (cont). A null side stays null: the filler on every row.
function cellPieces(cell, cols) {
  if (!cell || cell.kind === "note") return [cell];
  return chunks(cell.text, cell.word, cols).map((c, i) => (i === 0 ? { ...cell, ...c } : { kind: cell.kind, no: null, cont: true, ...c }));
}

// AC31: a line wider than `cols` cells goes on as more rows of the same height, cut at `cols` cells (colsOf). The next rows have
// no numbers and no sign (cont). In split, a pair takes as many rows as its longer side; the shorter side goes on with
// an empty cell of its own kind. Hunk titles and notes are not cut. Rows that fit are returned as they are.
export function wrapRows(rows, mode, cols) {
  if (!Number.isFinite(cols)) return rows;
  const out = [];
  for (const row of rows) {
    if (mode === "split" && row.type === "pair") {
      const left = cellPieces(row.left, cols), right = cellPieces(row.right, cols);
      if (left.length === 1 && right.length === 1) { out.push(row); continue; }
      for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
        const side = (pieces, cell) => pieces[i] ?? (cell ? { kind: cell.kind, no: null, cont: true, text: "", word: null } : null);
        out.push({ type: "pair", left: side(left, row.left), right: side(right, row.right) });
      }
    } else if (mode !== "split" && row.type === "line") {
      const pieces = chunks(row.text, row.word, cols);
      if (pieces.length === 1) { out.push(row); continue; }
      pieces.forEach((c, i) => out.push(i === 0 ? { ...row, ...c } : { type: "line", kind: row.kind, old: null, new: null, cont: true, ...c }));
    } else out.push(row);
  }
  return out;
}
