// Review fixes for the archive commands: the palette list memo must follow the archived store.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, element, settle } from "./support/mod-stubs.js";

const stubs = globalThis.__herdsidianStubs;
let SPACES = [];
stubs["gpui-kit"].div = () => element("div");
stubs["gpui-kit"].svg = (path) => element("svg", path);
stubs["gpui-base"].h_flex = () => element("div");
stubs["gpui-base"].v_flex = () => element("div");
stubs.herdr.spaces = () => SPACES;
stubs.herdr.panes = () => [];
stubs.herdr.machines = () => [{ name: null, layout: "ready" }];
stubs.herdr.terminals = () => [];
stubs.herdr.agents = () => [];
stubs.herdr.focused = () => null;
stubs.herdr.knownAgents = async () => [];
stubs.herdr.themes = () => [];
stubs.herdr.appHome = () => "/herdr-home";
stubs.herdr.theme = () => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : "#808080") });

const { Palette } = await import("../mods/herdsidian/palette-main.js");
const { modelKey, sameKey } = await import("../mods/herdsidian/palette.js");

beforeEach(() => {
  state.shared = { "herdsidian.settings": { contextInSidebar: false } };
  state.runs = []; state.toasts = []; state.closed = []; state.commands = []; state.files = {};
  state.props = { overlay: "o1" };
  state.layout = { id: "root", children: [{ id: "herdsidian", size: { px: 380 } }] };
  SPACES = [];
});

test("modelKey changes when the archived store changes", () => {
  const base = { query: "", tab: "all", agents: [], order: [], layoutName: "herdsidian", bindings: [], hasList: true };
  assert.ok(!sameKey(modelKey(base), modelKey({ ...base, archived: { spaces: ["a"], agents: [] } })));
});

test("an open palette follows an archive made elsewhere: restore-space replaces archive-space", async () => {
  SPACES = [{ id: "a", name: "a", folder: "/r/a", tabs: [], status: "idle", active: true }, { id: "b", name: "b", folder: "/r/b", tabs: [], status: "idle" }];
  const cx = fakeCx();
  const view = new Palette(cx);
  await settle();
  view.on.tab("commands", cx);
  const listed = () => { view.render(cx); return view.list.pickable.map((r) => r.key.replace(/^command:/, "")); };
  assert.ok(listed().includes("archive-space"));
  state.shared["herdsidian.archived"] = { spaces: ["a"], agents: [] };
  const after = listed();
  assert.ok(after.includes("restore-space"));
  assert.ok(!after.includes("archive-space"));
});
