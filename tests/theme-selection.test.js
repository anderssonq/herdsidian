// Every Herdsidian theme: the text selection stands out from the background (CIE76 ΔE ≥ 20), is not the
// hover or selected-row color (ΔE ≥ 8), and keeps the selected text readable (WCAG contrast ≥ 4.5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const dir = new URL("../themes/", import.meta.url);
const themes = readdirSync(dir).filter((f) => /^hs_.*\.json$/.test(f));

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => { const [r, g, b] = rgb(hex).map(linear); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function lab(hex) {
  const [r, g, b] = rgb(hex).map(linear);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

test("themes: there are eight Herdsidian themes", () => assert.equal(themes.length, 8));

for (const file of themes) {
  test(`${file}: the text selection is easy to see and its text stays readable`, () => {
    const t = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
    const s = t.selection;
    assert.ok(deltaE(s, t.background) >= 20, `selection ${s} vs background ${t.background}: ΔE ${deltaE(s, t.background).toFixed(1)}`);
    assert.ok(contrast(t.foreground, s) >= 4.5, `foreground on selection ${s}: ${contrast(t.foreground, s).toFixed(2)}`);
    assert.ok(deltaE(s, t.colors.hover) >= 8, `selection ${s} vs hover ${t.colors.hover}: ΔE ${deltaE(s, t.colors.hover).toFixed(1)}`);
    assert.ok(deltaE(s, t.colors.selected) >= 8, `selection ${s} vs selected ${t.colors.selected}: ΔE ${deltaE(s, t.colors.selected).toFixed(1)}`);
  });
}
