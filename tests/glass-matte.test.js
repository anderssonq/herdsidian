// Window glass, second look: a per-theme sheet opacity with the glass on, and a matte look with it off.
// Expected opacity levels are worked out by hand from themes/hs_*.json (no tokens() call): the lowest
// opacity from 70 % up, in 1 % steps, where `foreground` and `muted` reach 4.5:1 on the sheet over a pure
// white and a pure black desktop; level = round(percent / 100 * 255). No such step: opaque (ff).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CLEAR, contrast, mix, tokens } from "../lib/tokens.js";
import { flipGlass, gutterOf, isGlass, withGlass } from "../lib/glass.js";
import { themeOf } from "./support/themes.js";

// [glass (chrome sheet), mainGlass (canvas sheet)]
const LEVELS = {
  carbon: ["d6", "d4"], // 84 %, 83 %
  carbon_light: ["f0", "fa"], // 94 %, 98 %
  catppuccin: ["c9", "c2"], // 79 %, 76 %
  catppuccin_light: ["fa", "ff"], // 98 %, opaque
  midnight: ["d4", "d4"], // 83 %, 83 %
  midnight_light: ["ff", "ff"], // opaque, opaque
  nord: ["e3", "de"], // 89 %, 87 %
  nord_light: ["e3", "f0"], // 89 %, 94 %
};

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const over = (top, under) => {
  const a = parseInt(top.slice(7, 9), 16) / 255;
  const [ct, cu] = [rgb(top), rgb(under)];
  return "#" + ct.map((c, i) => Math.round(c * a + cu[i] * (1 - a)).toString(16).padStart(2, "0")).join("");
};

for (const [name, [glass, main]] of Object.entries(LEVELS)) {
  test(`glass on, hs_${name}: each sheet has its own opacity, the lowest that keeps the text at 4.5:1`, () => {
    const t = themeOf(name, { glass: true });
    const k = tokens(t);
    assert.equal(k.glass, mix(t.chrome, t.accent, 0.05) + glass);
    assert.equal(k.mainGlass, mix(t.canvas, t.accent, 0.05) + main);
  });

  test(`glass on, hs_${name}: a sheet that is not opaque keeps foreground and muted at 4.5:1 over white and black`, () => {
    const t = themeOf(name, { glass: true });
    const k = tokens(t);
    for (const sheet of [k.glass, k.mainGlass]) {
      if (sheet.endsWith("ff")) continue;
      for (const desktop of ["#ffffff", "#000000"]) {
        for (const text of ["foreground", "muted"]) {
          const ratio = contrast(t[text], over(sheet, desktop));
          assert.ok(ratio >= 4.5, `${text} on ${sheet} over ${desktop}: ${ratio.toFixed(2)}`);
        }
      }
    }
  });

  test(`glass off, hs_${name}: the sheets are opaque and keep the 5 % accent tint`, () => {
    const t = themeOf(name);
    const k = tokens(t);
    assert.equal(k.glass, mix(t.chrome, t.accent, 0.05) + "ff");
    assert.equal(k.mainGlass, mix(t.canvas, t.accent, 0.05) + "ff");
  });
}

const shipped = JSON.parse(readFileSync(new URL("../layouts/herdsidian.json", import.meta.url), "utf8"));
const frames = (node, out = []) => {
  if (node?.content?.pane) out.push(node.content.pane);
  for (const c of node?.children ?? []) frames(c, out);
  return out;
};

test("withGlass off is matte: a plain chrome root, no gradient, no colors override", () => {
  const off = withGlass(shipped, false);
  assert.equal(isGlass(off), false);
  assert.equal(off.background, "chrome");
  assert.equal("colors" in off, false);
  assert.equal(off.window_blur, true, "the blur stays set up, so turning the glass back on needs no restart");
});

test("withGlass off keeps the terminals as they are with the glass on: on the pane frame, in surface", () => {
  const off = withGlass(shipped, false);
  assert.equal(off.terminal_opacity, shipped.terminal_opacity);
  assert.equal(off.terminal_opacity, 0);
  assert.deepEqual(frames(off).map((p) => p.background), frames(shipped).map((p) => p.background));
  assert.deepEqual(frames(off).map((p) => p.background), ["surface"]);
});

test("withGlass off changes nothing under the root but the look fields, and round-trips", () => {
  const before = JSON.stringify(shipped);
  assert.deepEqual(withGlass(shipped, false).children, shipped.children);
  assert.deepEqual(withGlass(withGlass(shipped, false), true), shipped);
  assert.equal(JSON.stringify(shipped), before);
});

test("withGlass moves a layout saved by the old switch (gradient, terminals on background) to the new looks", () => {
  const old = JSON.parse(JSON.stringify(shipped));
  delete old.colors;
  old.background = { gradient: ["chrome", "canvas"], angle: 160 };
  old.terminal_opacity = 1;
  for (const p of frames(old)) p.background = "background";
  assert.deepEqual(withGlass(old, true), shipped);
  assert.deepEqual(withGlass(old, false), withGlass(shipped, false));
  assert.equal(withGlass(shipped, true).colors.background, CLEAR);
});

test("glass on: a second call gives the same sheets, and a changed text color gives its own", () => {
  const t = themeOf("carbon", { glass: true });
  const k = tokens(t);
  assert.deepEqual(tokens(t), k);
  // A brighter muted needs less sheet under it, so the opacity goes down.
  const brighter = tokens({ ...t, muted: t.foreground });
  assert.ok(parseInt(brighter.glass.slice(7), 16) < parseInt(k.glass.slice(7), 16));
  assert.deepEqual(tokens(t), k);
});

test("flipGlass on a matte layout turns the glass on with the gutter in the theme's sheet, read from an opaque theme", () => {
  const matte = withGlass(shipped, false);
  const on = flipGlass(matte, themeOf("carbon"));
  assert.equal(isGlass(on), true);
  assert.equal(gutterOf(on), "#15191dd6"); // #121212 toward #4c9df3 by 5 %, at 84 %
  const { children: _a, ...look } = on, { children: _b, ...shippedLook } = shipped;
  assert.deepEqual(look, shippedLook);
});

test("flipGlass on a glass layout turns it off and puts the gutter back to chrome", () => {
  const on = flipGlass(withGlass(shipped, false), themeOf("nord"));
  assert.equal(gutterOf(on), "#2f3642e3"); // #2a2f3a toward #88c0d0 by 5 %, at 89 %
  const off = flipGlass(on, themeOf("nord"));
  assert.equal(isGlass(off), false);
  assert.equal(gutterOf(off), "chrome");
  assert.deepEqual(off, withGlass(shipped, false));
});
