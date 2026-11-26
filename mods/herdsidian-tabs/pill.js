// The pane tab bar's sliding pill: where it sits and when it must snap instead of slide. Pure.

// Within this long after a tab switch, a width change still belongs to that switch and slides with it.
const SLIDE_WINDOW = 250;

// The pill's px box for the active tab: the widths before it plus one gap each. `sizes` maps id to
// width. Null when the active tab is not listed or a width at or before it is unknown.
export function pillBox(ids, sizes, active, gap = 2) {
  const at = ids.indexOf(active);
  if (at < 0) return null;
  let left = 0;
  for (let n = 0; n < at; n++) {
    const width = sizes.get(ids[n]);
    if (width === undefined) return null;
    left += width + gap;
  }
  const width = sizes.get(active);
  return width === undefined ? null : { left, width };
}

// True when the pill must be drawn with no transition. Only a change of the active tab inside the
// same space and the same list slides; a width change slides only just after such a switch.
export function pillSnap(prev, next, now) {
  if (!prev?.box || !next.box) return true;
  if (prev.space !== next.space) return true;
  if (prev.ids.length !== next.ids.length || prev.ids.some((id, n) => id !== next.ids[n])) return true;
  if (prev.active !== next.active) return false;
  if (prev.sizesKey === next.sizesKey) return true;
  return now - next.switchedAt > SLIDE_WINDOW;
}
