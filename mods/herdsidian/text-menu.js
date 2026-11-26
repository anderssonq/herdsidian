// The pure rules of the right-click menu on text: the rows of each surface, the text each copy row writes,
// line references, a diff row's line and hunk, and the check of a request. No Herdr or GPUI imports, so node tests it.
// Copy rows run in the popup (their text is in its props); rows that touch Notes' state post a request (ADR-0004).

import { isFreshRequest } from "./context.js";
import { MENU } from "./actions.js";

export const TEXT_ACTION_KEY = "herdsidian.text-action";
export const TEXT_MENU = { width: 220, row: 28, sep: 9, pad: MENU.pad };
// A selection sent to an agent is cut here: a paste this long is already more than a person reviews.
export const MAX_SEND_TEXT = 8000;

const ROWS = {
  cut: { label: "Cut", keys: "⌘X" },
  copy: { label: "Copy", keys: "⌘C" },
  paste: { label: "Paste", keys: "⌘V" },
  "select-all": { label: "Select all", keys: "⌘A" },
  "copy-md": { label: "Copy as Markdown" },
  send: { label: "Send selection to agent" },
  "copy-path": { label: "Copy full path" },
  "copy-rel": { label: "Copy relative path" },
  "copy-ref": { label: "Copy path:line" },
  edit: { label: "Edit note", keys: "⌘E" },
  "copy-line": { label: "Copy line" },
  "copy-hunk": { label: "Copy hunk" },
  "open-files": { label: "Open in Files" },
};

// The ops that Notes runs; every other row is a copy the popup does itself.
export const NOTES_OPS = ["cut", "paste", "select-all", "send", "edit", "open-files"];

const SEP = "-";
const LAYOUT = {
  read: ["copy", "copy-md", "send", SEP, "copy-path", "edit"],
  edit: ["cut", "copy", "paste", "select-all", SEP, "send", "copy-path"],
  file: ["copy", "select-all", SEP, "copy-ref", "copy-rel", "copy-path", "send"],
  diff: ["copy-line", "copy-hunk", SEP, "copy-ref", "copy-path", "open-files"],
};

// `on`: the ids that apply now. A row that does not apply is shown disabled, so the menu keeps its shape;
// a row in `hide` is left out (Open in Files where there is no Files to open, a missing relative path).
export function textMenuItems(surface, on, hide = []) {
  const live = new Set(on), gone = new Set(hide);
  const ids = (LAYOUT[surface] ?? []).filter((id) => !gone.has(id));
  // No separator first, last or twice.
  const rows = ids.filter((id, i) => id !== SEP || (i > 0 && i < ids.length - 1 && ids[i - 1] !== SEP));
  return rows.map((id) => (id === SEP ? { sep: true } : { id, ...ROWS[id], disabled: !live.has(id) }));
}

export const textMenuSize = (items) => ({
  width: TEXT_MENU.width,
  height: items.reduce((h, r) => h + (r.sep ? TEXT_MENU.sep : TEXT_MENU.row), TEXT_MENU.pad),
});

