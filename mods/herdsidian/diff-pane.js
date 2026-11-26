// The state of one open diff: split or unified, the tab and code widths, and the rows cut to the code width.
// Pure, so the Changes tab and the Git tab share one copy. The host reads the zoom and hands it in.
// `shown` is the diff drawn: { body, rows }; rows are built here once per diff, mode and width, and kept on it.
import { unifiedRows, splitRows, viewMode, wrapRows, wrapCols, cellWidth } from "./diff.js";

export class DiffPane {
  constructor() {
    this.pick = "split"; this.width = null; this.code = null;
  }

  // The tab's width in logical px: it picks split or unified before and while a diff shows.
  resized(width) {
    if (width === this.width) return false;
    this.width = width;
    return true;
  }

  // The code area's size in logical px: the wrap uses its width once known.
  sized(size) {
    if (size.width === this.code?.width && size.height === this.code?.height) return false;
    this.code = size;
    return true;
  }

  mode() {
    return viewMode(this.pick, this.width);
  }

  toggle(mode) {
    this.pick = mode;
  }

  // AC31: the rows of the shown diff in `mode`, cut to the code width (the tab width until the code area is measured).
  // The rows of a mode are built once per diff; only the last cut is kept, so a sidebar drag holds one copy.
  rowsOf(shown, mode) {
    shown.rows ??= {};
    const rows = (shown.rows[mode] ??= mode === "split" ? splitRows(shown.body.hunks) : unifiedRows(shown.body.hunks));
    const width = this.code?.width ?? this.width;
    // No width yet (or a 0 before layout): no cut, as wrapCols(null) says.
    const cols = Number.isFinite(width) && width > 0 ? wrapCols(cellWidth(width, rows, mode)) : Infinity;
    const key = `${mode}:${cols}`;
    if (shown.rows.cut?.key !== key) shown.rows.cut = { key, rows: wrapRows(rows, mode, cols) };
    return shown.rows.cut.rows;
  }
}
