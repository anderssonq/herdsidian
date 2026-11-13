// Archived spaces (AC-8 to AC-23, AC-37): guide-spaces renders black-box against the stubs.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, element, walk, settle } from "./support/mod-stubs.js";

const stubs = globalThis.__herdsidianStubs;
let SPACES = [], MACHINES = [];
stubs["gpui-kit"].div = () => element("div");
stubs["gpui-kit"].svg = (path) => element("svg", path);
stubs["gpui-base"].h_flex = () => element("div");
stubs["gpui-base"].v_flex = () => element("div");
stubs.herdr.spaces = () => SPACES;
stubs.herdr.panes = () => [];
stubs.herdr.machines = () => MACHINES;
stubs.herdr.theme = () => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : "#808080") });

const { default: Spaces } = await import("../mods/guide-spaces/main.js");

const KEY = "herdsidian.archived";
const RAIL = { id: "root", children: [{ id: "sidebar", size: { px: 44 } }] };
const call = (node, name) => node.calls.find(([n]) => n === name)?.[1];
const calls = (node, name) => node.calls.filter(([n]) => n === name).map(([, a]) => a);
const byId = (tree, id) => walk(tree).find((n) => call(n, "id")?.[0] === id) ?? null;
const ids = (tree) => walk(tree).map((n) => call(n, "id")?.[0]).filter(Boolean);
const texts = (node) => walk(node).flatMap((n) => n.kids.filter((c) => typeof c === "string"));
const git = (over = {}) => ({ name: "herdr", branch: "spike", ahead: 0, behind: 0, repo: "[null,\"/r/.git\"]", linked: false, ...over });
const space = (id, over = {}) => ({ id, name: id.replace(/^.*\//, ""), folder: `/r/${id}`, tabs: [], status: "idle", ...over });
const store = (spaces) => { state.shared[KEY] = { spaces, agents: [] }; };
const stored = () => state.shared[KEY];
const FORBIDDEN = ["space.close", "tab.close", "pane.close", "terminal.kill", "terminal.park"];

beforeEach(() => {
  state.shared = {}; state.runs = []; state.layout = { id: "root", children: [] };
  SPACES = []; MACHINES = [{ name: null, layout: "ready" }];
});

// The view after init. `timers` holds what the mod asked cx.timer.every to run.
function mount(gits = {}) {
  const view = new Spaces(), cx = fakeCx(), timers = [];
  cx.timer = { every: (_ms, fn) => { timers.push(fn); } };
  let stops = 0;
  cx.stop_propagation = () => { stops++; };
  view.init({}, cx);
  for (const [folder, info] of Object.entries(gits)) view.git[JSON.stringify([null, folder])] = info;
  const tree = () => view.render(cx);
  const row = (id) => byId(tree(), `space-${id}`);
  const hover = (id, on = true) => call(row(id), "on_hover")[0](on, cx);
  return { view, cx, timers, tree, row, hover, stops: () => stops };
}
const handler = (node, name, button) => node.calls.find(([n, a]) => n === name && (button === undefined || a[0] === button))[1].at(-1);
const press = (node, cx) => { handler(node, "on_mouse_down", "left")({}, cx); };
const release = (node, cx) => { handler(node, "on_mouse_up", "left")({}, cx); };
const hoverStyle = (node) => { const el = element("div"); call(node, "hover")[0](el); return el; };

test("AC-8: with no hover no row has an archive button; hover shows it, drops the pills and keeps the key cap", () => {
  SPACES = [space("a"), space("b")];
  const m = mount({ "/r/a": git({ ahead: 2, behind: 1 }) });
  assert.ok(!ids(m.tree()).some((id) => id.startsWith("space-archive-")));
  assert.ok(texts(m.row("a")).includes("↑2"));
  m.hover("a");
  const tree = m.tree();
  const button = byId(tree, "space-archive-a");
  assert.ok(button);
  assert.equal(walk(button).find((n) => n.kind === "svg").arg, "mods/workspace-chrome/archive.svg");
  assert.equal(call(button, "tooltip")[0], "Archive");
  assert.ok(!texts(byId(tree, "space-a")).some((s) => /[↑↓]/.test(s)));
  assert.ok(texts(byId(tree, "space-a")).includes("⌃1"));
  assert.equal(byId(tree, "space-archive-b"), null);
});

test("AC-9: archive stores the id, moves the space to the end, selects nothing and stops the click", () => {
  SPACES = [space("a"), space("b"), space("c")];
  const m = mount();
  m.hover("a");
  const button = byId(m.tree(), "space-archive-a");
  button.onClick({}, m.cx);
  assert.deepEqual(stored().spaces, ["a"]);
  assert.deepEqual(state.runs, [["space.move", { id: "a", index: 3 }]]);
  assert.ok(m.stops() > 0);
  const stopped = [];
  m.cx.stop_propagation = () => { stopped.push(1); };
  handler(button, "on_mouse_down", "left")({}, m.cx);
  handler(button, "on_mouse_up", "left")({}, m.cx);
  assert.equal(stopped.length, 2, "mouse down and mouse up must not reach the row (select, drag)");
});

test("AC-10: archive moves a space to the end of its own machine's block", () => {
  SPACES = [space("a"), space("b"), space("vps/c", { machine: "vps" }), space("vps/d", { machine: "vps" })];
  MACHINES.push({ name: "vps", layout: "ready" });
  const m = mount();
  m.hover("vps/c");
  byId(m.tree(), "space-archive-vps/c").onClick({}, m.cx);
  assert.deepEqual(state.runs, [["space.move", { id: "vps/c", index: 4 }]]);
  state.runs = []; state.shared = {};
  m.hover("a");
  byId(m.tree(), "space-archive-a").onClick({}, m.cx);
  assert.deepEqual(state.runs, [["space.move", { id: "a", index: 2 }]]);
});

test("AC-11: restore removes the id and moves the space just after the last visible one of its machine", () => {
  SPACES = [space("b"), space("c"), space("a"), space("d")];
  store(["a", "d"]);
  const m = mount();
  byId(m.tree(), "spaces-archived").onClick({}, m.cx);
  m.hover("d");
  byId(m.tree(), "space-restore-d").onClick({}, m.cx);
  assert.deepEqual(stored().spaces, ["a"]);
  assert.deepEqual(state.runs, [["space.move", { id: "d", index: 3 }]]);

  SPACES = [space("a"), space("b")];
  store(["a", "b"]);
  state.runs = [];
  const all = mount();
  byId(all.tree(), "spaces-archived").onClick({}, all.cx);
  all.hover("b");
  byId(all.tree(), "space-restore-b").onClick({}, all.cx);
  assert.deepEqual(state.runs, [["space.move", { id: "b", index: 1 }]]);
});

test("AC-12: an archived space leaves the main list; the folded Archived header follows the last machine group and toggles", () => {
  SPACES = [space("a"), space("vps/b", { machine: "vps" }), space("c")];
  MACHINES.push({ name: "vps", layout: "ready" });
  store(["c"]);
  const m = mount();
  const folded = m.tree();
  const order = ids(folded);
  assert.ok(!order.includes("space-c"));
  assert.ok(order.indexOf("spaces-archived") > order.indexOf("space-vps/b"));
  assert.ok(order.indexOf("spaces-archived") > order.indexOf("machine-vps"));
  assert.deepEqual(texts(byId(folded, "spaces-archived")).filter((s) => s === "Archived" || /^\d+$/.test(s)), ["Archived", "1"]);
  byId(folded, "spaces-archived").onClick({}, m.cx);
  const open = ids(m.tree());
  assert.ok(open.indexOf("space-c") > open.indexOf("spaces-archived"));
  byId(m.tree(), "spaces-archived").onClick({}, m.cx);
  assert.ok(!ids(m.tree()).includes("space-c"));
});

test("AC-13: with no archived space there is no Archived header", () => {
  SPACES = [space("a"), space("b")];
  assert.equal(byId(mount().tree(), "spaces-archived"), null);
  store(["gone"]);
  assert.equal(byId(mount().tree(), "spaces-archived"), null);
});

test("AC-14: an archived row shows no key and no key in its tooltip, even with hints always", () => {
  SPACES = [space("a"), space("b"), space("c")];
  store(["c"]);
  state.shared["herdsidian.settings"] = { keyHints: "always" };
  const m = mount();
  byId(m.tree(), "spaces-archived").onClick({}, m.cx);
  assert.ok(!texts(m.row("c")).some((s) => s.startsWith("⌃")));
  assert.ok(!(call(m.row("c"), "tooltip")?.[0] ?? "").includes("⌃"));
  assert.ok(texts(m.row("a")).includes("⌃1"));
  assert.ok(texts(m.row("b")).includes("⌃2"));
});

test("AC-15: an archived inactive row is dimmed and full on hover; an archived active row is not dimmed", () => {
  SPACES = [space("a"), space("b"), space("c")];
  store(["c"]);
  const m = mount();
  byId(m.tree(), "spaces-archived").onClick({}, m.cx);
  const dim = calls(m.row("c"), "opacity").map(([v]) => v);
  assert.ok(dim.length > 0 && dim.every((v) => v < 1));
  assert.ok(calls(hoverStyle(m.row("c")), "opacity").some(([v]) => v === 1));
  assert.equal(calls(m.row("a"), "opacity").length, 0);
  SPACES = [space("a"), space("b"), space("c", { active: true })];
  const active = mount();
  byId(active.tree(), "spaces-archived").onClick({}, active.cx);
  assert.ok(calls(active.row("c"), "opacity").every(([v]) => v >= 1));
});

test("AC-16: hovering an archived row shows the restore button, not the archive button", () => {
  SPACES = [space("a"), space("c")];
  store(["c"]);
  const m = mount();
  byId(m.tree(), "spaces-archived").onClick({}, m.cx);
  assert.equal(byId(m.tree(), "space-restore-c"), null);
  m.hover("c");
  const tree = m.tree();
  const button = byId(tree, "space-restore-c");
  assert.ok(button);
  assert.equal(walk(button).find((n) => n.kind === "svg").arg, "mods/guide-spaces/archive-restore.svg");
  assert.equal(call(button, "tooltip")[0], "Restore");
  assert.equal(byId(tree, "space-archive-c"), null);
});

test("AC-17: clicking an archived row selects it and keeps it archived; mixed drags move nothing", () => {
  SPACES = [space("a"), space("b"), space("c")];
  store(["c"]);
  const m = mount();
  byId(m.tree(), "spaces-archived").onClick({}, m.cx);
  const c = m.row("c");
  press(c, m.cx);
  release(c, m.cx);
  assert.deepEqual(state.runs, [["space.select", { id: "c" }]]);
  assert.deepEqual(stored().spaces, ["c"]);

  state.runs = [];
  press(m.row("c"), m.cx);
  call(m.row("a"), "on_mouse_move")[0]({}, m.cx);
  release(m.row("a"), m.cx);
  press(m.row("a"), m.cx);
  call(m.row("c"), "on_mouse_move")[0]({}, m.cx);
  release(m.row("c"), m.cx);
  assert.deepEqual(state.runs.filter(([name]) => name === "space.move"), []);
});

test("AC-18: the count in the header is the number of visible spaces", () => {
  SPACES = [space("a"), space("b"), space("c")];
  store(["c"]);
  assert.deepEqual(texts(byId(mount().tree(), "spaces-count")), ["2"]);
});

test("AC-19: the rail draws no archived row and no Archived header; visible rows keep their numbers", () => {
  SPACES = [space("a"), space("b"), space("c")];
  store(["c"]);
  state.layout = RAIL;
  const tree = mount().tree();
  assert.equal(byId(tree, "space-c"), null);
  assert.equal(byId(tree, "spaces-archived"), null);
  assert.ok(texts(byId(tree, "space-a")).includes("1"));
  assert.ok(texts(byId(tree, "space-b")).includes("2"));
});

test("AC-20: archiving a main checkout leaves its worktree a top-level row; archiving the worktree hides only it", () => {
  SPACES = [space("m"), space("w")];
  const gits = { "/r/m": git(), "/r/w": git({ linked: true }) };
  const branch = (row) => walk(row).some((n) => n.kind === "svg" && n.arg === "mods/workspace-chrome/branch.svg");
  const avatar = (row) => walk(row).some((n) => call(n, "font_bold"));
  const plain = mount(gits);
  assert.equal(branch(plain.row("w")), true);

  store(["m"]);
  const main = mount(gits);
  assert.equal(branch(main.row("w")), false);
  assert.equal(avatar(main.row("w")), true);

  store(["w"]);
  const kid = mount(gits);
  const tree = kid.tree();
  assert.ok(byId(tree, "space-m"));
  assert.equal(byId(tree, "space-w"), null);
  assert.deepEqual(texts(byId(tree, "spaces-archived")).filter((s) => /^\d+$/.test(s)), ["1"]);
});

test("AC-21: the Archived header shows a blocked dot only when an archived space is blocked", () => {
  const dot = (header) => walk(header).some((n) => call(n, "size")?.[0] === 6 && call(n, "bg"));
  SPACES = [space("a"), space("b", { status: "blocked" })];
  store(["b"]);
  assert.equal(dot(byId(mount().tree(), "spaces-archived")), true);
  SPACES = [space("a", { status: "blocked" }), space("b")];
  assert.equal(dot(byId(mount().tree(), "spaces-archived")), false);
});

test("AC-22: folding the Spaces section also hides the Archived section", () => {
  SPACES = [space("a"), space("c")];
  store(["c"]);
  const m = mount();
  byId(m.tree(), "spaces-archived").onClick({}, m.cx);
  assert.ok(ids(m.tree()).includes("space-c"));
  byId(m.tree(), "spaces-fold").onClick({}, m.cx);
  const tree = m.tree();
  assert.equal(byId(tree, "spaces-archived"), null);
  assert.equal(byId(tree, "space-c"), null);
});

test("AC-23: a visible space after an archived one is moved back from a task, never from render", async () => {
  SPACES = [space("a"), space("b"), space("c")];
  store(["b"]);
  const m = mount();
  m.tree();
  assert.deepEqual(state.runs, []);
  for (const tick of m.timers) tick(m.cx);
  await settle();
  assert.deepEqual(state.runs, [["space.move", { id: "c", index: 2 }]]);
  for (const tick of m.timers) tick(m.cx);
  await settle();
  assert.equal(state.runs.length, 1, "the same move is not asked twice");

  SPACES = [space("a"), space("c"), space("b")];
  state.runs = [];
  const tidy = mount();
  tidy.tree();
  for (const tick of tidy.timers) tick(tidy.cx);
  await settle();
  assert.deepEqual(state.runs, []);
});

test("AC-37: archive, restore and a click on an archived row never close or kill anything", () => {
  SPACES = [space("a"), space("b"), space("c")];
  store(["c"]);
  const m = mount();
  m.hover("a");
  byId(m.tree(), "space-archive-a").onClick({}, m.cx);
  byId(m.tree(), "spaces-archived").onClick({}, m.cx);
  m.hover("c");
  byId(m.tree(), "space-restore-c").onClick({}, m.cx);
  press(m.row("a"), m.cx);
  release(m.row("a"), m.cx);
  assert.ok(state.runs.length > 0);
  assert.deepEqual(state.runs.filter(([name]) => FORBIDDEN.includes(name)), []);
});
