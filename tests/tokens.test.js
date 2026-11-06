import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { GLOW_ANGLE, PULSE, alpha, contrast, dotOffset, isLight, markLetter, mix, statusDot, tokens } from "../lib/tokens.js";

test("dotOffset keeps the 6 px grid aligned, also for fractions and negatives", () => {
  assert.equal(dotOffset(0), 0);
  assert.equal(dotOffset(248), 2);
  assert.equal(dotOffset(252), 0);
  assert.equal(dotOffset(248.5), 2.5);
  assert.equal(dotOffset(-1), 5);
});

const theme = {
  background: "#0f0f0f", chrome: "#1a1a1a", canvas: "#0a0a0a", foreground: "#eeeeee", muted: "#a8a8a8", accent: "#4c9df3",
  blocked: "#e5484d", working: "#f5a524", done: "#3fae6a", idle: "#808080", unknown: "#555555",
};

test("tokens carry the exact alpha suffixes", () => {
  const k = tokens(theme);
  assert.equal(k.glass, "#1a1a1a8c");
  assert.equal(k.mainGlass, "#0a0a0a59");
  assert.equal(k.line, "#eeeeee12");
  assert.equal(k.pill, "#eeeeee0f");
  assert.equal(k.accentSoft, "#4c9df32e");
  assert.equal(k.glow, "#eeeeee0d");
  assert.equal(k.glowEnd, "#eeeeee00");
  assert.equal(k.blockedSoft, "#e5484d26");
  assert.equal("workingLine" in k, false);
  assert.equal(k.highlight, "#eeeeee0d"); // dark: foreground at 0.05
  assert.equal(tokens({ ...theme, background: "#ffffff", foreground: "#111111" }).highlight, "#11111114"); // light: 0.08
});

test("constants keep their contract values", () => {
  assert.equal(GLOW_ANGLE, 180);
  assert.deepEqual(PULSE, { from: 0.4, to: 1, period: 1800 });
});

test("alpha adds two hex digits and replaces an existing alpha", () => {
  assert.equal(alpha("#112233", 0.5), "#11223380");
  assert.equal(alpha("#112233", 1), "#112233ff");
  assert.equal(alpha("#112233ff", 0), "#11223300");
  assert.equal(alpha("#11223380", 0.55), "#1122338c");
});

test("statusDot picks fill, ring and pulse per status", () => {
  assert.deepEqual(statusDot(theme, "working"), { fill: theme.working, ring: null, pulse: true });
  assert.deepEqual(statusDot(theme, "blocked"), { fill: theme.blocked, ring: null, pulse: false });
  assert.deepEqual(statusDot(theme, "done"), { fill: theme.done, ring: null, pulse: false });
  assert.deepEqual(statusDot(theme, "idle"), { fill: null, ring: theme.idle, pulse: false });
  assert.deepEqual(statusDot(theme, "weird"), { fill: theme.unknown, ring: null, pulse: false });
});

const themesDir = new URL("../themes/", import.meta.url);
const themes = readdirSync(themesDir).filter((f) => /^hs_.*\.json$/.test(f)).map((f) => {
  const json = JSON.parse(readFileSync(new URL(f, themesDir), "utf8"));
  return { name: f.replace(".json", ""), background: json.background, chrome: json.colors.chrome };
});
const MARKS = ["#22a99a", "#e3814f", "#5b8def", "#8b7cf6", "#3fae6a", "#d9649a"];

test("isLight is true for the 4 light themes and false for the 4 dark ones", () => {
  assert.equal(themes.length, 8);
  for (const th of themes) assert.equal(isLight(th), th.name.endsWith("_light"), th.name);
});

test("markLetter reaches 4.5:1 for every mark in every theme", () => {
  for (const th of themes) {
    for (const mark of MARKS) {
      const avatar = mix(th.chrome, mark, 0.2);
      const ratio = contrast(markLetter(mark, th), avatar);
      assert.ok(ratio >= 4.5, `${th.name} ${mark}: ${ratio.toFixed(2)}`);
    }
  }
});

test("mix returns a at 0, b at 1 and the middle at 0.5", () => {
  assert.equal(mix("#102030", "#f0e0d0", 0), "#102030");
  assert.equal(mix("#102030", "#f0e0d0", 1), "#f0e0d0");
  assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
});

test("dot and accentTrack carry their alpha suffixes", () => {
  assert.equal(tokens(theme).dot, "#eeeeee1c"); // dark: 0.11
  assert.equal(tokens({ ...theme, background: "#ffffff", foreground: "#111111" }).dot, "#11111129"); // light: 0.16
  assert.equal(tokens(theme).accentTrack, "#4c9df31f");
});

test("graph tokens carry their alpha suffixes", () => {
  const k = tokens(theme);
  assert.equal(k.node, "#a8a8a8");
  assert.equal(k.nodeFar, "#a8a8a8cc");
  assert.equal(k.edge, "#eeeeee38");
  assert.equal(k.edgeHot, "#eeeeee");
});

test("changeMark is the accent at an alpha of 0.18 at most", () => {
  const k = tokens(theme);
  assert.equal(k.changeMark, "#4c9df31f");
  assert.ok(parseInt(k.changeMark.slice(7), 16) / 255 <= 0.18);
});

test("foreground over the changeMark tint keeps 4.5:1 on the background in every theme", () => {
  const dir = new URL("../themes/", import.meta.url);
  const files = readdirSync(dir).filter((f) => /^hs_.*\.json$/.test(f));
  assert.equal(files.length, 8);
  for (const f of files) {
    const json = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    const t = { ...json.colors, background: json.background, foreground: json.foreground };
    const tint = tokens(t).changeMark;
    const level = parseInt(tint.slice(7), 16) / 255;
    const ratio = contrast(t.foreground, mix(t.background, tint.slice(0, 7), level));
    assert.ok(ratio >= 4.5, `${f}: ${ratio.toFixed(2)}`);
  }
});
