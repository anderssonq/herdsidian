// Context window: the Settings switch `contextInSidebar` (ACs 36a, 36b, 36c). 36a and 36b test lib/keys.js,
// lib/settings.js and the palette's Settings tab. 36c renders guide-agents black-box against the stubs.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { state, fakeCx, settle, element, findById, walk } from "./support/mod-stubs.js";
import { SETTING_DEFAULTS, readSettings, settingSections } from "../lib/keys.js";

const stubs = globalThis.__herdsidianStubs;
const SETTINGS = "herdsidian.settings";
const HERDR_SETTINGS = "/herdr-home/settings.json";
const MODS = ["herdsidian", "herdsidian-status", "herdsidian-tabs", "guide-agents", "guide-spaces"];

// Stubs the palette and guide-agents need, set before their imports (the mods capture them at import).
const PANES = [{ pane: "p1", cwd: "/work/proj", program: { key: "claude" } }];
const AGENTS = [{ address: "t1", pane: "p1", status: "idle", seq: 1, space: "a", space_name: "alpha", program: { key: "claude", name: "Claude Code" } }];
stubs["gpui-kit"].div = () => element("div");
stubs["gpui-kit"].svg = () => element("svg");
stubs["gpui-base"].h_flex = () => element("div");
stubs["gpui-base"].v_flex = () => element("div");
stubs.herdr.theme = () => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : "#808080") });
stubs.herdr.themes = () => [];
stubs.herdr.settings = () => ({ zoom: 1 });
stubs.herdr.keys = () => [];
stubs.herdr.appHome = () => "/herdr-home";
stubs.herdr.spaces = () => [{ id: "a", name: "alpha", folder: "/work/proj", tabs: [], status: "idle" }];
stubs.herdr.panes = () => PANES;
stubs.herdr.terminals = () => [];
stubs.herdr.agents = () => AGENTS;
stubs.herdr.focused = () => null;

const { Palette } = await import("../mods/herdsidian/palette-main.js");
const { default: Agents } = await import("../mods/guide-agents/main.js");

// A Claude context answer in the shape the plan fixes for CLAUDE_CONTEXT_SCRIPT.
const CLAUDE_OUT = '@@ -work-proj\n"model":"claude-opus-4"\n"input_tokens":1000\n"cache_read_input_tokens":19000\n"cache_creation_input_tokens":0\n';

let execs, reads;
beforeEach(() => {
  state.shared = {}; state.runs = []; state.closed = []; state.props = { overlay: "o1" };
  state.layout = { id: "root", children: [{ id: "herdsidian", size: { px: 380 } }] };
  state.files = { [HERDR_SETTINGS]: "{}" };
  execs = []; reads = [];
  state.exec = async (...args) => { execs.push(args); return { stdout: CLAUDE_OUT, stderr: "", code: 0 }; };
  state.readTextFile = async (path) => { reads.push(path); throw new Error(`no file ${path}`); };
});

// 36a

test("36a: SETTING_DEFAULTS has contextInSidebar true", () => {
  assert.deepEqual(SETTING_DEFAULTS, { keyHints: "modifier", usageInStatus: true, contextInSidebar: true });
});

test("36a: readSettings keeps a boolean contextInSidebar and replaces anything else with true", () => {
  assert.equal(readSettings({ contextInSidebar: false }).contextInSidebar, false);
  assert.equal(readSettings({ contextInSidebar: true }).contextInSidebar, true);
  for (const bad of ["no", 0, 1, null, undefined, {}, []]) assert.equal(readSettings({ contextInSidebar: bad }).contextInSidebar, true, String(bad));
  for (const raw of [undefined, null, "off", 3]) assert.equal(readSettings(raw).contextInSidebar, true);
});

test("36a: every copy of lib/keys.js and lib/settings.js is byte-identical", () => {
  for (const file of ["keys.js", "settings.js"]) {
    const canon = readFileSync(new URL(`../lib/${file}`, import.meta.url));
    for (const mod of MODS) assert.ok(canon.equals(readFileSync(new URL(`../mods/${mod}/${file}`, import.meta.url))), `${mod}/${file}`);
  }
});

// 36b

const inputs = (over = {}) => ({ settings: readSettings(undefined), sidebarHidden: false, sidebarRail: false, sidebarTab: "notes", ...over });

test("36b: the Layout rows end with context-in-sidebar, with and without the sidebar", () => {
  const ids = (over) => settingSections(inputs(over))[1].rows.map((r) => r.id);
  assert.deepEqual(ids(), ["right-sidebar", "sidebar-tab", "sidebar-width", "usage-in-status", "context-in-sidebar"]);
  assert.deepEqual(ids({ sidebarHidden: true }), ["right-sidebar", "sidebar-tab", "usage-in-status", "context-in-sidebar"]);
});

