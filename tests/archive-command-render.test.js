// Archive and restore from the ⌘K palette (AC-7 to AC-14): the real palette copy, guide-spaces and guide-agents
// render black-box against the stubs and share one `shared` store.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, element, walk, settle } from "./support/mod-stubs.js";

const stubs = globalThis.__herdsidianStubs;
let SPACES = [], AGENTS = [], FOCUSED = null;
stubs["gpui-kit"].div = () => element("div");
stubs["gpui-kit"].svg = (path) => element("svg", path);
stubs["gpui-base"].h_flex = () => element("div");
stubs["gpui-base"].v_flex = () => element("div");
stubs.herdr.spaces = () => SPACES;
stubs.herdr.panes = () => [];
stubs.herdr.machines = () => [{ name: null, layout: "ready" }];
stubs.herdr.terminals = () => [];
stubs.herdr.agents = () => AGENTS;
stubs.herdr.focused = () => FOCUSED;
stubs.herdr.knownAgents = async () => [];
stubs.herdr.themes = () => [];
stubs.herdr.appHome = () => "/herdr-home";
stubs.herdr.setAgentOrder = () => {};
stubs.herdr.theme = () => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : "#808080") });

const { Palette } = await import("../mods/herdsidian/palette-main.js");
const { default: Spaces } = await import("../mods/guide-spaces/main.js");
const { default: Agents } = await import("../mods/guide-agents/main.js");

