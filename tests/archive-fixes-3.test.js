// Archived feature, remote machines: a space already put back before the archived ones is remembered
// while its machine is offline, so a reconnect does not move it again. It is forgotten only when its
// machine is ready and the space is gone.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, element, settle } from "./support/mod-stubs.js";

const stubs = globalThis.__herdsidianStubs;
let SPACES = [], MACHINES = [];
stubs["gpui-kit"].div = () => element("div");
stubs["gpui-kit"].svg = (path) => element("svg", path);
stubs["gpui-base"].h_flex = () => element("div");
stubs["gpui-base"].v_flex = () => element("div");
stubs.herdr.spaces = () => SPACES;
stubs.herdr.panes = () => [];
stubs.herdr.machines = () => MACHINES;
stubs.herdr.terminals = () => [];
stubs.herdr.agents = () => [];
stubs.herdr.focused = () => null;
stubs.herdr.theme = () => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : "#808080") });

const { default: Spaces } = await import("../mods/guide-spaces/main.js");

const KEY = "herdsidian.archived";
const space = (id, over = {}) => ({ id, name: id, folder: `/r/${id}`, tabs: [], status: "idle", ...over });
const remote = (id) => space(id, { machine: "vps" });
const online = [{ name: null, layout: "ready" }, { name: "vps", layout: "ready" }];
const offline = [{ name: null, layout: "ready" }, { name: "vps", layout: "connecting" }];

beforeEach(() => {
  state.shared = { "herdsidian.settings": { contextInSidebar: false }, [KEY]: { spaces: ["vps/x"], agents: [] } };
  state.runs = []; state.commands = []; state.layout = { id: "root", children: [] };
  localStorage.removeItem("pins"); localStorage.removeItem("changed");
  SPACES = [space("p"), remote("vps/x"), remote("vps/y")];
  MACHINES = online;
});

function mount() {
  const view = new Spaces(), cx = fakeCx(), timers = [];
  cx.timer = { every: (_ms, fn) => { timers.push(fn); } };
  cx.stop_propagation = () => {};
  view.init({}, cx);
  const tick = async () => { for (const fn of timers) fn(cx); await settle(); };
  return { view, tick };
}

test("tidy: a put-back remote space is remembered while its machine is offline; the reconnect does not move it again", async () => {
  const m = mount();
  await m.tick();
  assert.equal(state.runs.length, 1);
  assert.equal(state.runs[0][1].id, "vps/y");

  MACHINES = offline; SPACES = [space("p")];
  await m.tick();
  assert.ok(m.view.putBack.has("vps/y"));

  MACHINES = online; SPACES = [space("p"), remote("vps/x"), remote("vps/y")];
  await m.tick();
  await m.tick();
  assert.equal(state.runs.length, 1);
});

test("tidy: a put-back remote space that is gone while its machine is ready is forgotten", async () => {
  const m = mount();
  await m.tick();
  assert.ok(m.view.putBack.has("vps/y"));
  SPACES = [space("p"), remote("vps/x")];
  await m.tick();
  assert.ok(!m.view.putBack.has("vps/y"));
});
