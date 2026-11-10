// Usage: Kiro and Grok as providers (agent-usage-context spec, AC 1-5), plus the fetchProvider
// and createUsage hooks they need. The real status mod runs against stubs; nothing touches a real home.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, settle, element, walk, findById, svgPaths } from "./support/mod-stubs.js";

const stubs = globalThis.__herdsidianStubs;
const hooks = { knownAgents: async () => [], panes: [], focused: null, agents: [] };
stubs["gpui-base"].HoverCard = { new: (id) => element("hovercard", id) };
stubs.herdr.knownAgents = (...args) => hooks.knownAgents(...args);
stubs.herdr.panes = () => hooks.panes;
stubs.herdr.focused = () => hooks.focused;
stubs.herdr.agents = () => hooks.agents;
stubs.herdr.keys = () => [];
stubs.herdr.settings = () => ({ theme: "hs_nord_theme" });
const T = { foreground: "#ffffff", muted: "#888888", accent: "#00ff00", blocked: "#ff0000", canvas: "#101010", chrome: "#202020", background: "#101010", raised: "#303030", working: "#0000ff" };
stubs.herdr.theme = () => new Proxy(T, { get: (target, key) => (typeof key === "string" ? target[key] ?? "#808080" : undefined) });

const { default: Status } = await import("../mods/herdsidian-status/main.js");
const { PROVIDER_KEYS, EMPTY_NONE, ERROR_TEXT, errorText, providersFrom, fetchProvider, createUsage } = await import("../mods/herdsidian-status/usage.js");

const agent = (key, name, installed = true) => ({ key, name, icon: `icons/${key}.svg`, tint: true, installed });
const ALL = [agent("grok", "Grok"), agent("kiro", "Kiro"), agent("gemini", "Gemini"), agent("opencode", "opencode"),
  agent("codex", "Codex"), agent("claude", "Claude Code")];

let execCalls, readCalls;
beforeEach(() => {
  execCalls = []; readCalls = [];
  state.exec = async (command, args) => { execCalls.push([command, args]); return { code: 0, stdout: "", stderr: "" }; };
  state.readTextFile = async (path) => { readCalls.push(path); throw new Error("no file"); };
  state.shared = {};
  hooks.knownAgents = async () => ALL;
  hooks.panes = []; hooks.focused = null; hooks.agents = [];
});

const call = (node, name) => node.calls.find(([n]) => n === name)?.[1][0];
const textsOf = (node, out = []) => {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object" && "kids" in node) {
    for (const kid of node.kids) textsOf(kid, out);
    for (const [name, args] of node.calls) if (name !== "child" && name !== "children") for (const a of args) if (a && typeof a === "object" && "kids" in a) textsOf(a, out);
  }
  return out;
};
const start = async () => {
  const view = new Status();
  view.init({}, fakeCx());
  await settle();
  return view;
};
const hovercard = (view) => walk(view.render()).find((n) => n.kind === "hovercard");
const control = (view) => call(hovercard(view), "trigger");
const focusProgram = (key) => {
  hooks.panes = [{ pane: "p1", terminal: "t1", program: { key } }];
  hooks.focused = { pane: "p1" };
};

test("AC1: PROVIDER_KEYS lists the five providers in order", () => {
  assert.deepEqual(PROVIDER_KEYS, ["claude", "codex", "opencode", "kiro", "grok"]);
});

test("AC2: providersFrom keeps the installed supported providers in order, one each, never gemini", () => {
  const list = [agent("kiro", "Kiro off", false), ...ALL, agent("kiro", "Kiro again")];
  const got = providersFrom(list);
  assert.deepEqual(got.map((p) => p.key), ["claude", "codex", "opencode", "kiro", "grok"]);
  assert.equal(got.find((p) => p.key === "kiro").name, "Kiro");
  assert.deepEqual(providersFrom(ALL.slice().reverse()).map((p) => p.key), ["claude", "codex", "opencode", "kiro", "grok"]);
});

