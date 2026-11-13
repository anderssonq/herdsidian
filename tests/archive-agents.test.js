// Archived agents (AC-24 to AC-38): guide-agents (and guide-spaces for AC-38) render black-box against the stubs.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, element, walk, settle } from "./support/mod-stubs.js";

const stubs = globalThis.__herdsidianStubs;
let AGENTS = [], TERMINALS = [], SPACES = [];
const ORDERS = [];
stubs["gpui-kit"].div = () => element("div");
stubs["gpui-kit"].svg = (path) => element("svg", path);
stubs["gpui-base"].h_flex = () => element("div");
stubs["gpui-base"].v_flex = () => element("div");
stubs.herdr.spaces = () => SPACES;
stubs.herdr.panes = () => [];
stubs.herdr.machines = () => [{ name: null, layout: "ready" }];
stubs.herdr.terminals = () => TERMINALS;
stubs.herdr.agents = () => AGENTS;
stubs.herdr.focused = () => FOCUSED;
stubs.herdr.setAgentOrder = (list) => { ORDERS.push(list); };
stubs.herdr.theme = () => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : "#808080") });
let FOCUSED = null;

const { default: Agents } = await import("../mods/guide-agents/main.js");
const { default: Spaces } = await import("../mods/guide-spaces/main.js");

const KEY = "herdsidian.archived";
const RAIL = { id: "root", children: [{ id: "sidebar", size: { px: 44 } }] };
const call = (node, name) => node.calls.find(([n]) => n === name)?.[1];
const calls = (node, name) => node.calls.filter(([n]) => n === name).map(([, a]) => a);
const byId = (tree, id) => walk(tree).find((n) => call(n, "id")?.[0] === id) ?? null;
const ids = (tree) => walk(tree).map((n) => call(n, "id")?.[0]).filter(Boolean);
const texts = (node) => walk(node).flatMap((n) => n.kids.filter((c) => typeof c === "string"));
const agent = (address, seq, over = {}) => ({ address, pane: `p-${address}`, status: "idle", seq, space: "a", space_name: "alpha", tab: "x", program: { key: "claude", name: "claude" }, focused: false, ...over });
const store = (spaces, agents) => { state.shared[KEY] = { spaces, agents }; };
const FORBIDDEN = ["space.close", "tab.close", "pane.close", "terminal.kill", "terminal.park"];

beforeEach(() => {
  state.shared = { "herdsidian.settings": { contextInSidebar: false } };
  state.runs = []; state.commands = []; state.layout = { id: "root", children: [] };
  localStorage.removeItem("pins"); localStorage.removeItem("changed");
  ORDERS.length = 0; FOCUSED = null;
  SPACES = [{ id: "a", name: "alpha", folder: "/r/a", tabs: [], status: "idle" }];
  AGENTS = [agent("t1", 3), agent("t2", 2), agent("t3", 1)];
  TERMINALS = [];
});

function mount() {
  const view = new Agents(), cx = fakeCx();
  let stops = 0;
  cx.stop_propagation = () => { stops++; };
  view.init({}, cx);
  const tree = () => view.render(cx);
  const row = (addr) => byId(tree(), `ag-${addr}`);
  const hover = (addr, on = true) => call(row(addr), "on_hover")[0](on, cx);
  const open = () => byId(tree(), "ag-archived").onClick({}, cx);
  return { view, cx, tree, row, hover, open, stops: () => stops };
}
const hoverStyle = (node) => { const el = element("div"); call(node, "hover")[0](el); return el; };
const iconOf = (node) => walk(node).find((n) => n.kind === "svg")?.arg;

test("AC-24: hover shows archive next to pin on a main row; sub-agent and rail rows have none", () => {
  AGENTS = [agent("t1", 1)];
  TERMINALS = [{ address: "t1" }, { address: "t1.1", parent: "t1", state: "live", name: "helper", program: { key: "claude", name: "claude" } }];
  const m = mount();
  assert.ok(!ids(m.tree()).some((id) => id.startsWith("archive-")));
  m.hover("t1");
  const tree = m.tree();
  const button = byId(tree, "archive-t1");
  assert.ok(button);
  assert.equal(iconOf(button), "mods/workspace-chrome/archive.svg");
  assert.equal(call(button, "tooltip")[0], "Archive");
  const pin = byId(tree, "pin-t1");
  assert.ok(pin);
  assert.ok(walk(tree).some((n) => n.kids.includes(button) && n.kids.includes(pin)), "archive and pin share one container");
  assert.ok(!ids(byId(tree, "sub-t1.1")).some((id) => id.startsWith("archive-")));
  state.layout = RAIL;
  assert.ok(!ids(mount().tree()).some((id) => id.startsWith("archive-")));
});