test("36b: the row's label is `Context in the sidebar` and its detail On or Off, a missing key reading as On", () => {
  const rowFor = (settings) => settingSections(inputs({ settings }))[1].rows.at(-1);
  assert.equal(rowFor(readSettings(undefined)).label, "Context in the sidebar");
  assert.equal(rowFor(readSettings(undefined)).detail, "On");
  assert.equal(rowFor({ keyHints: "modifier", usageInStatus: true }).detail, "On");
  assert.equal(rowFor({ ...SETTING_DEFAULTS, contextInSidebar: false }).detail, "Off");
});

test("36b: the row toggles contextInSidebar like usage-in-status toggles usageInStatus", () => {
  const act = (settings) => settingSections(inputs({ settings }))[1].rows.at(-1).action;
  assert.deepEqual(act({ ...SETTING_DEFAULTS, contextInSidebar: true }), { type: "setting", name: "contextInSidebar", value: false });
  assert.deepEqual(act({ ...SETTING_DEFAULTS, contextInSidebar: false }), { type: "setting", name: "contextInSidebar", value: true });
});

const mountPalette = async () => {
  const cx = fakeCx();
  const view = new Palette(cx);
  await settle();
  view.on.tab("settings", cx);
  return { cx, tree: () => view.render(cx) };
};
const ctxRow = (tree) => findById(tree, "row-setting:context-in-sidebar");

test("36b: the Settings tab shows the row and a click stores only the changed key over what is stored", async () => {
  state.shared[SETTINGS] = { keyHints: "always", usageInStatus: false };
  const { cx, tree } = await mountPalette();
  assert.ok(ctxRow(tree()), "row is drawn");
  ctxRow(tree()).onClick(null, cx);
  assert.deepEqual(state.shared[SETTINGS], { keyHints: "always", usageInStatus: false, contextInSidebar: false });
  ctxRow(tree()).onClick(null, cx);
  assert.deepEqual(state.shared[SETTINGS], { keyHints: "always", usageInStatus: false, contextInSidebar: true });
});

test("36b: with nothing stored, the toggle stores only contextInSidebar", async () => {
  const { cx, tree } = await mountPalette();
  ctxRow(tree()).onClick(null, cx);
  assert.deepEqual(state.shared[SETTINGS], { contextInSidebar: false });
});

test("36b: the ⌘K list has the key setting:context-in-sidebar", async () => {
  const { buildList, paletteSettings } = await import("../mods/herdsidian/palette.js");
  const settings = paletteSettings({ ...inputs(), themes: [], family: null, appearance: null });
  const all = buildList({ query: "", tab: "settings", vault: "/v", notes: [], notesError: null, linked: new Set(), contextPaths: [], agents: [], commands: [], hintFor: () => null, settings });
  assert.ok(all.pickable.some((r) => r.key === "setting:context-in-sidebar"));
});

// 36c

const timers = [];
const mountAgents = () => {
  const view = new Agents(), cx = fakeCx();
  cx.timer = { every: (ms, fn) => { const t = { ms, fn, cancelled: false, cancel() { t.cancelled = true; } }; timers.push(t); return t; }, after() {} };
  view.init({}, cx);
  return { view, cx, tree: () => view.render(cx) };
};
const ctxIds = (tree) => walk(tree).flatMap((n) => n.calls.filter(([name, a]) => name === "id" && String(a[0]).startsWith("ctx-")).map(([, a]) => a[0]));
const setContext = (on) => { state.shared[SETTINGS] = { contextInSidebar: on }; };
const contextExecs = () => execs.length + reads.length;

test("36c: with contextInSidebar false, no ctx- element, no extra timer, no exec or readTextFile", async () => {
  timers.length = 0;
  setContext(false);
  const { tree } = mountAgents();
  await settle();
  tree();
  await settle();
  assert.deepEqual(ctxIds(tree()), []);
  assert.equal(timers.length, 1, "only the existing notify timer");
  assert.equal(contextExecs(), 0);
});

test("36c: with contextInSidebar on, the refresh starts at init and the row shows a ctx- element", async () => {
  timers.length = 0;
  setContext(true);
  const { tree } = mountAgents();
  await settle();
  assert.equal(timers.length, 2, "the notify timer and the context timer");
  assert.ok(execs.length > 0, "context exec ran");
  assert.deepEqual(ctxIds(tree()), ["ctx-t1"]);
});

test("36c: turning it on later starts the refresh without a reload", async () => {
  timers.length = 0;
  setContext(false);
  const { tree } = mountAgents();
  await settle();
  tree();
  assert.equal(timers.length, 1);
  setContext(true);
  tree();
  await settle();
  assert.equal(timers.length, 2);
  assert.ok(execs.length > 0);
  assert.deepEqual(ctxIds(tree()), ["ctx-t1"]);
});

test("36c: turning it off stops the context timer and hides the element", async () => {
  timers.length = 0;
  setContext(true);
  const { tree } = mountAgents();
  await settle();
  assert.equal(timers.length, 2);
  setContext(false);
  tree();
  await settle();
  assert.equal(timers[1].cancelled, true, "context timer cancelled");
  assert.equal(timers[0].cancelled, false, "the notify timer is untouched");
  assert.deepEqual(ctxIds(tree()), []);
});
