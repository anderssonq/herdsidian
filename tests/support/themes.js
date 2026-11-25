// A theme as herdr.theme() gives it, built from themes/hs_<name>.json. Pure: it loads no mod and no kit.
import { readFileSync } from "node:fs";
import { CLEAR } from "../../lib/tokens.js";

// The flat colors and ansi0 to ansi15; `glass` clears the background.
export function themeOf(name, { glass = false } = {}) {
  const raw = JSON.parse(readFileSync(new URL(`../../themes/hs_${name}.json`, import.meta.url), "utf8"));
  const t = { background: raw.background, foreground: raw.foreground, selection: raw.selection, cursor: raw.cursor, ...raw.colors };
  raw.ansi.forEach((c, i) => { t[`ansi${i}`] = c; });
  if (glass) t.background = CLEAR;
  return t;
}
