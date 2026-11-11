// Theme-derived color tokens (ADR-0001). Canonical copy: lib/tokens.js.
// Each mod carries a byte-identical copy as mods/<mod>/tokens.js (`npm run lint` checks it).
// Pure: no gpui-kit / herdr imports, so Node tests import it.
export const PULSE = { from: 0.4, to: 1, period: 1800 }; // .loop("opacity", PULSE)
export const GLOW_ANGLE = 180; // top sheen gradient: top to bottom

// Corner radii: .rounded(RADIUS.control) for buttons and inputs, card for cards, overlay for overlays.
export const RADIUS = { control: 6, card: 8, overlay: 14 };

// "#rrggbb" or "#rrggbbaa" in, "#rrggbb" + two hex digits of round(a * 255) out.
export function alpha(color, a) {
  const level = Math.min(255, Math.max(0, Math.round(a * 255)));
  return color.slice(0, 7) + level.toString(16).padStart(2, "0");
}

// How far left to pull the header dot grid (6 px pitch) in a block whose left edge is at
// `blockX` in the window, so the grid lines up across blocks.
export const dotOffset = (blockX) => ((blockX % 6) + 6) % 6;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (channels) => "#" + channels.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");

// Relative luminance (WCAG) of "#rrggbb" (an alpha suffix is ignored).
function luminance(color) {
  const [r, g, b] = rgb(color).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG contrast ratio of two "#rrggbb" colors, 1 to 21.
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// True when the theme background is light. A theme without a background counts as dark.
export const isLight = (t) => typeof t.background === "string" && luminance(t.background) > 0.5;

// "#rrggbb" blend of a toward b: w = 0 gives a, w = 1 gives b.
export const mix = (a, b, w) => {
  const [ca, cb] = [rgb(a), rgb(b)];
  return hex(ca.map((c, i) => c + (cb[i] - c) * w));
};

// The avatar letter for a space mark: the mark pushed toward black (light theme) or white
// (dark theme), from weight 0.25 in 0.05 steps up to 0.6, until it reaches 4.5:1 against the
// avatar (mark at 20 % over t.chrome).
export function markLetter(mark, t) {
  const toward = isLight(t) ? "#000000" : "#ffffff";
  const avatar = mix(t.chrome, mark, 0.2);
  let w = 0.25;
  while (w < 0.6 && contrast(mix(mark, toward, w), avatar) < 4.5) w = Math.round((w + 0.05) * 100) / 100;
  return mix(mark, toward, w);
}

// Derived tokens from theme(): full #rrggbbaa colors of the Graphite Glass look.
export function tokens(t) {
  return {
    dot: alpha(t.foreground, isLight(t) ? 0.16 : 0.11), // header dot texture
    accentTrack: alpha(t.accent, 0.12), // working bar track
    highlight: alpha(t.foreground, isLight(t) ? 0.08 : 0.05), // inset top line
    glass: alpha(t.chrome, 0.55),
    mainGlass: alpha(t.canvas, 0.35),
    line: alpha(t.foreground, 0.07),
    pill: alpha(t.foreground, 0.06), // hover too
    accentSoft: alpha(t.accent, 0.18), // selected rows, folder fill
    changeMark: alpha(t.accent, 0.12), // tint of a note block an outside program changed (the 2 px bar is t.accent)
    glow: alpha(t.foreground, 0.05), // top sheen, neutral
    glowEnd: alpha(t.foreground, 0),
    blockedSoft: alpha(t.blocked, 0.15),
    node: t.muted,
    nodeFar: alpha(t.muted, 0.8),
    edge: alpha(t.foreground, 0.22), // graph edge, suggestion ring
    edgeHot: t.foreground,
  };
}

// Status dot recipe: a fill or a ring, and whether it pulses.
export function statusDot(t, status) {
  if (status === "working") return { fill: t.working, ring: null, pulse: true };
  if (status === "blocked" || status === "done") return { fill: t[status], ring: null, pulse: false };
  if (status === "idle") return { fill: null, ring: t.idle, pulse: false };
  return { fill: t.unknown, ring: null, pulse: false };
}
