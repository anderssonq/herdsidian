// Owns the drag-to-reorder machine of the sidebar tabs: pure, same press/move/release pattern as guide-spaces.

// state: null | { from, over }. event: { type: "press" | "move" | "release", id } | { type: "up" } | { type: "leave" }.
// Returns { state, move }; `move` is { from, to } only on a release on another segment.
export function dragStep(state, event) {
  switch (event.type) {
    // A second press replaces the first: its release was lost.
    case "press":
      return { state: { from: event.id, over: event.id }, move: null };
    case "move":
      return { state: state ? { from: state.from, over: event.id } : null, move: null };
    case "release":
      if (!state) return { state: null, move: null };
      return { state: null, move: event.id === state.from ? null : { from: state.from, to: event.id } };
    default:
      return { state: null, move: null };
  }
}

// The side of segment `id` that shows the bar: where the pressed tab would land.
export function dropSide(order, state, id) {
  if (!state || id !== state.over || id === state.from) return null;
  const from = order.indexOf(state.from);
  const to = order.indexOf(id);
  if (from < 0 || to < 0) return null;
  return from < to ? "right" : "left";
}

// True when a window move should cancel the drag: another button, or a pointer past the box. A missing value is not outside.
export function outside(event) {
  if (event.pressed_button !== "left") return true;
  const { local_position: p, bounds: b } = event;
  if (!p || !b) return false;
  return p.x < 0 || p.y < 0 || p.x > b.width || p.y > b.height;
}
