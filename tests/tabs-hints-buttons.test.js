// V5 on the toolbar's + button, Search and sidebar toggle: the key shows inline only for "always";
// tooltips carry the key for "always" and "modifier" (hover is the fallback), never for "off".
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, element, walk } from "./support/mod-stubs.js";

const stubs = globalThis.__herdsidianStubs;
stubs["gpui-kit"].div = () => element("div");
stubs["gpui-kit"].svg = () => element("svg");
stubs["gpui-base"].h_flex = () => element("div");
stubs.herdr.spaces = () => [{ id: "s1", name: "alpha", active: true, tabs: [] }];
stubs.herdr.keys = () => [
  { section: "global", action: "tab.new", keys: "cmd-t" },
  { section: "global", action: "mod.open:herdsidian", keys: "cmd-k" },
  { section: "global", action: "herdsidian-tabs.notes", keys: "cmd-shift-o" },
];
stubs.herdr.theme = () => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : "#808080") });

const { default: Tabs } = await import("../mods/herdsidian-tabs/main.js");

const call = (node, name) => node.calls.find(([n]) => n === name)?.[1];
const byId = (tree, id) => walk(tree).find((n) => call(n, "id")?.[0] === id);
const texts = (node) => walk(node).flatMap((n) => n.kids.filter((c) => typeof c === "string"));
const setHints = (keyHints) => { state.shared["herdsidian.settings"] = { keyHints }; };

beforeEach(() => { state.shared = {}; });

const tree = () => {
  const view = new Tabs(), cx = fakeCx();
  view.init({}, cx);
  return view.render(cx);
};

test('"always" shows the + and Search keys inline', () => {
  setHints("always");
  const t = tree();
  assert.ok(texts(byId(t, "tab-new")).includes("⌘T"));
  assert.ok(texts(byId(t, "search")).includes("⌘K"));
});

test('"modifier" and "off" show no inline key on + and Search', () => {
  for (const hints of ["modifier", "off"]) {
    setHints(hints);
    const t = tree();
    assert.ok(!texts(byId(t, "tab-new")).includes("⌘T"), hints);
    assert.ok(!texts(byId(t, "search")).includes("⌘K"), hints);
  }
});

test('the + and sidebar toggle tooltips carry the key for "always" and "modifier"', () => {
  for (const hints of ["always", "modifier"]) {
    setHints(hints);
    const t = tree();
    assert.match(call(byId(t, "tab-new"), "tooltip")[0], /⌘T/, hints);
    assert.equal(call(byId(t, "sidebar-toggle"), "tooltip")[0], "Right sidebar", hints);
  }
});

test('"off" tooltips have no key', () => {
  setHints("off");
  const t = tree();
  assert.equal(call(byId(t, "tab-new"), "tooltip")[0], "New tab");
  assert.equal(call(byId(t, "sidebar-toggle"), "tooltip")[0], "Right sidebar");
});