// The 1-based line of a UTF-16 offset.
export function lineAt(text, offset) {
  let line = 1;
  const end = Math.max(0, Math.min(offset, text.length));
  for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

// The lines a selection covers. A selection that ends just after a newline does not take the next line.
export function lineSpan(text, range) {
  const start = Math.min(range.start, range.end), end = Math.max(range.start, range.end);
  const from = lineAt(text, start);
  const to = end > start && text.charCodeAt(end - 1) === 10 ? lineAt(text, end - 1) : lineAt(text, end);
  return { from, to: Math.max(from, to) };
}

export const pathRef = (path, span) => (!span ? path : span.from === span.to ? `${path}:${span.from}` : `${path}:${span.from}-${span.to}`);

// Cut by code point, so an emoji is never split in two.
const clip = (text) => {
  if (text.length <= MAX_SEND_TEXT) return text;
  const cut = text.slice(0, MAX_SEND_TEXT), high = cut.charCodeAt(cut.length - 1);
  return `${high >= 0xd800 && high <= 0xdbff ? cut.slice(0, -1) : cut}\n… (cut at ${MAX_SEND_TEXT} characters)`;
};

// A fence longer than any run of backticks in the text, so code that holds ``` stays inside it.
const fence = (text) => "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((m) => m[0].length + 1)));

// What a selection sent to an agent says: where it is from, then the text (code fenced, with its language).
export function sendBlock(ref, text, language = null) {
  const body = clip(text);
  if (language === null) return `From ${ref}:\n\n${body}`;
  const f = fence(body);
  return `${ref}\n${f}${language}\n${body}\n${f}`;
}

// The selection of an EditorState, or an empty one when the host cannot tell (never throws).
export function selectionOf(state) {
  try { return state.selected_range() ?? { start: 0, end: 0 }; } catch { return { start: 0, end: 0 }; }
}

// The language tag of a fenced block: the file's own extension (the editor's grammar maps some, like ts, to js).
export const fenceOf = (path) => {
  const name = String(path).split("/").pop();
  return name.includes(".") && !name.startsWith(".") ? name.split(".").pop().toLowerCase() : "";
};

// The menu of an Editor: the note in edit mode ("edit") or the Files preview ("file", read-only).
// `range` is the editor's selection; `path` the full path; `rel` the path below the Files root, or null outside it.
export function editorMenu({ surface, value, range, path, rel = null, language = null }) {
  const start = Math.max(0, Math.min(range?.start ?? 0, range?.end ?? 0)), end = Math.min(value.length, Math.max(range?.start ?? 0, range?.end ?? 0));
  const sel = value.slice(start, end), span = lineSpan(value, { start, end }), ref = rel ?? path;
  const texts = { "copy-path": path };
  if (sel.trim()) { texts.copy = sel; texts.send = sendBlock(pathRef(ref, span), sel, language); }
  if (surface === "file") { texts["copy-ref"] = pathRef(ref, span); if (rel) texts["copy-rel"] = rel; }
  const own = surface === "edit" ? ["paste", "select-all", ...(texts.copy ? ["cut"] : [])] : ["select-all"];
  return { items: textMenuItems(surface, [...Object.keys(texts), ...own], surface === "file" && !rel ? ["copy-rel"] : []), texts };
}

// The menu of the rendered note. `selection` is TextView's ({ text, range? }) or null; `markdown` is the source
// that view rendered, so `range` slices it. Notes opens it only with a note open, so Edit always applies.
export function readMenu({ selection, markdown, path }) {
  const texts = { "copy-path": path }, text = selection?.text ?? "";
  if (text.trim()) {
    texts.copy = text;
    texts.send = sendBlock(path, text);
    const r = selection.range;
    if (r && typeof markdown === "string" && r.end > r.start && r.end <= markdown.length) texts["copy-md"] = markdown.slice(r.start, r.end);
  }
  return { items: textMenuItems("read", [...Object.keys(texts), "edit"]), texts };
}

// The index of the hunk that row `i` belongs to (its title counts), or -1 before the first title.
function hunkIndex(rows, i) {
  let n = -1;
  for (let j = 0; j <= i; j++) if (rows[j].type === "hunk") n++;
  return n;
}

// A diff row's line on `side` ("left" or "right"; unified rows have one). A filler side falls back to the other side.
// Continuation rows (a wrapped line) are walked back to the row that starts the line.
// -> { hunk, kind, old, new } or null on a title, note, banner or filler.
export function diffLineAt(rows, index, side = "right") {
  const row = rows[index];
  if (!row || row.type === "hunk" || row.type === "note") return null;
  // The side actually read: the clicked one, or the other when the clicked cell is a filler.
  const used = row.type === "pair" && !row[side] ? (side === "right" ? "left" : "right") : side;
  const cellOf = (r) => (r.type === "line" ? r : r.type === "pair" ? r[used] : null);
  let i = index;
  while (i > 0 && cellOf(rows[i])?.cont) i--;
  const cell = cellOf(rows[i]);
  if (!cell || cell.kind === "note") return null;
  const hunk = hunkIndex(rows, i);
  if (hunk < 0) return null;
  if (rows[i].type === "line") return { hunk, kind: cell.kind, old: cell.old ?? null, new: cell.new ?? null };
  // A split cell carries one number, `no`: the old file's on the left side, the new file's on the right.
  return used === "left" ? { hunk, kind: cell.kind, old: cell.no, new: null } : { hunk, kind: cell.kind, old: null, new: cell.no };
}

// The hunk line a diffLineAt result names, with its whole text (rows may hold only a wrapped piece). A side with no
// number (the other side of a split context line) is not compared.
export function hunkLine(hunks, at) {
  const lines = hunks?.[at.hunk]?.lines ?? [];
  return lines.find((l) => l.kind === at.kind && (at.old === null || l.old === at.old) && (at.new === null || l.new === at.new)) ?? null;
}

const SIGN = { context: " ", add: "+", del: "-" };

// One hunk with the file headers, as a patch. Counts come from its own lines: a capped hunk keeps fewer lines than its
// header said. A side whose count is 0 names the line before it, as git does. A side is /dev/null when the hunk has
// nothing on it (-0,0 or +0,0) and `status` does not say the file exists on both sides ("modified", "renamed"): so a
// new, deleted, untracked or conflict-created file is /dev/null, an emptied or once-empty tracked file is not, and a
// file added to the index then edited, in a repo with no commit yet, keeps a/ and b/.
// Not covered: CRLF files (the parser drops \r) and a rename git splits in two sections.
export function hunkPatch(path, from, hunk, status = null) {
  const lines = hunk.lines, count = (side) => lines.filter((l) => l[side] !== null && l[side] !== undefined).length;
  const olds = count("old"), news = count("new");
  const start = (first, n, had) => (n === 0 && had > 0 ? Math.max(0, first - 1) : first);
  const oldStart = start(hunk.oldStart, olds, hunk.oldCount), newStart = start(hunk.newStart, news, hunk.newCount);
  const head = `@@ -${oldStart},${olds} +${newStart},${news} @@${hunk.section ? ` ${hunk.section.trim()}` : ""}`;
  const body = lines.map((l) => (l.kind === "note" ? l.text : `${SIGN[l.kind] ?? " "}${l.text}`));
  const both = status === "modified" || status === "renamed";
  const added = !both && hunk.oldStart === 0 && hunk.oldCount === 0, deleted = !both && hunk.newStart === 0 && hunk.newCount === 0;
  return [added ? "--- /dev/null" : `--- a/${from ?? path}`, deleted ? "+++ /dev/null" : `+++ b/${path}`, head, ...body].join("\n") + "\n";
}

// The diff menu of one row: its rows and what each copy row writes. `canOpen`: the Files tab can show this file.
// `path` is below the repo root (what the diff names); `full` the absolute path, or null when the root is not known.
// A deleted line has no line in the file as it is now, so it gets no path:line.
export function diffMenu({ rows, hunks, index, side, path, full = null, from = null, status = null, canOpen }) {
  const at = diffLineAt(rows, index, side);
  const line = at ? hunkLine(hunks, at) : null;
  const hunk = hunks[at ? at.hunk : rows[index]?.type === "hunk" ? hunkIndex(rows, index) : -1] ?? null;
  const texts = { "copy-path": full ?? path };
  if (line) texts["copy-line"] = line.text;
  if (line && line.kind !== "del") texts["copy-ref"] = pathRef(path, { from: line.new, to: line.new });
  if (hunk) texts["copy-hunk"] = hunkPatch(path, from, hunk, status);
  const on = [...Object.keys(texts), ...(canOpen ? ["open-files"] : [])];
  return { items: textMenuItems("diff", on, canOpen ? [] : ["open-files"]), texts };
}

// What Notes does with the menu's request in shared(TEXT_ACTION_KEY): a request is run once, while fresh, for an op it
// knows. A request found at start is old and never replays (the caller seeds `handled` with its id).
export function pendingTextAction(request, handled, now) {
  const id = request?.id ?? null;
  if (id === handled || !isFreshRequest(request, now)) return { run: false, id };
  return { run: NOTES_OPS.includes(request.op), id };
}
