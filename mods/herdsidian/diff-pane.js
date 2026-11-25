// The state of one open diff: split or unified, the tab and code widths, the horizontal pan and its limits.
// Pure, so the Changes tab and the Git tab share one copy. The host reads the zoom and hands it in.
// `shown` is the diff drawn: { body, rows, long }; rows and long are built here once per diff and kept on it.
import { unifiedRows, splitRows, longest, gutter, viewMode, panLimit, panStep } from "./diff.js";

export class DiffPane {
  constructor() {
    this.pick = "split"; this.width = null; this.code = null; this.pan = { old: 0, new: 0 };
  }

  // The tab's width in logical px: it picks split or unified before and while a diff shows.
  resized(width) {
    if (width === this.width) return false;
    this.width = width;
    return true;
  }

  // The code area's size in logical px: the pan limits use its width once known.
  sized(size) {
    if (size.width === this.code?.width && size.height === this.code?.height) return false;
    this.code = size;
    return true;
  }

  mode() {
    return viewMode(this.pick, this.width);
  }

  toggle(mode, shown) {
    this.pick = mode;
    this.clamp(shown);
  }

  // The rows of the shown diff in `mode`, built once per diff.
  rowsOf(shown, mode) {
    shown.rows ??= {};
    return (shown.rows[mode] ??= mode === "split" ? splitRows(shown.body.hunks) : unifiedRows(shown.body.hunks));
  }

  // The most each side may pan in the mode shown, or null with no lines or no width yet.
  limits(shown) {
    const width = this.code?.width ?? this.width;
    if (!shown?.body.hunks || !Number.isFinite(width)) return null;
    const { mode } = this.mode();
    const long = (shown.long ??= longest(shown.body.hunks)), edge = gutter(this.rowsOf(shown, mode), mode);
    if (mode === "unified") return { old: 0, new: panLimit(long.all, width - edge) };
    const cell = (width - 1) / 2 - edge;
    return { old: panLimit(long.old, cell), new: panLimit(long.new, cell) };
  }

  // New content, a new mode or a new width: no offset past the end of the longest line.
  clamp(shown) {
    const limits = this.limits(shown) ?? { old: 0, new: 0 };
    const next = { old: Math.min(this.pan.old, limits.old), new: Math.min(this.pan.new, limits.new) };
    if (next.old !== this.pan.old || next.new !== this.pan.new) this.pan = next;
  }

  // AC31: the wheel over the code area pans the side under the pointer (unified has only the new one).
  // Positions and deltas come in window px: both are divided by the zoom.
  wheel(e, zoom, shown) {
    const limits = this.limits(shown);
    if (!limits || !e.local_position) return false;
    const width = this.code?.width ?? this.width;
    const split = this.mode().mode === "split";
    const side = split && e.local_position.x / zoom < width / 2 ? "old" : "new";
    const delta = { x: (e.delta?.x ?? 0) / zoom, y: (e.delta?.y ?? 0) / zoom };
    const next = panStep(this.pan, side, { delta, modifiers: e.modifiers }, limits);
    if (next === this.pan) return false;
    this.pan = next;
    return true;
  }

  // Another file: the pan starts at 0.
  reset() {
    this.pan = { old: 0, new: 0 };
  }
}