const KEY = "herdsidian.archived";
const FORBIDDEN = ["space.close", "tab.close", "pane.close", "terminal.kill", "terminal.park"];
const call = (node, name) => node.calls.find(([n]) => n === name)?.[1];
const byId = (tree, id) => walk(tree).find((n) => call(n, "id")?.[0] === id) ?? null;
const ids = (tree) => walk(tree).map((n) => call(n, "id")?.[0]).filter(Boolean);
const texts = (node) => walk(node).flatMap((n) => n.kids.filter((c) => typeof c === "string"));
const space = (id, over = {}) => ({ id, name: id.replace(/^.*\//, ""), folder: `/r/${id}`, tabs: [], status: "idle", ...over });
const remote = (id) => space(id, { machine: "vps" });
const agent = (address, seq, over = {}) => ({ address, pane: `p-${address}`, status: "idle", seq, space: "a", space_name: "a", tab: "x", program: { key: "claude", name: "Claude Code" }, focused: false, ...over });
const store = (spaces, agents) => { state.shared[KEY] = { spaces, agents }; };
const moves = () => state.runs.filter(([name]) => name === "space.move");

beforeEach(() => {
  state.shared = { "herdsidian.settings": { contextInSidebar: false } };
  state.runs = []; state.toasts = []; state.closed = []; state.commands = []; state.files = {};
  state.props = { overlay: "o1" };
  state.layout = { id: "root", children: [{ id: "herdsidian", size: { px: 380 } }] };
  localStorage.removeItem("pins"); localStorage.removeItem("changed");
  SPACES = []; AGENTS = []; FOCUSED = null;
});

// The palette on its Commands tab, rendered once, as a person sees it when pressing ↵.
async function open() {
  const cx = fakeCx();
  const view = new Palette(cx);
  await settle();
  view.on.tab("commands", cx);
  view.render(cx);
  const press = (id) => view.on.choose(`command:${id}`, cx);
  const listed = () => { view.render(cx); return view.list.pickable.map((r) => r.key.replace(/^command:/, "")); };
  return { view, cx, press, listed };
}
const active = (id) => { SPACES = SPACES.map((s) => ({ ...s, active: s.id === id })); };

test("AC-7: archive-space stores the id, keeps the agents list, moves to the end, selects nothing and closes", async () => {
  SPACES = [space("a"), space("b"), space("c")]; active("a");
  store([], ["zz"]);
  const p = await open();
  p.press("archive-space");
  assert.deepEqual(state.shared[KEY], { spaces: ["a"], agents: ["zz"] });
  assert.deepEqual(state.runs, [["space.move", { id: "a", index: 3 }]]);
  assert.deepEqual(state.runs.filter(([name]) => name === "space.select"), []);
  assert.deepEqual(state.closed, ["o1"]);
});

test("AC-7: with no store at all archive-space writes one", async () => {
  SPACES = [space("a"), space("b")]; active("a");
  const p = await open();
  p.press("archive-space");
  assert.deepEqual(state.shared[KEY], { spaces: ["a"], agents: [] });
});

test("AC-8: a remote space moves to the end of its own machine block", async () => {
  SPACES = [space("a"), space("b"), remote("vps/c"), remote("vps/d")]; active("vps/c");
  const p = await open();
  p.press("archive-space");
  assert.deepEqual(state.runs, [["space.move", { id: "vps/c", index: 4 }]]);
});

test("AC-9: restore-space removes the id and moves to just before the first archived space", async () => {
  SPACES = [space("b"), space("c"), space("a"), space("d")]; active("d");
  store(["a", "d"], []);
  const p = await open();
  p.press("restore-space");
  assert.deepEqual(state.shared[KEY].spaces, ["a"]);
  assert.deepEqual(state.runs, [["space.move", { id: "d", index: 3 }]]);
  assert.deepEqual(state.closed, ["o1"]);
});

test("AC-9: the move index is read at ↵, not when the palette opened", async () => {
  SPACES = [space("a"), space("b"), space("c")]; active("a");
  const p = await open();
  SPACES = [...SPACES, space("d")];
  p.press("archive-space");
  assert.deepEqual(moves(), [["space.move", { id: "a", index: 4 }]]);
});

test("AC-10: archive-agent stores the address only; restore-agent removes it; nothing moves or focuses", async () => {
  SPACES = [space("a")]; active("a");
  AGENTS = [agent("t1", 1, { focused: true })];
  store(["zz"], []);
  const p = await open();
  p.press("archive-agent");
  assert.deepEqual(state.shared[KEY], { spaces: ["zz"], agents: ["t1"] });
  assert.deepEqual(state.closed, ["o1"]);
  const quiet = () => state.runs.filter(([name]) => ["space.move", "pane.focus", "agent.focus", "space.select"].includes(name));
  assert.deepEqual(quiet(), []);

  state.closed = [];
  const q = await open();
  assert.ok((await q.listed()).includes("restore-agent"));
  q.press("restore-agent");
  assert.deepEqual(state.shared[KEY], { spaces: ["zz"], agents: [] });
  assert.deepEqual(state.closed, ["o1"]);
  assert.deepEqual(quiet(), []);
});

test("AC-10: the agent commands appear for the agent a Notes pane remembers", async () => {
  SPACES = [space("a")]; active("a");
  AGENTS = [agent("t1", 1)];
  state.shared["herdsidian.memory"] = { a: "t1" };
  FOCUSED = { space: "a", pane: "notes-pane" };
  const p = await open();
  assert.ok((await p.listed()).includes("archive-agent"));
});

test("AC-11: a store that already holds the requested state is not written and nothing moves", async () => {
  SPACES = [space("a"), space("b")]; active("a");
  const p = await open();
  assert.ok(p.listed().includes("archive-space"));
  store(["a"], []);
  const before = state.shared[KEY];
  p.press("archive-space");
  assert.equal(state.shared[KEY], before);
  assert.deepEqual(state.runs, []);
  assert.deepEqual(state.closed, ["o1"]);

  SPACES = [space("b"), space("a")]; active("a");
  store(["a"], []);
  const q = await open();
  assert.ok(q.listed().includes("restore-space"));
  store([], []);
  const empty = state.shared[KEY];
  q.press("restore-space");
  assert.equal(state.shared[KEY], empty);
  assert.deepEqual(state.runs, []);
});

test("AC-11: the same holds for an agent", async () => {
  SPACES = [space("a")]; active("a");
  AGENTS = [agent("t1", 1, { focused: true })];
  const p = await open();
  assert.ok(p.listed().includes("archive-agent"));
  store([], ["t1"]);
  const before = state.shared[KEY];
  p.press("archive-agent");
  assert.equal(state.shared[KEY], before);
  assert.deepEqual(state.closed, ["o1"]);

  const q = await open();
  assert.ok(q.listed().includes("restore-agent"));
  store([], []);
  const empty = state.shared[KEY];
  q.press("restore-agent");
  assert.equal(state.shared[KEY], empty);
  assert.deepEqual(state.runs, []);
});

test("AC-11: a write changes only its own list as the store holds it now", async () => {
  SPACES = [space("a")]; active("a");
  AGENTS = [agent("t1", 1, { focused: true })];
  const p = await open();
  store([], ["other"]);
  p.press("archive-agent");
  assert.deepEqual(state.shared[KEY], { spaces: [], agents: ["other", "t1"] });
});

test("AC-12: no archive or restore command closes, kills or parks anything", async () => {
  SPACES = [space("a"), space("b")]; active("a");
  AGENTS = [agent("t1", 1, { focused: true })];
  for (const [initial, press] of [[[[], []], "archive-space"], [[[], []], "archive-agent"], [[["a"], []], "restore-space"], [[[], ["t1"]], "restore-agent"]]) {
    store(...initial);
    const p = await open();
    p.press(press);
  }
  assert.ok(state.runs.length > 0);
  assert.deepEqual(state.runs.filter(([name]) => FORBIDDEN.includes(name)), []);
});

test("AC-13: after the palette archives a space the sidebars follow with no other step", async () => {
  SPACES = [space("a"), space("b"), space("c")]; active("a");
  AGENTS = [agent("t1", 2), agent("t2", 1, { space: "b", space_name: "b" })];
  state.shared["herdsidian.settings"] = { contextInSidebar: false, keyHints: "always" };
  const scx = fakeCx();
  scx.timer = { every() {} };
  const spaces = new Spaces();
  spaces.init({}, scx);
  const acx = fakeCx();
  const agents = new Agents();
  agents.init({}, acx);

  assert.ok(texts(byId(spaces.render(scx), "space-a")).includes("⌃1"));
  assert.ok(ids(agents.render(acx)).includes("ag-t1"));
  assert.deepEqual(state.shared["guide-agents.order"], ["t1", "t2"]);

  const p = await open();
  p.press("archive-space");

  const sidebar = spaces.render(scx);
  byId(sidebar, "spaces-archived").onClick({}, scx);
  const open_ = spaces.render(scx);
  assert.ok(ids(open_).indexOf("space-a") > ids(open_).indexOf("spaces-archived"));
  assert.ok(!texts(byId(open_, "space-a")).some((s) => s.startsWith("⌃")));

  const list = agents.render(acx);
  byId(list, "ag-archived").onClick({}, acx);
  const unfolded = agents.render(acx);
  assert.ok(ids(unfolded).indexOf("ag-t1") > ids(unfolded).indexOf("ag-archived"));
  assert.deepEqual(state.shared["guide-agents.order"], ["t2"]);
  // A view that starts after the archive reads the same store: focus-1 goes to the first visible agent.
  state.runs = []; state.commands = ["focus-1"];
  const later = new Agents(), lcx = fakeCx();
  later.init({}, lcx);
  later.render(lcx);
  await settle();
  assert.deepEqual(state.runs.filter(([name]) => name === "pane.focus"), [["pane.focus", { pane: "p-t2" }]]);
});

test("AC-14: an agent archived on its own by a store write loses its pin; restoring does not bring it back", () => {
  AGENTS = [agent("t1", 3), agent("t2", 2), agent("t3", 1)];
  localStorage.setItem("pins", JSON.stringify(["t1"]));
  const writes = [];
  const set = localStorage.setItem;
  localStorage.setItem = (key, value) => { if (key === "pins") writes.push(value); set(key, value); };
  try {
    const cx = fakeCx();
    const view = new Agents();
    view.init({}, cx);
    assert.ok(byId(view.render(cx), "pinned"));
    writes.length = 0;

    store([], ["t1"]);
    const tree = view.render(cx);
    assert.equal(byId(tree, "pinned"), null);
    assert.deepEqual(JSON.parse(localStorage.getItem("pins")), []);
    assert.equal(writes.length, 1);
    view.render(cx);
    assert.equal(writes.length, 1, "written only when the pins change");

    store([], []);
    const back = view.render(cx);
    assert.equal(byId(back, "pinned"), null);
    assert.deepEqual(ids(back).filter((id) => /^ag-t\d$/.test(id)), ["ag-t1", "ag-t2", "ag-t3"]);
  } finally {
    localStorage.setItem = set;
  }
});

test("AC-14: an agent archived only through its space keeps its pin", () => {
  AGENTS = [agent("t1", 3), agent("t2", 2)];
  localStorage.setItem("pins", JSON.stringify(["t1"]));
  const cx = fakeCx();
  const view = new Agents();
  view.init({}, cx);
  store(["a"], []);
  view.render(cx);
  assert.deepEqual(JSON.parse(localStorage.getItem("pins")), ["t1"]);
});
