import { test } from "node:test";
import assert from "node:assert/strict";
import { GLOW_ANGLE, HIGHLIGHT, PULSE, alpha, statusDot, tokens } from "../lib/tokens.js";

const theme = {
  chrome: "#1a1a1a", canvas: "#0a0a0a", foreground: "#eeeeee", muted: "#a8a8a8", accent: "#4c9df3",
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
  assert.equal("highlight" in k, false);
});

test("constants keep their contract values", () => {
  assert.equal(HIGHLIGHT, "#ffffff0d");
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

test("graph tokens carry their alpha suffixes", () => {
  const k = tokens(theme);
  assert.equal(k.node, "#a8a8a8");
  assert.equal(k.nodeFar, "#a8a8a8cc");
  assert.equal(k.edge, "#eeeeee38");
  assert.equal(k.edgeHot, "#eeeeee");
});
