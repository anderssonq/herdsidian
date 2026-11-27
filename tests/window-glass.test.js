import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isGlass, withGlass } from "../mods/herdsidian/glass.js";
import { CLEAR, isLight } from "../lib/tokens.js";
import { settingSections, SETTING_DEFAULTS } from "../lib/keys.js";
import { modelKey, sameKey } from "../mods/herdsidian/palette.js";

const shipped = JSON.parse(readFileSync(new URL("../layouts/herdsidian.json", import.meta.url), "utf8"));
const frames = (node, out = []) => {
  if (node?.content?.pane) out.push(node.content.pane);
  for (const c of node?.children ?? []) frames(c, out);
  return out;
};

test("the shipped layout has the glass on: clear root and theme background, blur, terminals on the pane frame", () => {
  assert.equal(isGlass(shipped), true);
  assert.equal(shipped.background, CLEAR);
  assert.equal(shipped.colors.background, CLEAR);
  assert.equal(shipped.window_blur, true);
  assert.equal(shipped.terminal_opacity, 0);
  assert.deepEqual(frames(shipped).map((p) => p.background), ["surface"]);
});

test("withGlass off gives the matte look: a plain chrome root, terminals still on the pane frame, no colors override", () => {
  const off = withGlass(shipped, false);
  assert.equal(isGlass(off), false);
  assert.equal(off.background, "chrome");
  assert.equal("colors" in off, false);
  assert.equal(off.terminal_opacity, 0);
  assert.deepEqual(frames(off).map((p) => p.background), ["surface"]);
  assert.equal(off.window_blur, true, "the blur stays set up, so turning it back on needs no restart");
});

test("withGlass round-trips and never changes nodes, sizes or the input tree", () => {
  const before = JSON.stringify(shipped);
  const back = withGlass(withGlass(shipped, false), true);
  assert.deepEqual(back, shipped);
  assert.equal(JSON.stringify(shipped), before);
  assert.deepEqual(withGlass(shipped, false).children, shipped.children);
});

test("withGlass keeps other color overrides", () => {
  const tree = { ...shipped, colors: { background: CLEAR, accent: "#123456" } };
  assert.deepEqual(withGlass(tree, false).colors, { accent: "#123456" });
  assert.deepEqual(withGlass(withGlass(tree, false), true).colors, { accent: "#123456", background: CLEAR });
});

test("isLight falls back to canvas when the layout clears background", () => {
  assert.equal(isLight({ background: CLEAR, canvas: "#e8e8e8" }), true);
  assert.equal(isLight({ background: CLEAR, canvas: "#0e0e0e" }), false);
  assert.equal(isLight({ background: "#ffffff", canvas: "#000000" }), true);
});

const base = { settings: SETTING_DEFAULTS, sidebarHidden: false, sidebarRail: false, sidebarTab: "notes" };

test("General shows Window glass after Key hints only when the layout's glass is known", () => {
  assert.deepEqual(settingSections(base)[0].rows.map((r) => r.id), ["key-hints"]);
  const on = settingSections({ ...base, glass: true })[0].rows;
  assert.deepEqual(on.map((r) => r.id), ["key-hints", "window-glass"]);
  assert.equal(on[1].label, "Window glass");
  assert.equal(on[1].detail, "On");
  assert.deepEqual(on[1].action, { type: "glass" });
  assert.equal(settingSections({ ...base, glass: false })[0].rows[1].detail, "Off");
});

test("the palette memo changes when the glass changes", () => {
  const key = { query: "", tab: "settings", agents: [], settings: SETTING_DEFAULTS };
  assert.ok(!sameKey(modelKey({ ...key, glass: true }), modelKey({ ...key, glass: false })));
});
