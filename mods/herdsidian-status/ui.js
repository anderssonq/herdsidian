// Shared gpui pieces. Canonical copy: lib/ui.js.
// Each mod that uses it carries a byte-identical copy as mods/<mod>/ui.js (`npm run lint` checks it).
// Imports gpui-kit, so Node tests do not import it.
import { PathBuilder, Background, div, svg, image } from "gpui-kit";
import { GLOW_ANGLE, PULSE, alpha, dotOffset, statusDot, tokens } from "./tokens.js";

const FULL = [[0, 0], ["100%", 0], ["100%", "100%"], [0, "100%"]];

// The top sheen: fills its whole block, foreground at 5 % at the top, fully transparent
// at the bottom edge. Uses the global gpui `window`, not herdr's `window` import.
export const glow = (k) => globalThis.window
  .paint_path(PathBuilder.fill().add_polygon(FULL).build(), Background.linear_gradient(GLOW_ANGLE, k.glow, k.glowEnd))
  .absolute().top(0).left(0).size_full();

// The dot texture of the 52 px header band, tinted by k.dot. `mod` is the mod that ships
// header-dots.svg, `blockX` the block's left edge in the window. The block must clip.
export const headerDots = (k, mod, blockX = 0) => svg(`mods/${mod}/header-dots.svg`)
  .w(2400).h(52).absolute().top(0).left(-dotOffset(blockX)).text_color(k.dot);

// The status dot: a fill, or a ring for idle; working pulses. `size` px round, `margin` px
// either side (none by default).
export const dot = (t, status, size, margin = 0) => {
  const d = statusDot(t, status);
  return div().size(size).flex_none().rounded_full()
    .when(margin > 0, (el) => el.mx(margin))
    .when(Boolean(d.fill), (el) => el.bg(d.fill))
    .when(Boolean(d.ring), (el) => el.border(1.5).border_color(d.ring))
    .when(d.pulse, (el) => el.loop("opacity", PULSE));
};

// The "!" mark: a `size` px round t.blocked circle with a centered "!" in `surface`, the
// color of whatever lies under it.
export const alertMark = (t, size, surface) => div()
  .size(size).flex_none().rounded_full().bg(t.blocked)
  .flex().items_center().justify_center()
  .text_size(Math.max(8, Math.min(9, Math.round(size * 0.7)))).font_weight(800).text_color(surface)
  .child("!");

// The shared "Needs you" pill: blockedSoft tint, no border, "!" mark first. A plain element,
// so the caller can add .id / .on_click / .tooltip.
export const needsPill = (t, k, surface, label = "Needs you") => div()
  .flex_none().h(18).px(7).gap(5).flex().items_center().rounded(5).bg(k.blockedSoft)
  .text_size(11).font_weight(500).text_color(t.blocked)
  .child(alertMark(t, 11, surface))
  .child(label);

// The shortcut that reaches a thing, as a small key cap (h 18, radius 4, hairline, 10.5 px muted).
export const keycap = (t, text) => div().flex_none().px(5).h(18).rounded(4).border(1).border_color(tokens(t).line).text_size(10.5).text_color(t.muted).flex().items_center().child(text);

// The bar's geometry: the track runs `inset` px short of each side (the rounded corners
// clip to a rectangle, not a curve), the indicator is 35 % of the track.
export const barTrack = (width, inset = 0) => {
  const length = width - 2 * inset;
  return { length, span: length * 0.35 };
};

// The working bar: a 2 px track along the straight part of the top edge (no layout space),
// `inset` px in from each side, clipped, with a 35 % wide gradient (transparent, accent,
// magenta, transparent) that loops across the track. null when the track has no length yet.
// Angle 90 reads left to right (GLOW_ANGLE 180 is top to bottom, so the angles are CSS-like).
export const workingBar = (t, k, width, inset = 0) => {
  const { length, span } = barTrack(width, inset);
  if (!(length > 0)) return null;
  const clear = (color) => alpha(color, 0);
  const part = (from, to) => globalThis.window
    .paint_path(PathBuilder.fill().add_polygon(FULL).build(), Background.linear_gradient(90, from, to))
    .w(span / 3).h(2).flex_none();
  // top(-1): the header's 1 px top border (the highlight) pushes absolute top(0) one pixel
  // down, so -1 puts the bar right under the card's border.
  return div().absolute().top(-1).left(inset).right(inset).h(2).bg(k.accentTrack).overflow_hidden()
    .child(div().absolute().top(0).w(span).h(2).flex().flex_row()
      .child(part(clear(t.accent), t.accent))
      .child(part(t.accent, t.ansi5))
      .child(part(t.ansi5, clear(t.ansi5)))
      .loop("left", { from: -span, to: length, period: 3200, easing: "ease-in-out" }));
};

// A program's icon from the app's program table: a one-color glyph in `color`, or a picture
// as it is. null when the program has none.
export const icon = (p, size, color) => {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
};
