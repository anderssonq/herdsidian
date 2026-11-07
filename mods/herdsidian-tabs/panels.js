// The Files / Changes side panel: a column (`panel`) with a Files block on top and a Changes block
// below. Each one opens on its own; the column shows while at least one is open.
// Pure (no Herdr or GPUI imports), so Node tests import it.

export const PANELS = ["files", "changes"];

// What the layout shows now: { files, changes }. A hidden column shows neither.
export function shownPanels(panel, blocks) {
  const open = Boolean(panel) && !panel.hidden;
  return Object.fromEntries(PANELS.map((id) => [id, open && Boolean(blocks[id]) && !blocks[id].hidden]));
}

// `shown` with one panel flipped.
export const toggled = (shown, id) => ({ ...shown, [id]: !shown[id] });

// The run() calls that make the layout show `want`: the blocks first, then the column.
export function panelCommands(want) {
  const blocks = PANELS.map((id) => [want[id] ? "layout.show" : "layout.hide", { id }]);
  return [...blocks, [PANELS.some((id) => want[id]) ? "layout.show" : "layout.hide", { id: "panel" }]];
}

// A space's remembered choice. Builds before both could open stored "files" | "changes" | null.
export function readChoice(value) {
  if (typeof value === "string") return Object.fromEntries(PANELS.map((id) => [id, id === value]));
  return Object.fromEntries(PANELS.map((id) => [id, value?.[id] === true]));
}

export const sameChoice = (a, b) => PANELS.every((id) => a[id] === b[id]);
