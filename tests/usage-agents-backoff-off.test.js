// Usage: a scheduled agent-list retry does nothing, and ends the chain, when Usage is off in the
// status bar (the setting lives in shared("herdsidian.settings")). A later hover restarts the chain.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, settle, element } from "./support/mod-stubs.js";

const stubs = globalThis.__herdsidianStubs;
const hooks = { knownAgents: async () => [] };
stubs["gpui-base"].HoverCard = { new: (id) => element("hovercard", id) };
stubs.herdr.knownAgents = (...args) => hooks.knownAgents(...args);
stubs.herdr.panes = () => [];
stubs.herdr.focused = () => null;
stubs.herdr.agents = () => [];
stubs.herdr.keys = () => [];
const T = { foreground: "#ffffff", muted: "#888888", accent: "#00ff00", blocked: "#ff0000", canvas: "#101010", chrome: "#202020", background: "#101010", raised: "#303030", working: "#0000ff" };
stubs.herdr.theme = () => new Proxy(T, { get: (target, key) => (typeof key === "string" ? target[key] ?? "#808080" : undefined) });

const { default: Status } = await import("../mods/herdsidian-status/main.js");

let timers, asked;
const setUsage = (on) => { state.shared["herdsidian.settings"] = { usageInStatus: on }; };
const pending = () => timers.filter((t) => t.live);
const start = async () => {
  const view = new Status(), cx = fakeCx();
  cx.timer.after = (ms, fn) => { const t = { ms, fn, live: true }; timers.push(t); return { cancel() { t.live = false; } }; };
  view.init({}, cx);
  await settle();
  return view;
};

beforeEach(() => {
  timers = []; asked = 0;
  state.exec = async () => ({ code: 0, stdout: "", stderr: "" }); state.runs = []; state.shared = {};
  setUsage(true);
  hooks.knownAgents = async () => { asked++; throw new Error("down"); };
});

test("backoff: a retry fired while Usage is off in the status bar does nothing and ends the chain", async () => {
  await start();
  assert.equal(asked, 1);
  assert.equal(pending().length, 1);
  setUsage(false);
  const [t] = pending();
  t.live = false;
  t.fn();
  await settle();
  assert.equal(asked, 1, "no knownAgents call");
  assert.equal(pending().length, 0, "no further retry");
});

test("backoff: a hover after the chain ended restarts it", async () => {
  const view = await start();
  setUsage(false);
  const [t] = pending();
  t.live = false;
  t.fn();
  await settle();
  setUsage(true);
  await view.hoverUsage(true);
  await settle();
  assert.equal(asked, 2);
  assert.equal(pending().length, 1);
});
