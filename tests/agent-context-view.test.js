// Context window on the agent rows (ACs 31-35): guide-agents renders black-box against the stubs.
// exec and readTextFile are stub hooks; no script runs and no real folder is read.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, settle, element, walk } from "./support/mod-stubs.js";
import { during } from "./support/live-cx.js";
import { CLAUDE_CONTEXT_SCRIPT, CODEX_CONTEXT_SCRIPT, GROK_CONTEXT_SCRIPT, KIRO_CONTEXT_SCRIPT } from "../mods/guide-agents/agent-context.js";
import { tokens } from "../mods/guide-agents/tokens.js";

const stubs = globalThis.__herdsidianStubs;
// Distinct theme colors, so accent, blocked and muted can be told apart.
const COLORS = { accent: "#2255ee", blocked: "#ee3322", muted: "#778899", foreground: "#111111", chrome: "#f0f0f0" };
const THEME = new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : COLORS[key] ?? "#808080") });
const TK = tokens(THEME);

let AGENTS = [], PANES = [], TERMINALS = [];
stubs["gpui-kit"].div = () => element("div");
stubs["gpui-kit"].svg = (path) => element("svg", path);
stubs["gpui-base"].h_flex = () => element("div");
stubs["gpui-base"].v_flex = () => element("div");
stubs.herdr.theme = () => THEME;
stubs.herdr.spaces = () => [{ id: "a", name: "alpha", folder: "/w", tabs: [], status: "idle" }];
stubs.herdr.panes = () => PANES;
stubs.herdr.terminals = () => TERMINALS;
stubs.herdr.agents = () => AGENTS;
stubs.herdr.focused = () => null;

const { default: Agents } = await import("../mods/guide-agents/main.js");

const WIDE = { id: "root", children: [{ id: "sidebar", size: { px: 300 } }] };
const RAIL = { id: "root", children: [{ id: "sidebar", size: { px: 44 } }] };
const agent = (address, pane, key, status = "idle") => ({ address, pane, status, seq: 1, space: "a", space_name: "alpha", tab: "x", program: { key, name: key } });
const pane = (id, cwd) => ({ pane: id, cwd, terminal: `term-${id}`, tab: "x" });
const claudeOut = (dir, used) => `@@ ${dir}\n"model":"claude-x"\n"input_tokens":${used}\n"cache_read_input_tokens":0\n"cache_creation_input_tokens":0\n`;
const listing = (dir, name) => `dir ${dir}\n${Math.floor(Date.now() / 1000)} 400 ${dir}/${name}\n`;
const grokFile = (over = {}) => JSON.stringify({ v: 1, session_id: "g1", cwd: "/w/d", model: "grok-4", updated_at: Date.now(), cost_usd: null, context_window_size: 256000, context_tokens: 30720, used_percentage: 12, session_input_tokens: 0, session_output_tokens: 0, ...over });

let execs, reads, answers, files;
beforeEach(() => {
  state.shared = {}; state.toasts = []; state.layout = WIDE;
  execs = []; reads = []; answers = {}; files = {};
  AGENTS = []; PANES = []; TERMINALS = [];
  state.exec = async (...args) => {
    execs.push(args);
    const a = answers[args[1]?.[1]];
    if (typeof a === "function") return a(args);
    return a && typeof a === "object" ? a : { stdout: a ?? "", stderr: "", code: 0 };
  };
  state.readTextFile = async (path) => {
    reads.push(path);
    if (path in files) return files[path];
    throw new Error(`no file ${path}`);
  };
});

// The view after init and its first refresh. `cx` is the AsyncContext init receives; render runs
// through during() so a kept render cx would throw.
async function mount(setup = (cx) => cx) {
  const view = new Agents(), cx = setup(fakeCx());
  view.init({}, cx);
  await settle();
  return { view, cx, tree: () => during(fakeCx(), (rcx) => view.render(rcx)) };
}
const call = (node, name) => node.calls.find(([n]) => n === name)?.[1];
const byId = (tree, id) => walk(tree).find((n) => n.nodeId === id) ?? null;
const ctxIds = (tree) => walk(tree).map((n) => n.nodeId).filter((id) => String(id).startsWith("ctx-"));
const texts = (node) => walk(node).flatMap((n) => n.kids.filter((c) => typeof c === "string"));
const has = (node, name, ...args) => node.calls.some(([n, a]) => n === name && JSON.stringify(a) === JSON.stringify(args));

