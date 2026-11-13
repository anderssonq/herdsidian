// Last review fixes of the Archived feature: stray() can skip ids already put back, the put-back set
// forgets spaces that are gone, an agent archived only through its space keeps its duration on hover.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, element, walk, settle } from "./support/mod-stubs.js";
import { stray } from "../lib/archive.js";

const stubs = globalThis.__herdsidianStubs;
let SPACES = [], MACHINES = [], AGENTS = [], TERMINALS = [];
stubs["gpui-kit"].div = () => element("div");
stubs["gpui-kit"].svg = (path) => element("svg", path);
stubs["gpui-base"].h_flex = () => element("div");
stubs["gpui-base"].v_flex = () => element("div");
stubs.herdr.spaces = () => SPACES;
stubs.herdr.panes = () => [];
stubs.herdr.machines = () => MACHINES;
stubs.herdr.terminals = () => TERMINALS;
stubs.herdr.agents = () => AGENTS;
stubs.herdr.focused = () => null;
stubs.herdr.setAgentOrder = () => {};
stubs.herdr.theme = () => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : "#808080") });

const { default: Spaces } = await import("../mods/guide-spaces/main.js");
const { default: Agents } = await import("../mods/guide-agents/main.js");

const KEY = "herdsidian.archived";
const call = (node, name) => node.calls.find(([n]) => n === name)?.[1];
const byId = (tree, id) => walk(tree).find((n) => call(n, "id")?.[0] === id) ?? null;
const texts = (node) => walk(node).flatMap((n) => n.kids.filter((c) => typeof c === "string"));
const space = (id, over = {}) => ({ id, name: id, folder: `/r/${id}`, tabs: [], status: "idle", ...over });
const agent = (address, seq, over = {}) => ({ address, pane: `p-${address}`, status: "idle", seq, space: "a", space_name: "alpha", tab: "x", program: { key: "claude", name: "claude" }, focused: false, ...over });
const store = (spaces, agents = []) => { state.shared[KEY] = { spaces, agents }; };

beforeEach(() => {
  state.shared = { "herdsidian.settings": { contextInSidebar: false } };
  state.runs = []; state.commands = []; state.layout = { id: "root", children: [] };
  localStorage.removeItem("pins"); localStorage.removeItem("changed");
  SPACES = []; MACHINES = [{ name: null, layout: "ready" }];
  AGENTS = [agent("t1", 2)]; TERMINALS = [];
});

function mount() {
  const view = new Spaces(), cx = fakeCx(), timers = [];
  cx.timer = { every: (_ms, fn) => { timers.push(fn); } };
  cx.stop_propagation = () => {};
  view.init({}, cx);
  const tick = async () => { for (const fn of timers) fn(cx); await settle(); };
  return { view, tick };
}

test("stray: ids in the skip set are passed over, the next stray is returned with its index", () => {
  const list = [space("p"), space("x"), space("y"), space("z")];
  assert.deepEqual(stray(list, ["x"], new Set(["y"])), { id: "z", index: 2 });
  assert.deepEqual(stray(list, ["x"], ["y"]), { id: "z", index: 2 });
  assert.equal(stray(list, ["x"], new Set(["y", "z"])), null);
  assert.equal(stray(list, ["x"])?.id, "y");
});

test("tidy: y already put back and stuck after x does not hide a new z behind it", async () => {
  SPACES = [space("p"), space("x"), space("y")];
  store(["x"]);
  const m = mount();
  await m.tick();
  assert.deepEqual(state.runs, [["space.move", { id: "y", index: 2 }]]);
  SPACES = [space("p"), space("x"), space("y"), space("z")];
  await m.tick();
  await m.tick();
  assert.deepEqual(state.runs, [["space.move", { id: "y", index: 2 }], ["space.move", { id: "z", index: 2 }]]);
});

test("tidy: a put-back space that is gone is forgotten", async () => {
  SPACES = [space("p"), space("x"), space("y")];
  store(["x"]);
  const m = mount();
  await m.tick();
  assert.ok(m.view.putBack.has("y"));
  SPACES = [space("p"), space("x")];
  await m.tick();
  assert.ok(!m.view.putBack.has("y"));
});

test("hover: an agent archived only through its space keeps showing its duration", () => {
  store(["a"]);
  const view = new Agents(), cx = fakeCx();
  view.init({}, cx);
  byId(view.render(cx), "ag-archived").onClick({}, cx);
  assert.ok(texts(byId(view.render(cx), "ag-t1")).includes("<1m"), "duration before hover");
  call(byId(view.render(cx), "ag-t1"), "on_hover")[0](true, cx);
  const row = byId(view.render(cx), "ag-t1");
  assert.ok(texts(row).includes("<1m"), "duration while hovered");
  assert.equal(byId(view.render(cx), "restore-t1"), null);
});
