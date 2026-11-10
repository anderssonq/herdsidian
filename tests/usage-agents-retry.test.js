// Usage: a failed knownAgents() at load is retried once, 5 s later, without waiting for a hover.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, settle, element, walk } from "./support/mod-stubs.js";

const stubs = globalThis.__herdsidianStubs;
const hooks = { knownAgents: async () => [] };
stubs["gpui-base"].HoverCard = { new: (id) => element("hovercard", id) };
stubs.herdr.knownAgents = (...args) => hooks.knownAgents(...args);
stubs.herdr.panes = () => [];
stubs.herdr.focused = () => null;
stubs.herdr.agents = () => [];
stubs.herdr.keys = () => [];
stubs.herdr.settings = () => ({ theme: "hs_nord_theme" });
const T = { foreground: "#ffffff", muted: "#888888", accent: "#00ff00", blocked: "#ff0000", canvas: "#101010", chrome: "#202020", background: "#101010", raised: "#303030", working: "#0000ff" };
stubs.herdr.theme = () => new Proxy(T, { get: (target, key) => (typeof key === "string" ? target[key] ?? "#808080" : undefined) });

const { default: Status } = await import("../mods/herdsidian-status/main.js");

const AGENTS = [{ key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: true, installed: true }];
const RETRY_MS = 5000;

let timers, asked;
const start = async () => {
  const view = new Status(), cx = fakeCx();
  cx.timer.after = (ms, fn) => { timers.push([ms, fn]); return { cancel() {} }; };
  view.init({}, cx);
  await settle();
  return { view, cx };
};
const retries = () => timers.filter(([ms]) => ms === RETRY_MS);
const control = (view) => walk(view.render()).find((n) => n.kind === "hovercard").calls.find(([n]) => n === "trigger")[1][0];
const showsWordOnly = (view) => control(view).calls.some(([n, args]) => n === "child" && args[0] === "Usage");

beforeEach(() => {
  timers = []; asked = 0;
  state.exec = async () => ({ code: 0, stdout: "", stderr: "" }); state.runs = []; state.shared = {};
});

test("a rejected load schedules one retry in 5 s, and the retry fills the providers", async () => {
  hooks.knownAgents = async () => { asked++; if (asked === 1) throw new Error("shell timed out"); return AGENTS; };
  const { view } = await start();
  assert.equal(asked, 1);
  assert.equal(view.agentsFailed, true);
  assert.ok(showsWordOnly(view), "before the retry the control shows only the word Usage");
  assert.equal(retries().length, 1, "one retry scheduled");
  retries()[0][1]();
  await settle();
  assert.equal(asked, 2);
  assert.equal(view.agentsFailed, false);
  assert.ok(!showsWordOnly(view), "after the retry the control shows a provider");
});

test("a retry that fails again schedules no further retry", async () => {
  hooks.knownAgents = async () => { asked++; throw new Error("down"); };
  await start();
  retries()[0][1]();
  await settle();
  assert.equal(asked, 2);
  assert.equal(retries().length, 1, "still exactly one retry: no loop");
});

test("a successful load schedules no retry", async () => {
  hooks.knownAgents = async () => { asked++; return AGENTS; };
  await start();
  assert.equal(asked, 1);
  assert.equal(retries().length, 0);
});

test("after a success, a later failure may retry once again", async () => {
  hooks.knownAgents = async () => { asked++; if (asked === 1) throw new Error("down"); return AGENTS; };
  const { view } = await start();
  retries()[0][1]();
  await settle();
  hooks.knownAgents = async () => { asked++; throw new Error("down again"); };
  await view.loadAgents();
  await settle();
  assert.equal(retries().length, 2, "a new failure after a success gets its own single retry");
});
