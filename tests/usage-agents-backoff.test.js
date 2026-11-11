// Usage: a failed knownAgents() is retried with backoff (5 s, 15 s, 60 s, then every 300 s), one
// timer at a time. A retry does nothing, and ends the chain, when Usage is off in the status bar.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, settle, element } from "./support/mod-stubs.js";

const stubs = globalThis.__herdsidianStubs;
const hooks = { knownAgents: async () => [], usageInStatus: true };
stubs["gpui-base"].HoverCard = { new: (id) => element("hovercard", id) };
stubs.herdr.knownAgents = (...args) => hooks.knownAgents(...args);
stubs.herdr.panes = () => [];
stubs.herdr.focused = () => null;
stubs.herdr.agents = () => [];
stubs.herdr.keys = () => [];
stubs.herdr.settings = () => ({ theme: "hs_nord_theme", usageInStatus: hooks.usageInStatus });
const T = { foreground: "#ffffff", muted: "#888888", accent: "#00ff00", blocked: "#ff0000", canvas: "#101010", chrome: "#202020", background: "#101010", raised: "#303030", working: "#0000ff" };
stubs.herdr.theme = () => new Proxy(T, { get: (target, key) => (typeof key === "string" ? target[key] ?? "#808080" : undefined) });

const { default: Status } = await import("../mods/herdsidian-status/main.js");

const AGENTS = [{ key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: true, installed: true }];

let timers, asked;
const start = async () => {
  const view = new Status(), cx = fakeCx();
  cx.timer.after = (ms, fn) => { const t = { ms, fn, live: true }; timers.push(t); return { cancel() { t.live = false; } }; };
  view.init({}, cx);
  await settle();
  return view;
};
// Fire the one pending retry and let the load settle. -> the ms it was scheduled for.
const fire = async () => {
  const pending = timers.filter((t) => t.live);
  assert.equal(pending.length, 1, "exactly one pending retry timer");
  const [t] = pending;
  t.live = false;
  t.fn();
  await settle();
  return t.ms;
};
const pending = () => timers.filter((t) => t.live).length;

beforeEach(() => {
  timers = []; asked = 0; hooks.usageInStatus = true;
  state.exec = async () => ({ code: 0, stdout: "", stderr: "" }); state.runs = []; state.shared = {};
});

test("backoff: while loads fail the retries come after 5 s, 15 s, 60 s, then every 300 s", async () => {
  hooks.knownAgents = async () => { asked++; throw new Error("down"); };
  await start();
  const seen = [timers.at(-1).ms];
  for (let i = 0; i < 5; i++) { await fire(); seen.push(timers.at(-1).ms); }
  assert.deepEqual(seen, [5000, 15000, 60000, 300000, 300000, 300000]);
  assert.equal(asked, 6);
});

test("backoff: a success resets the steps, so the next failure waits 5 s again", async () => {
  let ok = false;
  hooks.knownAgents = async () => { asked++; if (!ok) throw new Error("down"); return AGENTS; };
  const view = await start();
  await fire(); // 5 s retry fails, next is 15 s
  assert.equal(timers.at(-1).ms, 15000);
  ok = true;
  await fire();
  assert.equal(pending(), 0, "a success leaves no timer");
  ok = false;
  await view.loadAgents();
  await settle();
  assert.equal(timers.at(-1).ms, 5000, "the backoff restarted");
});

test("backoff: there is never more than one pending retry timer", async () => {
  hooks.knownAgents = async () => { asked++; throw new Error("down"); };
  const view = await start();
  await view.loadAgents();
  await view.loadAgents();
  await settle();
  assert.equal(pending(), 1);
});
