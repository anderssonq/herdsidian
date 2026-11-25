// gitTokens(t): lane colors, pills, initials ink and error text, over the 8 theme files, glass off and on.
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

// The sidebar surfaces of A5: glass off, the glass over chrome; glass on, the glass over white and over black.
// t.background is never read here: with the glass on it is transparent.
const sidebars = (t, glass) => {
  const sheet = lib.tokens(t).glass;
  return glass ? ["#ffffff", "#000000"].map((b) => over(sheet, b)) : [over(sheet, t.chrome)];
};

const ORDER = ["ansi4", "ansi2", "ansi5", "ansi3", "ansi6", "ansi1"];
const HEX6 = /^#[0-9a-f]{6}$/;
const HEX8 = /^#[0-9a-f]{8}$/;

test("there are 8 theme files", () => assert.equal(names.length, 8));

test("AC33 gitTokens is exported", () => assert.equal(typeof lib.gitTokens, "function"));

for (const name of names) {
  for (const glass of [false, true]) {
    const label = `hs_${name}, glass ${glass ? "on" : "off"}`;

    test(`AC31 ${label}: six lanes, raw in the order ansi4, ansi2, ansi5, ansi3, ansi6, ansi1`, () => {
      const t = themeOf(name, { glass });
      const g = lib.gitTokens(t);
      assert.deepEqual(Object.keys(g).sort(), ["errorText", "lanes"]);
      assert.equal(g.lanes.length, 6);
      assert.deepEqual(g.lanes.map((l) => l.raw), ORDER.map((k) => t[k]));
      for (const l of g.lanes) {
        assert.deepEqual(Object.keys(l).sort(), ["ink", "line", "pillBg", "pillText", "raw"]);
        for (const k of ["raw", "ink", "line", "pillText"]) assert.match(l[k], HEX6, k);
        assert.match(l.pillBg, HEX8, "pillBg");
      }
      assert.match(g.errorText, HEX6);
    });

    test(`AC31 ${label}: line has 3:1 on every sidebar surface, and equals raw where raw already passes`, () => {
      const t = themeOf(name, { glass });
      const surfaces = sidebars(t, glass);
      lib.gitTokens(t).lanes.forEach((l, i) => {
        for (const s of surfaces) assert.ok(ratio(l.line, s) >= 3, `lane ${i} line ${l.line} on ${s}: ${ratio(l.line, s).toFixed(2)}`);
        if (surfaces.every((s) => ratio(l.raw, s) >= 3)) assert.equal(l.line, l.raw, `lane ${i}`);
      });
    });

    test(`AC32 ${label}: pillBg is raw at 16 %`, () => {
      // 0.16 * 255 = 40.8, rounded to 41 = 0x29.
      for (const l of lib.gitTokens(themeOf(name, { glass })).lanes) assert.equal(l.pillBg, `${l.raw}29`);
    });

    test(`AC32 ${label}: pillText has 4.5:1 over pillBg on every sidebar surface`, () => {
      const t = themeOf(name, { glass });
      const surfaces = sidebars(t, glass);
      lib.gitTokens(t).lanes.forEach((l, i) => {
        for (const s of surfaces) {
          const bg = over(l.pillBg, s);
          assert.ok(ratio(l.pillText, bg) >= 4.5, `lane ${i} pillText ${l.pillText} over ${bg}: ${ratio(l.pillText, bg).toFixed(2)}`);
        }
      });
    });

    test(`AC30 ${label}: ink is the better of black and white and has 4.5:1 on raw`, () => {
      lib.gitTokens(themeOf(name, { glass })).lanes.forEach((l, i) => {
        assert.ok(l.ink === "#000000" || l.ink === "#ffffff", `lane ${i} ink ${l.ink}`);
        const other = l.ink === "#000000" ? "#ffffff" : "#000000";
        assert.ok(ratio(l.ink, l.raw) >= ratio(other, l.raw), `lane ${i}: ${l.ink} is not the better one on ${l.raw}`);
        assert.ok(ratio(l.ink, l.raw) >= 4.5, `lane ${i} ink on raw: ${ratio(l.ink, l.raw).toFixed(2)}`);
      });
    });

    test(`AC50 ${label}: errorText has 4.5:1 on every sidebar surface, and equals t.blocked where it already passes`, () => {
      const t = themeOf(name, { glass });
      const surfaces = sidebars(t, glass);
      const { errorText } = lib.gitTokens(t);
      for (const s of surfaces) assert.ok(ratio(errorText, s) >= 4.5, `errorText ${errorText} on ${s}: ${ratio(errorText, s).toFixed(2)}`);
      if (surfaces.every((s) => ratio(t.blocked, s) >= 4.5)) assert.equal(errorText, t.blocked);
    });

    test(`AC31 ${label}: a theme with no working or idle key gives no undefined value`, () => {
      const t = themeOf(name, { glass });
      delete t.working;
      delete t.idle;
      const g = lib.gitTokens(t);
      assert.equal(typeof g.errorText, "string");
      for (const l of g.lanes) for (const v of Object.values(l)) assert.equal(typeof v, "string");
    });
  }
}

test("AC33 tokens(t) has the same keys as before", () => {
  assert.deepEqual(Object.keys(lib.tokens(themeOf("carbon"))), [
    "dot", "accentTrack", "highlight", "glass", "mainGlass", "line", "pill", "accentSoft", "changeMark",
    "glow", "glowEnd", "blockedSoft", "node", "nodeFar", "edge", "edgeHot",
  ]);
});

test("AC33 diffTokens(t) has the same keys as before", () => {
  assert.deepEqual(Object.keys(lib.diffTokens(themeOf("carbon"))).sort(), [
    "addLine", "addMark", "addText", "addWord", "delLine", "delMark", "delText", "delWord", "hunk", "numText", "text", "well",
  ]);
});

test("AC33 gitTokens changes nothing in tokens(t) and diffTokens(t)", () => {
  const t = themeOf("carbon", { glass: true });
  const before = JSON.stringify([lib.tokens(t), lib.diffTokens(t)]);
  lib.gitTokens(t);
  assert.equal(JSON.stringify([lib.tokens(t), lib.diffTokens(t)]), before);
});
