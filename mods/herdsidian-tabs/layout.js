// Layout tree helpers. Canonical copy: lib/layout.js.
// Each mod that uses it carries a byte-identical copy as mods/<mod>/layout.js (`npm run lint` checks it).
// Imports herdr (for the sidebar helpers), so Node tests do not import it.
import { layout, run, shared, setShared, window } from "herdr";

// The node with this id in a layout tree (depth first), or null.
export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
export const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
export function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 248) : window()?.platform === "macos" ? 76 : 44 });
}
