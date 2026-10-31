// Theme-derived color tokens (ADR-0001). Canonical copy: lib/tokens.js.
// Each mod carries a byte-identical copy as mods/<mod>/tokens.js (`npm run lint` checks it).
// Pure: no gpui-kit / herdr imports, so Node tests import it.
export const HIGHLIGHT = "#ffffff0d"; // inset top line, white 5 %
export const PULSE = { from: 0.4, to: 1, period: 1800 }; // .loop("opacity", PULSE)
export const GLOW_ANGLE = 180; // top sheen gradient: top to bottom

// "#rrggbb" or "#rrggbbaa" in, "#rrggbb" + two hex digits of round(a * 255) out.
export function alpha(color, a) {
  const level = Math.min(255, Math.max(0, Math.round(a * 255)));
  return color.slice(0, 7) + level.toString(16).padStart(2, "0");
}

// Derived tokens from theme(): full #rrggbbaa colors of the Graphite Glass look.
export function tokens(t) {
  return {
    glass: alpha(t.chrome, 0.55),
    mainGlass: alpha(t.canvas, 0.35),
    line: alpha(t.foreground, 0.07),
    pill: alpha(t.foreground, 0.06), // hover too
    accentSoft: alpha(t.accent, 0.18), // selected rows, folder fill
    glow: alpha(t.foreground, 0.05), // top sheen, neutral
    glowEnd: alpha(t.foreground, 0),
    blockedSoft: alpha(t.blocked, 0.15),
  };
}

// Status dot recipe: a fill or a ring, and whether it pulses.
export function statusDot(t, status) {
  if (status === "working") return { fill: t.working, ring: null, pulse: true };
  if (status === "blocked" || status === "done") return { fill: t[status], ring: null, pulse: false };
  if (status === "idle") return { fill: null, ring: t.idle, pulse: false };
  return { fill: t.unknown, ring: null, pulse: false };
}