test("AC3: with no supported CLI the card says every supported CLI", async () => {
  assert.equal(EMPTY_NONE, "No supported agent CLI is installed. Usage covers Claude Code, Codex, opencode, Kiro and Grok.");
  hooks.knownAgents = async () => [agent("gemini", "Gemini")];
  const view = await start();
  await view.hoverUsage(true);
  await settle();
  assert.deepEqual(textsOf(call(hovercard(view), "content")), [EMPTY_NONE]);
});

test("AC4: the focused Kiro or Grok pane makes it primary and tagged, the other four follow in order", async () => {
  const cases = { kiro: ["Kiro", "Claude Code", "Codex", "opencode", "Grok"], grok: ["Grok", "Claude Code", "Codex", "opencode", "Kiro"] };
  for (const [key, names] of Object.entries(cases)) {
    focusProgram(key);
    const view = await start();
    const primary = findById(control(view), "usage-primary");
    assert.deepEqual(svgPaths(primary), [`icons/${key}.svg`]);
    const order = names.map((n) => (n === "Claude Code" ? "claude" : n.toLowerCase()));
    assert.deepEqual(svgPaths(control(view)), order.map((k) => `icons/${k}.svg`));
    const text = textsOf(call(hovercard(view), "content")).join(" | ");
    assert.equal(text.split("focused pane").length - 1, 1, key);
    const at = names.map((n) => text.indexOf(n));
    assert.deepEqual([...at].sort((a, b) => a - b), at, `${key}: card order`);
    assert.ok(at[0] < text.indexOf("focused pane") && text.indexOf("focused pane") < at[1], `${key}: tag after the primary's name`);
  }
});

test("AC5: before a hover, or with Usage off in Settings, no exec and no readTextFile runs", async () => {
  focusProgram("kiro");
  let view = await start();
  view.render();
  await settle();
  assert.equal(execCalls.length, 0);
  assert.equal(readCalls.length, 0);
  state.shared["herdsidian.settings"] = { usageInStatus: false };
  view = await start();
  await view.hoverUsage(true);
  await settle();
  assert.equal(execCalls.length, 0);
  assert.equal(readCalls.length, 0);
});

test("errorText finds ERROR_TEXT keys, then the month notes, then falls back to unavailable; ERROR_TEXT keeps its 5 keys", () => {
  assert.deepEqual(Object.keys(ERROR_TEXT).sort(), ["login", "none", "signedOut", "timeout", "unavailable"]);
  assert.equal(errorText("timeout"), "Timed out.");
  assert.equal(errorText("none"), "No Codex usage recorded yet.");
  assert.equal(errorText("kiroNoSessions"), "No Kiro sessions found.");
  assert.equal(errorText("grokNoHook"), "Grok usage needs the Herdsidian status line hook. See Usage in the README.");
  assert.equal(errorText("nonsense"), ERROR_TEXT.unavailable);
});

test("fetchProvider: two-argument calls keep working, and Kiro or Grok without readTextFile are unavailable", async () => {
  const exec = async (command, args) => { execCalls.push([command, args]); return { code: 0, stdout: "", stderr: "" }; };
  assert.deepEqual(await fetchProvider("opencode", exec), { error: "unavailable" });
  assert.deepEqual(await fetchProvider("kiro", exec), { error: "unavailable" });
  assert.deepEqual(await fetchProvider("grok", exec, { now: 1 }), { error: "unavailable" });
  assert.deepEqual(await fetchProvider("kiro", async () => { throw new Error("x"); }, { readTextFile: async () => "", now: 1 }), { error: "unavailable" });
});

test("createUsage passes readTextFile and now to the Kiro and Grok readers", async () => {
  const seen = [];
  const exec = async (command, args) => { seen.push([command, args]); return { code: 0, stdout: "nodir\n", stderr: "" }; };
  const usage = createUsage({ exec, readTextFile: async () => "", after: () => () => {}, now: () => 1 });
  usage.hover(["kiro", "grok"]);
  await settle();
  assert.equal(seen.length, 2);
  assert.deepEqual(usage.view("kiro"), { id: usage.view("kiro").id, state: "error", error: "kiroNoSessions" });
  assert.deepEqual(usage.view("grok"), { id: usage.view("grok").id, state: "error", error: "grokNoHook" });
});