// AC 31
test("AC31: a Claude agent at 62 % shows ctx-<address> with 62%, an accent ring and the token tooltip", async () => {
  AGENTS = [agent("t1", "p1", "claude")];
  PANES = [pane("p1", "/w/a")];
  answers[CLAUDE_CONTEXT_SCRIPT] = claudeOut("-w-a", 124000);
  const { tree } = await mount();
  const ctx = byId(tree(), "ctx-t1");
  assert.ok(ctx, "ctx-t1 is drawn");
  assert.ok(walk(byId(tree(), "ag-t1")).some((n) => n.nodeId === "ctx-t1"), "inside the row");
  assert.deepEqual(call(ctx, "tooltip"), ["Context: 124K of 200K tokens"]);
  assert.ok(texts(ctx).includes("62%"));
  const ring = walk(ctx).find((n) => n.arg === "mods/guide-agents/ring/ring-060.svg");
  assert.ok(ring, "the ring ring-060.svg");
  assert.ok(has(ring, "size", 12));
  assert.ok(has(ring, "text_color", COLORS.accent));
  const label = walk(ctx).find((n) => n.kids.includes("62%"));
  assert.ok(has(label, "text_color", COLORS.muted));
  assert.ok(has(label, "text_size", 11));
});

// AC 32
test("AC32: at 90 % the text and the fill are t.blocked", async () => {
  AGENTS = [agent("t1", "p1", "claude")];
  PANES = [pane("p1", "/w/a")];
  answers[CLAUDE_CONTEXT_SCRIPT] = claudeOut("-w-a", 180000);
  const { tree } = await mount();
  const ctx = byId(tree(), "ctx-t1");
  const ring = walk(ctx).find((n) => n.arg === "mods/guide-agents/ring/ring-090.svg");
  assert.ok(has(ring, "text_color", COLORS.blocked));
  assert.ok(has(walk(ctx).find((n) => n.kids.includes("90%")), "text_color", COLORS.blocked));
});

test("AC32: a percent of 140 reads 100%", async () => {
  AGENTS = [agent("t4", "p4", "grok")];
  PANES = [pane("p4", "/w/d")];
  answers[GROK_CONTEXT_SCRIPT] = listing("/s/grok", "g1.json");
  files["/s/grok/g1.json"] = grokFile({ used_percentage: 140 });
  const { tree } = await mount();
  const ctx = byId(tree(), "ctx-t4");
  assert.ok(texts(ctx).includes("100%"));
  assert.ok(walk(ctx).some((n) => n.arg === "mods/guide-agents/ring/ring-100.svg"));
  assert.deepEqual(call(ctx, "tooltip"), ["Context: 30.7K of 256K tokens"]);
});

// AC 33
test("AC33: an agent with no value draws today's row: no ctx- element, the status line as before", async () => {
  AGENTS = [agent("t1", "p1", "claude"), agent("t2", "p2", "opencode", "working")];
  PANES = [pane("p1", "/w/a"), pane("p2", "/w/b")];
  answers[CLAUDE_CONTEXT_SCRIPT] = claudeOut("-w-a", 124000);
  const { tree } = await mount();
  const row = byId(tree(), "ag-t2");
  assert.deepEqual(ctxIds(row), []);
  // The text column holds the name line, then the status div itself (not wrapped).
  const column = walk(row).find((n) => has(n, "flex_1") && has(n, "gap", 1));
  assert.equal(column.kids.length, 2);
  assert.deepEqual(column.kids[1].kids, ["Working"]);
  assert.ok(has(column.kids[1], "text_size", 11.5));
  // The same row in a view whose refresh found nothing is identical.
  answers[CLAUDE_CONTEXT_SCRIPT] = "";
  const plain = byId((await mount()).tree(), "ag-t2");
  assert.deepEqual(texts(row), texts(plain));
  assert.equal(walk(row).length, walk(plain).length);
});

test("AC33: sub-agent rows and the collapsed rail never have a ctx- element", async () => {
  AGENTS = [agent("t1", "p1", "claude")];
  PANES = [pane("p1", "/w/a")];
  TERMINALS = [{ address: "t1" }, { address: "t1.1", parent: "t1", state: "live", name: "helper", program: { key: "claude", name: "claude" } }];
  answers[CLAUDE_CONTEXT_SCRIPT] = claudeOut("-w-a", 124000);
  const { tree } = await mount();
  const t = tree();
  assert.deepEqual(ctxIds(t), ["ctx-t1"]);
  assert.deepEqual(ctxIds(byId(t, "sub-t1.1")), []);
  state.layout = RAIL;
  assert.deepEqual(ctxIds(tree()), []);
});