test("AC-25: archive stores the address, stops the click, focuses nothing and unpins", () => {
  localStorage.setItem("pins", JSON.stringify(["t1"]));
  const m = mount();
  m.hover("t1");
  byId(m.tree(), "archive-t1").onClick({}, m.cx);
  assert.deepEqual(state.shared[KEY].agents, ["t1"]);
  assert.ok(m.stops() > 0);
  assert.deepEqual(state.runs.filter(([name]) => name === "pane.focus"), []);
  assert.deepEqual(JSON.parse(localStorage.getItem("pins")), []);
});

test("AC-26: an archived agent is in no group and no count; the folded header follows the last group and toggles", () => {
  store([], ["t1"]);
  localStorage.setItem("pins", JSON.stringify(["t1"]));
  const m = mount();
  const folded = m.tree();
  const order = ids(folded);
  assert.equal(byId(folded, "pinned"), null);
  assert.ok(!order.includes("ag-t1"));
  assert.deepEqual(texts(byId(folded, "sec-1")).filter((s) => /^\d+$/.test(s)), ["2"]);
  assert.ok(order.indexOf("ag-archived") > order.indexOf("ag-t3"));
  assert.deepEqual(texts(byId(folded, "ag-archived")).filter((s) => s === "Archived" || /^\d+$/.test(s)), ["Archived", "1"]);
  m.open();
  const open = ids(m.tree());
  assert.ok(open.indexOf("ag-t1") > open.indexOf("ag-archived"));
  m.open();
  assert.ok(!ids(m.tree()).includes("ag-t1"));
});

test("AC-26: grouped by space, an archived agent is in no space group", () => {
  state.shared["agents.sort"] = "grouped";
  AGENTS = [agent("t1", 3), agent("t2", 2, { space: "b", space_name: "beta" })];
  store([], ["t1"]);
  const order = ids(mount().tree());
  assert.ok(!order.includes("sp-a"));
  assert.ok(order.includes("sp-b"));
});

test("AC-27: with no archived agent there is no Archived header", () => {
  assert.equal(byId(mount().tree(), "ag-archived"), null);
  store([], ["gone"]);
  assert.equal(byId(mount().tree(), "ag-archived"), null);
});

test("AC-28: an archived space lists its agents under Archived with no restore and no pin; restoring it brings them back", () => {
  AGENTS = [agent("t1", 3), agent("t2", 2), agent("t3", 1, { space: "b", space_name: "beta" })];
  store(["a"], []);
  const m = mount();
  m.open();
  assert.ok(ids(m.tree()).includes("ag-t1") && ids(m.tree()).includes("ag-t2"));
  m.hover("t1");
  const tree = m.tree();
  for (const id of ["restore-t1", "pin-t1", "archive-t1"]) assert.equal(byId(tree, id), null, id);
  assert.deepEqual(texts(byId(tree, "ag-archived")).filter((s) => /^\d+$/.test(s)), ["2"]);

  store([], ["t2"]);
  const back = ids(m.tree());
  const header = back.indexOf("ag-archived");
  assert.ok(header >= 0, "Archived header still shown for t2");
  assert.ok(back.indexOf("ag-t1") >= 0 && back.indexOf("ag-t1") < header, "t1 back in the main list");
  assert.ok(back.indexOf("ag-t2") > header, "t2 listed under Archived");
});

test("AC-29: an agent archived on its own shows restore (no pin); restoring puts it back unpinned", () => {
  store([], ["t1"]);
  const m = mount();
  m.open();
  m.hover("t1");
  const tree = m.tree();
  const button = byId(tree, "restore-t1");
  assert.ok(button);
  assert.equal(iconOf(button), "mods/guide-agents/archive-restore.svg");
  assert.equal(call(button, "tooltip")[0], "Restore");
  assert.equal(byId(tree, "pin-t1"), null);
  button.onClick({}, m.cx);
  assert.deepEqual(state.shared[KEY].agents, []);
  const back = m.tree();
  assert.equal(byId(back, "ag-archived"), null);
  assert.deepEqual(ids(back).filter((id) => /^ag-t\d$/.test(id)), ["ag-t1", "ag-t2", "ag-t3"]);
  assert.equal(byId(back, "pinned"), null);
});

test("AC-30: clicking an archived row focuses its pane and keeps it archived", () => {
  store([], ["t1"]);
  const m = mount();
  m.open();
  m.row("t1").onClick({}, m.cx);
  assert.deepEqual(state.runs, [["pane.focus", { pane: "p-t1" }]]);
  assert.deepEqual(state.shared[KEY].agents, ["t1"]);
});

