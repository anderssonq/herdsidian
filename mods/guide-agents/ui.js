// Shared gpui pieces. Canonical copy: lib/ui.js.
// Each mod that uses it carries a byte-identical copy as mods/<mod>/ui.js (`npm run lint` checks it).
// Imports gpui-kit, so Node tests do not import it.
import { PathBuilder, Background, svg, image } from "gpui-kit";
import { GLOW_ANGLE } from "./tokens.js";

const FULL = [[0, 0], ["100%", 0], ["100%", "100%"], [0, "100%"]];

// The top sheen: fills its whole block, foreground at 5 % at the top, fully transparent
// at the bottom edge. Uses the global gpui `window`, not herdr's `window` import.
export const glow = (k) => globalThis.window
  .paint_path(PathBuilder.fill().add_polygon(FULL).build(), Background.linear_gradient(GLOW_ANGLE, k.glow, k.glowEnd))
  .absolute().top(0).left(0).size_full();

// A program's icon from the app's program table: a one-color glyph in `color`, or a picture
// as it is. null when the program has none.
export const icon = (p, size, color) => {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
};
