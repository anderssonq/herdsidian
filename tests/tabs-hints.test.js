// V5: the ⌘N key on the toolbar's tabs. "always" shows it on every tab, "modifier" (a mod cannot see
// modifier keys, so: on hover) only on the hovered tab, "off" never. No hint past the 9th tab.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, element, walk } from "./support/mod-stubs.js";

const stubs = globalThis.__herdsidianStubs;
const TABS = Array.from({ length: 10 }, (_, n) => ({ id: `t${n + 1}`, index: n + 1, name: `tab${n + 1}`, active: n === 0 }));
stubs["gpui-kit"].div = () => element("div");
stubs["gpui-kit"].svg = () => element("svg");
stubs["gpui-base"].h_flex = () => element("div");
stubs.herdr.spaces = () => [{ id: "s1", name: "alpha", active: true, tabs: TABS }];
stubs.herdr.keys = () => TABS.map((c) => ({ section: "global", action: `tab.select:${c.index}`, keys: `cmd-${c.index % 10}` }));
stubs.herdr.theme = () => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : "#808080") });

const { default: Tabs } = await import("../mods/herdsidian-tabs/main.js");

const call = (node, name) => node.calls.find(([n]) => n === name)?.[1];
const byId = (tree, id) => walk(tree).find((n) => call(n, "id")?.[0] === id);
const texts = (node) => walk(node).flatMap((n) => n.kids.filter((c) => typeof c === "string"));
const setHints = (keyHints) => { state.shared["herdsidian.settings"] = { keyHints }; };

beforeEach(() => { state.shared = {}; });

const make = () => {
  const view = new Tabs(), cx = fakeCx();
  view.init({}, cx);
  return { view, cx, tab: (n) => byId(view.render(cx), `tab-t${n}`) };
};
const hover = (node, on, cx) => call(node, "on_hover")[0](on, cx);

test('"always" shows the key on every tab, with no hover', () => {
  setHints("always");
  const m = make();
  for (const n of [1, 2, 9]) assert.ok(texts(m.tab(n)).includes(`⌘${n}`), `tab ${n}`);
});

test('"modifier" shows the key only on the hovered tab', () => {
  setHints("modifier");
  const m = make();
  assert.ok(!texts(m.tab(1)).includes("⌘1"));
  assert.ok(!texts(m.tab(2)).includes("⌘2"));
  hover(m.tab(2), true, m.cx);
  assert.ok(texts(m.tab(2)).includes("⌘2"));
  assert.ok(!texts(m.tab(1)).includes("⌘1"));
  hover(m.tab(2), false, m.cx);
  assert.ok(!texts(m.tab(2)).includes("⌘2"));
});

test('"off" shows the key on no tab, even hovered', () => {
  setHints("off");
  const m = make();
  hover(m.tab(2), true, m.cx);
  assert.ok(!texts(m.tab(1)).includes("⌘1"));
  assert.ok(!texts(m.tab(2)).includes("⌘2"));
});

test("the default setting behaves as on hover", () => {
  const m = make();
  assert.ok(!texts(m.tab(1)).includes("⌘1"));
  hover(m.tab(1), true, m.cx);
  assert.ok(texts(m.tab(1)).includes("⌘1"));
});

test("no tab past the 9th shows a hint, even with a binding", () => {
  setHints("always");
  const m = make();
  assert.ok(texts(m.tab(9)).includes("⌘9"));
  assert.ok(!texts(m.tab(10)).includes("⌘0"));
  hover(m.tab(10), true, m.cx);
  assert.ok(!texts(m.tab(10)).includes("⌘0"));
});
