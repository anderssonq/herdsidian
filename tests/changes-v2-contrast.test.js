import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import * as lib from "../lib/tokens.js";
import { themeOf } from "./support/themes.js";

// WCAG contrast and compositing, written here and not taken from the code under test.
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const lum = (c) => {
  const [r, g, b] = rgb(c).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
// "#rrggbbaa" over an opaque "#rrggbb".
const over = (top, under) => {
  const a = parseInt(top.slice(7, 9), 16) / 255;
  const t = rgb(top), u = rgb(under);
  return "#" + t.map((c, i) => Math.round(c * a + u[i] * (1 - a)).toString(16).padStart(2, "0")).join("");
};

const names = readdirSync(new URL("../themes/", import.meta.url)).map((f) => /^hs_(.*)\.json$/.exec(f)?.[1]).filter(Boolean);

// The surfaces of the plan's Decision 5 (A8): glass off, the sidebar is the glass over chrome and the code area is the sidebar;
// glass on, the sidebar is the glass over white and over black, and the code area is the well over each.
const surfaces = (t, d, glass) => {
  const k = lib.tokens(t);
  const sidebars = glass ? ["#ffffff", "#000000"].map((b) => over(k.glass, b)) : [over(k.glass, t.chrome)];
  return sidebars.map((sidebar) => {
    const code = glass ? over(d.well, sidebar) : sidebar;
    return {
      sidebar, code,
      addLine: over(d.addLine, code), delLine: over(d.delLine, code), hunk: over(d.hunk, code),
      addWord: over(d.addWord, over(d.addLine, code)), delWord: over(d.delWord, over(d.delLine, code)),
    };
  });
};

test("there are 8 theme files", () => assert.equal(names.length, 8));

for (const name of names) {
  for (const glass of [false, true]) {
    test(`AC45 hs_${name}, glass ${glass ? "on" : "off"}: text, numText, addText and delText reach 4.5:1`, () => {
      const t = themeOf(name, { glass });
      const d = lib.diffTokens(t);
      for (const s of surfaces(t, d, glass)) {
        const check = (token, on, label) => assert.ok(ratio(d[token], s[on]) >= 4.5, `${token} on ${label}: ${ratio(d[token], s[on]).toFixed(2)}`);
        for (const on of ["code", "addWord", "delWord"]) check("text", on, on);
        for (const on of ["code", "addLine", "delLine", "hunk"]) check("numText", on, on);
        for (const on of ["sidebar", "code", "addLine"]) check("addText", on, on);
        for (const on of ["sidebar", "code", "delLine"]) check("delText", on, on);
      }
    });
  }
}