// AC 34
test("AC34: render makes no exec or readTextFile; the first refresh follows init, the next ones the 30 s timer, never two at once", async () => {
  AGENTS = ["a", "b", "c", "d", "e"].map((x, i) => agent(`t${i}`, `p${i}`, "claude"));
  PANES = ["a", "b", "c", "d", "e"].map((x, i) => pane(`p${i}`, `/w/${x}`));
  let release;
  const gate = new Promise((r) => { release = r; });
  let hold = false;
  answers[CLAUDE_CONTEXT_SCRIPT] = async () => {
    if (hold) await gate;
    return { stdout: ["a", "b", "c", "d", "e"].map((x) => claudeOut(`-w-${x}`, 20000)).join(""), stderr: "", code: 0 };
  };
  const spawned = [], every = [];
  const view = new Agents(), cx = fakeCx();
  cx.spawn = (task) => { spawned.push(task); };
  cx.timer = { every: (ms, fn) => { every.push({ ms, fn }); }, after() {} };
  view.init({}, cx);
  for (let i = 0; i < 5; i++) during(fakeCx(), (rcx) => view.render(rcx));
  await settle();
  assert.equal(execs.length, 0, "render alone execs nothing");
  assert.deepEqual(reads, []);
  // The first refresh: a task init spawned.
  for (const task of spawned.splice(0)) task(cx);
  await settle();
  assert.equal(execs.length, 1, "five Claude agents, one exec");
  assert.equal(execs[0][0], "/bin/sh");
  assert.deepEqual(execs[0][1].slice(0, 3), ["-c", CLAUDE_CONTEXT_SCRIPT, "sh"]);
  assert.deepEqual(execs[0][1].slice(3).sort(), ["-w-a", "-w-b", "-w-c", "-w-d", "-w-e"]);
  assert.equal(execs[0][2]?.timeout, 10000);
  for (let i = 0; i < 5; i++) assert.ok(byId(during(fakeCx(), (rcx) => view.render(rcx)), `ctx-t${i}`));
  // The next ones: on a 30 s timer.
  const timers = every.filter((e) => e.ms === 30000);
  assert.ok(timers.length >= 1);
  hold = true;
  for (const e of timers) e.fn(cx);
  for (const e of timers) e.fn(cx);
  await settle();
  assert.equal(execs.length, 2, "a refresh does not start while one runs");
  release();
  await settle();
  for (const e of timers) e.fn(cx);
  await settle();
  assert.equal(execs.length, 3);
  for (let i = 0; i < 5; i++) during(fakeCx(), (rcx) => view.render(rcx));
  assert.equal(execs.length, 3);
  assert.deepEqual(reads, []);
});

test("AC34: no refresh runs while the sidebar is the rail", async () => {
  AGENTS = [agent("t1", "p1", "claude")];
  PANES = [pane("p1", "/w/a")];
  state.layout = RAIL;
  await mount();
  assert.equal(execs.length, 0);
});

// AC 35
test("AC35: a rejecting, a timed-out and a non-JSON source show no value; nothing throws, no toast, the others show", async () => {
  AGENTS = [agent("t1", "p1", "claude"), agent("t2", "p2", "codex"), agent("t3", "p3", "kiro"), agent("t4", "p4", "grok")];
  PANES = [pane("p1", "/w/a"), pane("p2", "/w/b"), pane("p3", "/w/c"), pane("p4", "/w/d")];
  answers[CLAUDE_CONTEXT_SCRIPT] = async () => { throw new Error("cannot start"); };
  answers[CODEX_CONTEXT_SCRIPT] = () => new Promise(() => {});
  answers[KIRO_CONTEXT_SCRIPT] = listing("/k/sessions/cli", "k.json");
  files["/k/sessions/cli/k.json"] = "not json";
  answers[GROK_CONTEXT_SCRIPT] = listing("/s/grok", "g1.json");
  files["/s/grok/g1.json"] = grokFile();
  const sleeps = [];
  const { tree } = await mount((cx) => { cx.sleep = (ms) => { sleeps.push(ms); return new Promise((r) => setTimeout(r, 5)); }; return cx; });
  await settle();
  assert.ok(sleeps.includes(10000), "each task is limited to 10 s");
  assert.deepEqual(ctxIds(tree()), ["ctx-t4"]);
  assert.deepEqual(state.toasts, []);
});

test("AC35: Claude output that is not the expected shape gives no value", async () => {
  AGENTS = [agent("t1", "p1", "claude")];
  PANES = [pane("p1", "/w/a")];
  answers[CLAUDE_CONTEXT_SCRIPT] = "<html>{not json\n@@\n\"input_tokens\":abc\n";
  const { tree } = await mount();
  assert.deepEqual(ctxIds(tree()), []);
  assert.deepEqual(state.toasts, []);
});

test("AC35: a non-zero exit gives no value", async () => {
  AGENTS = [agent("t1", "p1", "claude")];
  PANES = [pane("p1", "/w/a")];
  answers[CLAUDE_CONTEXT_SCRIPT] = { stdout: claudeOut("-w-a", 124000), stderr: "boom", code: 2 };
  const { tree } = await mount();
  assert.deepEqual(ctxIds(tree()), []);
});
