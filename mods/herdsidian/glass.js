// The window glass switch (⌘K → Settings → General → Window glass). Pure: Node tests import it.
// On: the desktop shows blurred behind the window (window_blur) and through the mods' glass. Herdr paints
// the theme `background` under the whole window, so the layout overrides it with CLEAR; the terminals
// then draw on the pane frame (`surface`, terminal_opacity 0) and stay solid.
// Off: the theme gradient under the glass, terminals on `background`. The layout's `work-body` keeps its
// `chrome` fill either way. On and Off replace any custom `colors.background` and pane frame `background`.
import { CLEAR } from "./tokens.js";

const GRADIENT = { gradient: ["chrome", "canvas"], angle: 160 };

// True when the layout tree has the glass on.
export const isGlass = (tree) => tree?.colors?.background === CLEAR;

// Every pane frame in the tree (a tab block's `content.pane`).
function paneFrames(node, out = []) {
  if (node?.content?.pane) out.push(node.content.pane);
  for (const child of node?.children ?? []) paneFrames(child, out);
  return out;
}

// A copy of the tree with the glass on or off. Only the look fields change; nodes, sizes and ids stay.
export function withGlass(tree, on) {
  const next = JSON.parse(JSON.stringify(tree));
  const colors = { ...(next.colors ?? {}) };
  if (on) colors.background = CLEAR;
  else delete colors.background;
  if (Object.keys(colors).length) next.colors = colors;
  else delete next.colors;
  next.background = on ? CLEAR : GRADIENT;
  // window_blur stays on when off: macOS sets the blur up when the window opens, and the opaque
  // background already hides it, so turning the glass back on needs no restart.
  if (on) next.window_blur = true;
  next.terminal_opacity = on ? 0 : 1;
  for (const pane of paneFrames(next)) pane.background = on ? "surface" : "background";
  return next;
}
