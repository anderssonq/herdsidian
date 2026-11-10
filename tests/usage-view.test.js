// The Usage control and card in the status bar, rendered against stubbed runtimes.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, settle, element, walk, findById, svgPaths } from "./support/mod-stubs.js";

// The stubs treat HoverCard and knownAgents as "anything"; give them a shape this test can read.
const hooks = { knownAgents: async () => [], spaces: [], agents: [] };
const stubs = globalThis.__herdsidianStubs;
stubs["gpui-base"].HoverCard = { new: (id) => element("hovercard", id) };
stubs.herdr.knownAgents = (...args) => hooks.knownAgents(...args);
stubs.herdr.spaces = () => hooks.spaces;
stubs.herdr.agents = () => hooks.agents;

const { default: Status } = await import("../mods/herdsidian-status/main.js");
const { EMPTY_FAILED, EMPTY_NONE } = await import("../mods/herdsidian-status/usage.js");

const AGENTS = [
  { key: "opencode", name: "opencode", icon: "icons/opencode.svg", tint: true, installed: true },
  { key: "codex", name: "Codex", icon: "icons/codex.svg", tint: true, installed: true },
  { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: true, installed: true },
  { key: "gemini", name: "Gemini", icon: "icons/gemini.svg", tint: true, installed: true },
];
const FAR = "2099-01-01T00:00:00Z";
const CLAUDE = `{"five_hour":{"utilization":4.0,"resets_at":"${FAR}"},"seven_day":{"utilization":25.0,"resets_at":"${FAR}"}}\n200`;
const CODEX = '{"timestamp":"2026-10-31T19:45:27.541Z","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":23.0,"window_minutes":300,"resets_at":4102444800},"secondary":{"used_percent":53.0,"window_minutes":10080,"resets_at":4102444800},"plan_type":"plus"}}}';
const OPENCODE = "│Total Cost      $30.95 │\n│Input            4.1M │\n│Output         325.2K │\n";
const ok = (stdout) => ({ code: 0, stdout, stderr: "" });

let calls, timers;
const answering = (command, args) => {
  calls.push([command, args]);
  if (command === "opencode") return Promise.resolve(ok(OPENCODE));
  return Promise.resolve(ok(args[1].includes("curl") ? CLAUDE : CODEX));
};

beforeEach(() => {
  calls = []; timers = [];
  state.exec = answering; state.shared = {};
  hooks.knownAgents = async () => AGENTS;
  hooks.spaces = []; hooks.agents = [];
});

const start = async () => {
  const view = new Status(), cx = fakeCx();
  cx.timer = { after: (ms, fn) => { timers.push({ ms, fn }); return { cancel() {} }; } };
  view.init({}, cx);
  await settle();
  return { view, cx };
};
const hovercard = (view) => walk(view.render()).find((n) => n.kind === "hovercard");
const call = (node, name) => node.calls.find(([n]) => n === name)?.[1][0];
const hoverHandler = (card) => call(call(card, "trigger"), "on_hover");
const textsOf = (node, out = []) => {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object" && "kids" in node) {
    for (const kid of node.kids) textsOf(kid, out);
    for (const [name, args] of node.calls) if (name !== "child" && name !== "children") for (const a of args) if (a && typeof a === "object" && "kids" in a) textsOf(a, out);
  }
  return out;
};
const cardText = (card) => textsOf(call(card, "content")).join(" | ");
const hover = async (view) => { hoverHandler(hovercard(view))(true); await settle(); };

test("the control sits at the right end of the status bar with the card timing (AC1, AC6)", async () => {
  const { view } = await start();
  const kids = view.render().kids;
  const at = kids.findIndex((n) => n?.kind === "hovercard");
  assert.ok(at >= 0, "the hover card is in the status bar");
  assert.equal(at, kids.length - 1, "last, after the spacer");
  assert.ok(kids[at - 1].calls.some(([n]) => n === "flex_1"), "the spacer pushes it right");
  const card = kids[at];
  assert.equal(call(card, "open_delay"), 0);
  assert.equal(call(card, "close_delay"), 150);
  assert.equal(call(card, "anchor"), "bottom_right");
  const control = call(card, "trigger");
  assert.equal(control.nodeId, "usage");
  assert.ok(control.calls.some(([n]) => n === "flex_none"), "never shrinks");
  assert.ok(control.calls.some(([n, a]) => n === "on_mouse_down" && a[0] === "left"));
});

test("the card is 280 px wide (AC7)", async () => {
  const { view } = await start();
  assert.equal(call(call(hovercard(view), "content"), "w"), 280);
});

