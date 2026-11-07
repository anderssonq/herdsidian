// The Usage control and card in the toolbar, rendered against stubbed runtimes.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, settle, element, walk, findById, svgPaths } from "./support/mod-stubs.js";

// The stubs treat HoverCard and knownAgents as "anything"; give them a shape this test can read.
const hooks = { knownAgents: async () => [] };
const stubs = globalThis.__herdsidianStubs;
stubs["gpui-base"].HoverCard = { new: (id) => element("hovercard", id) };
stubs.herdr.knownAgents = (...args) => hooks.knownAgents(...args);

const { default: Tabs } = await import("../mods/herdsidian-tabs/main.js");
const { EMPTY_FAILED, EMPTY_NONE } = await import("../mods/herdsidian-tabs/usage.js");

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
  state.exec = answering;
  hooks.knownAgents = async () => AGENTS;
});

const start = async () => {
  const view = new Tabs(), cx = fakeCx();
  cx.timer = { after: (ms, fn) => { timers.push({ ms, fn }); return { cancel() {} }; } };
  view.init({}, cx);
  await settle();
  return { view, cx };
};
const hovercard = (view, cx) => walk(view.render(cx)).find((n) => n.kind === "hovercard");
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
const hover = async (view, cx) => { hoverHandler(hovercard(view, cx))(true, cx); await settle(); };

test("the control sits directly left of Search with the card timing (AC1, AC6)", async () => {
  const { view, cx } = await start();
  const root = view.render(cx);
  const kids = root.kids;
  const at = kids.findIndex((n) => n?.kind === "hovercard");
  assert.ok(at >= 0, "the hover card is in the toolbar");
  assert.equal(kids[at + 1].nodeId, "search");
  const card = kids[at];
  assert.equal(call(card, "open_delay"), 0);
  assert.equal(call(card, "close_delay"), 150);
  const control = call(card, "trigger");
  assert.equal(control.nodeId, "usage");
  assert.ok(control.calls.some(([n, a]) => n === "h" && a[0] === 30), "30 px high");
  assert.ok(control.calls.some(([n]) => n === "flex_none"), "never shrinks");
  assert.ok(control.calls.some(([n, a]) => n === "rounded" && a[0] === 8));
  assert.equal(control.onClick, null, "clicking does nothing else");
  assert.ok(control.calls.some(([n, a]) => n === "on_mouse_down" && a[0] === "left"));
  assert.ok(textsOf(control).includes("Usage"));
});

test("the card is 280 px wide (AC7)", async () => {
  const { view, cx } = await start();
  assert.equal(call(call(hovercard(view, cx), "content"), "w"), 280);
});

test("the control shows the word and each provider icon in order once agents are known (AC1, AC2)", async () => {
  const { view, cx } = await start();
  const control = call(hovercard(view, cx), "trigger");
  assert.deepEqual(svgPaths(control), ["icons/claude.svg", "icons/codex.svg", "icons/opencode.svg"]);
});

test("no icons while knownAgents has not answered, when it rejects, or when none is installed (AC3, AC12)", async () => {
  hooks.knownAgents = () => new Promise(() => {});
  let { view, cx } = await start();
  assert.deepEqual(svgPaths(call(hovercard(view, cx), "trigger")), []);
  assert.ok(textsOf(call(hovercard(view, cx), "trigger")).includes("Usage"));

  hooks.knownAgents = () => Promise.reject(new Error("no shell"));
  ({ view, cx } = await start());
  assert.deepEqual(svgPaths(call(hovercard(view, cx), "trigger")), []);
  assert.equal(cardText(hovercard(view, cx)), EMPTY_FAILED);

  hooks.knownAgents = async () => [{ key: "gemini", installed: true }, { key: "claude", installed: false }];
  ({ view, cx } = await start());
  assert.deepEqual(svgPaths(call(hovercard(view, cx), "trigger")), []);
  assert.equal(cardText(hovercard(view, cx)), EMPTY_NONE);
});

test("nothing is fetched until the first hover, and leaving the control fetches nothing (AC13, AC16)", async () => {
  const { view, cx } = await start();
  await settle();
  assert.equal(calls.length, 0);
  hoverHandler(hovercard(view, cx))(false, cx);
  await settle();
  assert.equal(calls.length, 0);
  assert.equal(timers.length, 0);
});

test("the first hover fetches each installed provider once and the sections show their readings (AC9-AC11)", async () => {
  const { view, cx } = await start();
  await hover(view, cx);
  assert.deepEqual(calls.map(([c]) => c), ["/bin/sh", "/bin/sh", "opencode"]);
  const text = cardText(hovercard(view, cx));
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
  const { view, cx } = await start();
  await hover(view, cx);
  assert.equal(calls.length, 3);
  assert.equal(cardText(hovercard(view, cx)).split("Loading…").length - 1, 3);
});

test("a second hover inside 5 minutes starts no fetch (AC14)", async () => {
  const { view, cx } = await start();
  await hover(view, cx);
  const first = calls.length;
  await hover(view, cx);
  assert.equal(calls.length, first);
});

test("a failing exec shows the fixed text, never the raw message (AC18, AC19)", async () => {
  state.exec = () => Promise.reject(new Error("Bearer sk-ant-FAKE spawn failed"));
  const { view, cx } = await start();
  await hover(view, cx);
  const text = cardText(hovercard(view, cx));
  assert.equal(text.split("Usage unavailable.").length - 1, 3);
  assert.doesNotMatch(text, /sk-ant|Bearer|spawn/);
});

test("a fetch over 15 s shows Timed out. while the others still show (AC17)", async () => {
  state.exec = (command, args) => {
    calls.push([command, args]);
    return command === "opencode" ? new Promise(() => {}) : Promise.resolve(ok(args[1].includes("curl") ? CLAUDE : CODEX));
  };
  const { view, cx } = await start();
  await hover(view, cx);
  assert.deepEqual(timers.map((t) => t.ms), [15000, 15000, 15000]);
  timers[2].fn();
  const text = cardText(hovercard(view, cx));
  assert.match(text, /opencode \| Timed out\./);
  assert.match(text, /5 h \| 4%/);
});

test("the toolbar keeps its other controls (AC32)", async () => {
  const { view, cx } = await start();
  const tree = view.render(cx);
  for (const id of ["panel-files", "panel-changes", "tab-new", "search", "notes-toggle"]) assert.ok(findById(tree, id), id);
});
