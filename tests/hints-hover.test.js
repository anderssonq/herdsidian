// V5: key hints on the rows of Spaces (⌃N) and Agents (⌘⌥N). "always" shows them on every row,
// "modifier" (a mod cannot see modifier keys, so: on row hover) only on the hovered row, "off" never.
// The header hint lines live in tooltips on the section header.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, element, walk } from "./support/mod-stubs.js";

const stubs = globalThis.__herdsidianStubs;
const SPACES = [
  { id: "a", name: "alpha", folder: "/r/a", tabs: [], status: "idle" },
  { id: "b", name: "beta", folder: "/r/b", tabs: [], status: "idle" },
];
const AGENTS = [
  { address: "t1", pane: "p1", status: "idle", seq: 2, space: "a", space_name: "alpha" }, // the list puts the newest first
  { address: "t2", pane: "p2", status: "idle", seq: 1, space: "a", space_name: "alpha" },
];
stubs["gpui-kit"].div = () => element("div");
stubs["gpui-kit"].svg = () => element("svg");
stubs["gpui-base"].h_flex = () => element("div");
stubs["gpui-base"].v_flex = () => element("div");
stubs.herdr.spaces = () => SPACES;
stubs.herdr.panes = () => [];
stubs.herdr.terminals = () => [];
stubs.herdr.agents = () => AGENTS;
stubs.herdr.focused = () => null;
stubs.herdr.theme = () => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : "#808080") });

const { default: Spaces } = await import("../mods/guide-spaces/main.js");
const { default: Agents } = await import("../mods/guide-agents/main.js");

const call = (node, name) => node.calls.find(([n]) => n === name)?.[1];
const byId = (tree, id) => walk(tree).find((n) => call(n, "id")?.[0] === id);
const texts = (node) => walk(node).flatMap((n) => n.kids.filter((c) => typeof c === "string"));
const setHints = (keyHints) => { state.shared["herdsidian.settings"] = { keyHints }; };

beforeEach(() => { state.shared = {}; });

const spaces = () => {
  const view = new Spaces(), cx = fakeCx();
  cx.timer = { every() {} };
  view.init({}, cx);
  return { view, cx, tree: () => view.render(cx), row: (id) => byId(view.render(cx), `space-${id}`) };
};
const agents = () => {
  const view = new Agents(), cx = fakeCx();
  view.init({}, cx);
  return { view, cx, tree: () => view.render(cx), row: (addr) => byId(view.render(cx), `ag-${addr}`) };
};
const hover = (node, on, cx) => call(node, "on_hover")[0](on, cx);

for (const [name, make, cap, rowId, other] of [
  ["Spaces", spaces, (i) => `⌃${i}`, "a", "b"],
  ["Agents", agents, (i) => `⌘⌥${i}`, "t1", "t2"],
]) {
  test(`${name}: "always" shows the key on every row, with no hover`, () => {
    setHints("always");
    const m = make();
    assert.ok(texts(m.row(rowId)).includes(cap(1)));
    assert.ok(texts(m.row(other)).includes(cap(2)));
  });

  test(`${name}: "modifier" shows the key only on the hovered row`, () => {
    setHints("modifier");
    const m = make();
    assert.ok(!texts(m.row(rowId)).includes(cap(1)));
    assert.ok(!texts(m.row(other)).includes(cap(2)));
    hover(m.row(other), true, m.cx);
    assert.ok(texts(m.row(other)).includes(cap(2)));
    assert.ok(!texts(m.row(rowId)).includes(cap(1)));
    hover(m.row(other), false, m.cx);
    assert.ok(!texts(m.row(other)).includes(cap(2)));
  });

  test(`${name}: "off" shows the key on no row, even hovered`, () => {
    setHints("off");
    const m = make();
    hover(m.row(rowId), true, m.cx);
    assert.ok(!texts(m.row(rowId)).includes(cap(1)));
    assert.ok(!texts(m.row(other)).includes(cap(2)));
  });

  test(`${name}: the old boolean true behaves as "always", false as "off"`, () => {
    state.shared["herdsidian.settings"] = { keyHints: true };
    assert.ok(texts(make().row(rowId)).includes(cap(1)));
    state.shared["herdsidian.settings"] = { keyHints: false };
    assert.ok(!texts(make().row(rowId)).includes(cap(1)));
  });
}

test("Spaces: the header hint is a tooltip, not text; off has no tooltip", () => {
  for (const hints of ["always", "modifier"]) {
    setHints(hints);
    const tree = spaces().tree();
    assert.ok(!texts(tree).some((s) => s.includes("1–9")));
    assert.match(call(byId(tree, "spaces-fold"), "tooltip")[0], /1–9/);
  }
  setHints("off");
  assert.equal(call(byId(spaces().tree(), "spaces-fold"), "tooltip"), undefined);
});

test("Agents: the header hint line is a tooltip on the header, not text; off has no tooltip", () => {
  for (const hints of ["always", "modifier"]) {
    setHints(hints);
    const tree = agents().tree();
    assert.ok(!texts(tree).some((s) => s.includes("1–9")));
    assert.match(call(byId(tree, "ag-section"), "tooltip")[0], /⌘⌥ 1–9 · ⌘\[ ⌘\]/);
  }
  setHints("off");
  assert.equal(call(byId(agents().tree(), "ag-section"), "tooltip"), undefined);
});

test("Agents: the hovered row's key hides again when the pointer leaves", () => {
  setHints("modifier");
  const m = agents();
  hover(m.row("t1"), true, m.cx);
  hover(m.row("t1"), false, m.cx);
  assert.ok(!texts(m.row("t1")).includes("⌘⌥1"));
});
