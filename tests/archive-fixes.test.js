// Review fixes of the Archived feature: stray moves once per id, drag release on the row button,
// rail numbers, pruning, restore button of an agent whose space is archived, no dimming of archived rows.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, element, walk, settle } from "./support/mod-stubs.js";

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
const RAIL = { id: "root", children: [{ id: "sidebar", size: { px: 44 } }] };
const call = (node, name) => node.calls.find(([n]) => n === name)?.[1];
const calls = (node, name) => node.calls.filter(([n]) => n === name).map(([, a]) => a);
const byId = (tree, id) => walk(tree).find((n) => call(n, "id")?.[0] === id) ?? null;
const texts = (node) => walk(node).flatMap((n) => n.kids.filter((c) => typeof c === "string"));
const space = (id, over = {}) => ({ id, name: id.replace(/^.*\//, ""), folder: `/r/${id}`, tabs: [], status: "idle", ...over });
const agent = (address, seq, over = {}) => ({ address, pane: `p-${address}`, status: "idle", seq, space: "a", space_name: "alpha", tab: "x", program: { key: "claude", name: "claude" }, focused: false, ...over });
const store = (spaces, agents = []) => { state.shared[KEY] = { spaces, agents }; };
const stored = () => state.shared[KEY];
const handler = (node, name, button) => node.calls.find(([n, a]) => n === name && (button === undefined || a[0] === button))[1].at(-1);

beforeEach(() => {
  state.shared = { "herdsidian.settings": { contextInSidebar: false } };
  state.runs = []; state.commands = []; state.layout = { id: "root", children: [] };
  localStorage.removeItem("pins"); localStorage.removeItem("changed");
  SPACES = []; MACHINES = [{ name: null, layout: "ready" }];
  AGENTS = [agent("t1", 2), agent("t2", 1)]; TERMINALS = [];
});

function mount() {
  const view = new Spaces(), cx = fakeCx(), timers = [];
  cx.timer = { every: (_ms, fn) => { timers.push(fn); } };
  cx.stop_propagation = () => {};
  view.init({}, cx);
  const tree = () => view.render(cx);
  const row = (id) => byId(tree(), `space-${id}`);
  const hover = (id, on = true) => call(row(id), "on_hover")[0](on, cx);
  const tick = async () => { for (const fn of timers) fn(cx); await settle(); };
  return { view, cx, tree, row, hover, tick };
}

test("M1: a space is moved back once; another screen's moves never make it ping-pong", async () => {
  SPACES = [space("p"), space("x"), space("y")];
  store(["x"]);
  const m = mount();
  await m.tick();
  assert.deepEqual(state.runs, [["space.move", { id: "y", index: 2 }]]);
  SPACES = [space("p"), space("y"), space("x")];
  await m.tick();
  SPACES = [space("p"), space("x"), space("y")];
  await m.tick();
  await m.tick();
  assert.equal(state.runs.length, 1, "y is not asked to move a second time");
});

test("m1: releasing a drag on the hover archive button clears the drag state", () => {
  SPACES = [space("a"), space("b")];
  const m = mount();
  handler(m.row("b"), "on_mouse_down", "left")({}, m.cx);
  call(m.row("a"), "on_mouse_move")[0]({}, m.cx);
  m.hover("a");
  handler(byId(m.tree(), "space-archive-a"), "on_mouse_up", "left")({}, m.cx);
  const tree = m.tree();
  for (const id of ["a", "b"]) {
    const row = byId(tree, `space-${id}`);
    assert.deepEqual(calls(row, "opacity"), [], `row ${id} is not dimmed`);
    assert.ok(!walk(row).some((n) => call(n, "absolute")), `row ${id} has no drop line`);
  }
});

test("m2: the rail number of a row is its ⌃N key, counting archived rows before it", () => {
  SPACES = [space("a"), space("b"), space("vps/c", { machine: "vps" })];
  MACHINES.push({ name: "vps", layout: "ready" });
  store(["b"]);
  state.layout = RAIL;
  const tree = mount().tree();
  assert.ok(texts(byId(tree, "space-vps/c")).includes("3"));
  assert.ok(texts(byId(tree, "space-a")).includes("1"));
});

test("m4: guide-spaces' task drops a gone local id and keeps one of a machine still loading", async () => {
  SPACES = [space("a")];
  MACHINES.push({ name: "vps", layout: "loading" });
  store(["gone", "vps/c"]);
  const m = mount();
  await m.tick();
  assert.deepEqual(stored().spaces, ["vps/c"]);
});

test("m4: guide-agents drops a gone address of a heard machine and keeps one of an unheard machine", () => {
  TERMINALS = [{ address: "vps/t1", state: "live" }];
  store([], ["vps/gone", "far/x"]);
  const view = new Agents(), cx = fakeCx();
  view.init({}, cx);
  view.render(cx);
  assert.deepEqual(stored().agents, ["far/x"]);
});

test("nit: an agent archived on its own and through its space has no restore button", () => {
  store(["a"], ["t1"]);
  const view = new Agents(), cx = fakeCx();
  view.init({}, cx);
  byId(view.render(cx), "ag-archived").onClick({}, cx);
  call(byId(view.render(cx), "ag-t1"), "on_hover")[0](true, cx);
  assert.equal(byId(view.render(cx), "restore-t1"), null);
});

test("nit: pressing an archived row and moving inside it does not dim it as dragged", () => {
  SPACES = [space("a"), space("c")];
  store(["c"]);
  const m = mount();
  byId(m.tree(), "spaces-archived").onClick({}, m.cx);
  handler(m.row("c"), "on_mouse_down", "left")({}, m.cx);
  call(m.row("c"), "on_mouse_move")[0]({}, m.cx);
  assert.ok(calls(m.row("c"), "opacity").every(([v]) => v !== 0.5));
});