test("the control shows each provider icon, primary first, once agents are known (AC1, AC2)", async () => {
  const { view } = await start();
  const control = call(hovercard(view), "trigger");
  assert.deepEqual(svgPaths(control), ["icons/claude.svg", "icons/codex.svg", "icons/opencode.svg"]);
});

test("no icons while knownAgents has not answered, when it rejects, or when none is installed (AC3, AC12)", async () => {
  hooks.knownAgents = () => new Promise(() => {});
  let { view } = await start();
  assert.deepEqual(svgPaths(call(hovercard(view), "trigger")), []);
  assert.ok(textsOf(call(hovercard(view), "trigger")).includes("Usage"));

  hooks.knownAgents = () => Promise.reject(new Error("no shell"));
  ({ view } = await start());
  assert.deepEqual(svgPaths(call(hovercard(view), "trigger")), []);
  assert.equal(cardText(hovercard(view)), EMPTY_FAILED);

  hooks.knownAgents = async () => [{ key: "gemini", installed: true }, { key: "claude", installed: false }];
  ({ view } = await start());
  assert.deepEqual(svgPaths(call(hovercard(view), "trigger")), []);
  assert.equal(cardText(hovercard(view)), EMPTY_NONE);
});

test("nothing is fetched until the first hover, and leaving the control fetches nothing (AC13, AC16)", async () => {
  const { view } = await start();
  await settle();
  assert.equal(calls.length, 0);
  hoverHandler(hovercard(view))(false);
  await settle();
  assert.equal(calls.length, 0);
  assert.equal(timers.length, 0);
});

test("the first hover fetches each installed provider once and the sections show their readings (AC9-AC11)", async () => {
  const { view } = await start();
  await hover(view);
  assert.deepEqual(calls.map(([c]) => c), ["/bin/sh", "/bin/sh", "opencode"]);
  const text = cardText(hovercard(view));
  assert.match(text, /Claude Code/);
  assert.match(text, /5 h \| 4% \|.*resets in/);
  assert.match(text, /7 d \| 25% \|.*resets in/);
  assert.match(text, /Codex \| plus/);
  assert.match(text, /5 h \| 23%/);
  assert.match(text, /7 d \| 53%/);
  assert.match(text, /updated \d+ d ago/);
  assert.match(text, /opencode \| Last 7 days, no usage limits \| Cost \| \$30\.95 \| Input \| 4\.1M \| Output \| 325\.2K/);
  assert.ok(text.indexOf("Claude Code") < text.indexOf("Codex") && text.indexOf("Codex") < text.indexOf("opencode"));
});

test("a section shows Loading… until its own fetch ends (AC8)", async () => {
  state.exec = (command, args) => { calls.push([command, args]); return new Promise(() => {}); };
  const { view } = await start();
  await hover(view);
  assert.equal(calls.length, 3);
  assert.equal(cardText(hovercard(view)).split("Loading…").length - 1, 3);
});

test("a second hover inside 5 minutes starts no fetch (AC14)", async () => {
  const { view } = await start();
  await hover(view);
  const first = calls.length;
  await hover(view);
  assert.equal(calls.length, first);
});

test("a failing exec shows the fixed text, never the raw message (AC18, AC19)", async () => {
  state.exec = () => Promise.reject(new Error("Bearer sk-ant-FAKE spawn failed"));
  const { view } = await start();
  await hover(view);
  const text = cardText(hovercard(view));
  assert.equal(text.split("Usage unavailable.").length - 1, 3);
  assert.doesNotMatch(text, /sk-ant|Bearer|spawn/);
});

test("a fetch over 15 s shows Timed out. while the others still show (AC17)", async () => {
  state.exec = (command, args) => {
    calls.push([command, args]);
    return command === "opencode" ? new Promise(() => {}) : Promise.resolve(ok(args[1].includes("curl") ? CLAUDE : CODEX));
  };
  const { view } = await start();
  await hover(view);
  assert.deepEqual(timers.map((t) => t.ms), [15000, 15000, 15000]);
  timers[2].fn();
  const text = cardText(hovercard(view));
  assert.match(text, /opencode \| Timed out\./);
  assert.match(text, /5 h \| 4%/);
});

test("the status bar keeps the machine, branch, agent counts and the Needs you pill (AC32)", async () => {
  hooks.spaces = [{ active: true, branch: "main" }];
  hooks.agents = [{ pane: "p1", status: "working" }, { pane: "p2", status: "blocked" }];
  const { view } = await start();
  const tree = view.render();
  const texts = textsOf(tree);
  for (const text of ["This computer", "main", "1 working", "Needs you"]) assert.ok(texts.includes(text), text);
  assert.ok(findById(tree, "status-needs"));
  assert.ok(hovercard(view), "and Usage");
});