test("AC-31: an archived unfocused row is dimmed and full on hover; a focused one is not dimmed", () => {
  AGENTS = [agent("t1", 3), agent("t2", 2, { focused: true })];
  store([], ["t1", "t2"]);
  const m = mount();
  m.open();
  const dim = calls(m.row("t1"), "opacity").map(([v]) => v);
  assert.ok(dim.length > 0 && dim.every((v) => v < 1));
  assert.ok(calls(hoverStyle(m.row("t1")), "opacity").some(([v]) => v === 1));
  assert.ok(calls(m.row("t2"), "opacity").every(([v]) => v >= 1));
});

test("AC-32: the order has visible agents then archived; only visible ones get keys and ⌘⌥N", async () => {
  state.shared["herdsidian.settings"] = { contextInSidebar: false, keyHints: "always" };
  store([], ["t1"]);
  state.commands = ["focus-1", "focus-3"];
  const m = mount();
  m.open();
  await settle();
  assert.deepEqual(ORDERS.at(-1), ["t2", "t3", "t1"]);
  assert.deepEqual(state.shared["guide-agents.order"], ["t2", "t3"]);
  assert.deepEqual(state.runs.filter(([name]) => name === "pane.focus"), [["pane.focus", { pane: "p-t2" }]]);
  assert.ok(texts(m.row("t2")).includes("⌘⌥1"));
  assert.ok(texts(m.row("t3")).includes("⌘⌥2"));
  assert.ok(!texts(m.row("t1")).some((s) => s.startsWith("⌘⌥")));
});

test("AC-33: next-blocked still reaches an archived blocked agent and does not restore it", async () => {
  AGENTS = [agent("t1", 3, { status: "blocked" }), agent("t2", 2, { focused: true }), agent("t3", 1)];
  FOCUSED = { pane: "p-t2" };
  store([], ["t1"]);
  state.commands = ["next-blocked"];
  const m = mount();
  m.tree();
  await settle();
  assert.deepEqual(state.runs.filter(([name]) => name === "pane.focus"), [["pane.focus", { pane: "p-t1" }]]);
  assert.deepEqual(state.shared[KEY].agents, ["t1"]);
});

test("AC-34: the Archived header shows a blocked dot only when an archived agent is blocked", () => {
  const dot = (header) => walk(header).some((n) => call(n, "size")?.[0] === 6 && call(n, "bg"));
  AGENTS = [agent("t1", 3, { status: "blocked" }), agent("t2", 2)];
  store([], ["t1"]);
  assert.equal(dot(byId(mount().tree(), "ag-archived")), true);
  store([], ["t2"]);
  assert.equal(dot(byId(mount().tree(), "ag-archived")), false);
});

test("AC-35: the rail draws no archived agent and numbers the visible ones 1..N", () => {
  store([], ["t1"]);
  state.layout = RAIL;
  const tree = mount().tree();
  assert.equal(byId(tree, "ag-t1"), null);
  assert.equal(byId(tree, "ag-archived"), null);
  assert.ok(texts(byId(tree, "ag-t2")).includes("1"));
  assert.ok(texts(byId(tree, "ag-t3")).includes("2"));
});

test("AC-36: folding the Agents section also hides the Archived section", () => {
  store([], ["t1"]);
  const m = mount();
  m.open();
  assert.ok(ids(m.tree()).includes("ag-t1"));
  byId(m.tree(), "ag-section").onClick({}, m.cx);
  const tree = m.tree();
  assert.equal(byId(tree, "ag-archived"), null);
  assert.equal(byId(tree, "ag-t1"), null);
});

test("AC-37: archive, restore and a click on an archived row never close, kill or park anything", () => {
  const m = mount();
  m.hover("t1");
  byId(m.tree(), "archive-t1").onClick({}, m.cx);
  m.open();
  m.hover("t1");
  byId(m.tree(), "restore-t1").onClick({}, m.cx);
  store([], ["t2"]);
  if (!byId(m.tree(), "ag-t2")) m.open();
  m.row("t2").onClick({}, m.cx);
  assert.ok(state.runs.length > 0);
  assert.deepEqual(state.runs.filter(([name]) => FORBIDDEN.includes(name)), []);
});

test("AC-38: archiving a space in Spaces makes its agents archived in Agents with no other step", () => {
  const spaces = new Spaces(), scx = fakeCx();
  scx.timer = { every() {} };
  spaces.init({}, scx);
  const agents = mount();
  assert.ok(ids(agents.tree()).includes("ag-t1"));
  assert.equal(byId(agents.tree(), "ag-archived"), null);
  call(byId(spaces.render(scx), "space-a"), "on_hover")[0](true, scx);
  byId(spaces.render(scx), "space-archive-a").onClick({}, scx);
  const tree = agents.tree();
  assert.ok(!ids(tree).includes("ag-t1"));
  assert.deepEqual(texts(byId(tree, "ag-archived")).filter((s) => /^\d+$/.test(s)), ["3"]);
});
