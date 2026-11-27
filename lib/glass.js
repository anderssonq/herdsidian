// The window glass switch (⌘K → Settings → General → Window glass) and the gutter around the panes.
// Canonical copy: lib/glass.js; mods that use it carry a byte-identical copy (`npm run lint` checks it).
// Pure but for syncGutter's injected read and write: Node tests import it.
// On: the desktop shows blurred behind the window (window_blur) and through the mods' glass. Herdr paints
// the theme `background` under the whole window, so the layout overrides it with CLEAR.
// Off: the matte look. The root is plain `chrome` and the mods paint their sheets opaque (tokens.js reads
// the theme `background`: CLEAR or not).
// Either way the terminals draw on the pane frame (`surface`, terminal_opacity 0), so they keep one color.
// On and Off replace any custom `colors.background`, pane frame `background` and `terminal_opacity`.
// The gutter (the node around the panes, `work-body`) is `chrome` with the glass off. With it on it takes
// the sidebar's glass sheet as a full hex, because a theme name in the layout cannot carry alpha: the
// switch writes it and syncGutter rewrites it when the theme changes.
import { CLEAR, tokens } from "./tokens.js";

// True when the layout tree has the glass on.
export const isGlass = (tree) => tree?.colors?.background === CLEAR;

// Every pane frame in the tree (a tab block's `content.pane`).
function paneFrames(node, out = []) {
  if (node?.content?.pane) out.push(node.content.pane);
  for (const child of node?.children ?? []) paneFrames(child, out);
  return out;
}

// Every gutter in the tree, in document order: a node with its own `background` and a pane block as a
// direct child.
function gutters(node, out = []) {
  const children = node?.children ?? [];
  if (node && Object.hasOwn(node, "background") && children.some((c) => c?.content?.pane)) out.push(node);
  for (const child of children) gutters(child, out);
  return out;
}

// The gutter color with the glass on: the sidebar's sheet for this theme, whatever its `background` is now.
export const gutterColor = (t) => tokens({ ...t, background: CLEAR }).glass;

// The first gutter's background, or null when the tree has no gutter.
export const gutterOf = (tree) => gutters(tree)[0]?.background ?? null;

// A copy of the tree with every gutter in `color`.
export function withGutter(tree, color) {
  const next = JSON.parse(JSON.stringify(tree));
  for (const node of gutters(next)) node.background = color;
  return next;
}

// A copy of the tree with the glass on or off. Only the look fields change; nodes, sizes and ids stay.
// Off puts the gutter back to `chrome`; on leaves it, and flipGlass gives it the theme's sheet.
export function withGlass(tree, on) {
  const next = JSON.parse(JSON.stringify(tree));
  const colors = { ...(next.colors ?? {}) };
  if (on) colors.background = CLEAR;
  else delete colors.background;
  if (Object.keys(colors).length) next.colors = colors;
  else delete next.colors;
  next.background = on ? CLEAR : "chrome";
  // window_blur stays on when off: macOS sets the blur up when the window opens, and the opaque
  // background already hides it, so turning the glass back on needs no restart.
  if (on) next.window_blur = true;
  next.terminal_opacity = 0;
  for (const pane of paneFrames(next)) pane.background = "surface";
  if (!on) for (const node of gutters(next)) node.background = "chrome";
  return next;
}

// The tree after one press of the switch, for theme `t`: off, or on with the gutter in the theme's sheet.
export const flipGlass = (tree, t) =>
  isGlass(tree) ? withGlass(tree, false) : withGutter(withGlass(tree, true), gutterColor(t));

// Keeps the layout file's gutter in `color` while the glass is on. `read(path)` gives the file text or
// null; `write(path, text, expected)` fails when the file is no longer `expected`. True when it wrote.
// It never throws: a file that is missing, not a glass layout, or changed in between is left alone, and
// the next call tries again.
export async function syncGutter({ path, color, read, write }) {
  try {
    const text = await read(path);
    const tree = JSON.parse(text);
    if (tree?.window_blur === undefined || !isGlass(tree)) return false;
    const now = gutters(tree);
    if (!now.length || now.every((node) => node.background === color)) return false;
    await write(path, JSON.stringify(withGutter(tree, color), null, 2) + "\n", text);
    return true;
  } catch {
    return false;
  }
}
