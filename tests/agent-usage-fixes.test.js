// Review fixes on the agent usage and context change: Claude's synthetic API-error lines, the
// refresher's parse cache key, the context values on the rail and a refresh asked for while one
// runs, a relative XDG_STATE_HOME, the hook's number check and the shared listing scripts.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { state, fakeCx, settle, element, walk } from "./support/mod-stubs.js";
import { during } from "./support/live-cx.js";
import {
  CLAUDE_CONTEXT_SCRIPT, GROK_CONTEXT_SCRIPT, KIRO_CONTEXT_SCRIPT, createContextRefresher, parseClaudeContext,
} from "../mods/guide-agents/agent-context.js";
import * as agentFiles from "../lib/agent-files.js";

// Read through the namespace, so a missing export fails its own tests, not the whole file.
const { DROP_RELATIVE_STATE_HOME_SH, KIRO_DIR_FN, LIST_JSON_FN, STATE_DIR_SH } = agentFiles;
const kiroListScript = (minutes) => agentFiles.kiroListScript(minutes);
const grokListScript = (minutes) => agentFiles.grokListScript(minutes);

const onMac = process.platform === "darwin";
const never = () => new Promise(() => {});
const HOOK = new URL("../scripts/grok-status-line.sh", import.meta.url).pathname;
const SETTINGS = "herdsidian.settings";

async function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), "agent-usage-fixes-"));
  try { return await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
const put = (path, text) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};
const sh = (script, env, args = []) => spawnSync("/bin/sh", ["-c", script, "sh", ...args], { env: { PATH: "/usr/bin:/bin", ...env }, encoding: "utf8" });

// ---- 1: Claude Code's synthetic API-error lines ----

const usage = (input, read, create) => ({ input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: create, output_tokens: 50 });
const assistant = ({ model = "claude-x", usage: u, apiError = false }) => JSON.stringify({
  parentUuid: "u0", isSidechain: false, userType: "external", cwd: "/w", sessionId: "s1",
  message: { id: "m1", type: "message", role: "assistant", model, content: [{ type: "text", text: "hi" }], usage: u },
  type: "assistant", uuid: "u1", ...(apiError ? { isApiErrorMessage: true } : {}),
});

test("Claude: a synthetic API-error line after a real one is never the last usage", { skip: !onMac }, () => withTemp((home) => {
  const real = assistant({ usage: usage(2, 130000, 3998) });
  const variants = {
    both: assistant({ model: "<synthetic>", usage: usage(0, 0, 0), apiError: true }),
    apiErrorOnly: assistant({ usage: usage(0, 0, 0), apiError: true }),
    syntheticOnly: assistant({ model: "<synthetic>", usage: usage(0, 0, 0) }),
  };
  for (const [name, synthetic] of Object.entries(variants)) {
    put(join(home, ".claude", "projects", "-w", "s.jsonl"), `${real}\n${synthetic}\n`);
    const v = parseClaudeContext(sh(CLAUDE_CONTEXT_SCRIPT, { HOME: home }, ["-w"]).stdout).get("-w");
    assert.equal(v?.usedTokens, 134000, name);
    assert.equal(v?.percent, 67, name);
  }
}));

// ---- 2: the refresher's parse cache ----

const kiroJson = (percent) => JSON.stringify({
  cwd: "/w", updated_at: new Date().toISOString(),
  session_state: { rts_model_state: { context_usage_percentage: percent, model_info: { context_window_tokens: 200000 } } },
});

test("refresher: a same-second rewrite with another size is read again; same mtime and size is not", async () => {
  const file = "/k/sessions/cli/a.json";
  const sec = Math.floor(Date.now() / 1000);
  let size = 400, text = kiroJson(10);
  const reads = [];
  const ctx = createContextRefresher({
    exec: async (_cmd, args) => ({ code: 0, stderr: "", stdout: args[1] === KIRO_CONTEXT_SCRIPT ? `dir /k/sessions/cli\n${sec} ${size} ${file}\n` : "" }),
    readTextFile: async (path) => { reads.push(path); return text; },
    sleep: never,
  });
  const agents = [{ address: "t1", pane: "p1", status: "idle", program: { key: "kiro", name: "kiro" } }];
  const panes = [{ pane: "p1", cwd: "/w", terminal: "term-p1" }];
  await ctx.refresh(agents, panes);
  assert.equal(ctx.value("t1")?.percent, 10);
  size = 512; text = kiroJson(20);
  await ctx.refresh(agents, panes);
  assert.equal(reads.length, 2, "re-read after the size changed");
  assert.equal(ctx.value("t1")?.percent, 20);
  text = kiroJson(30);
  await ctx.refresh(agents, panes);
  assert.equal(reads.length, 2, "same mtime and size: from the cache");
  assert.equal(ctx.value("t1")?.percent, 20);
});

// ---- 3: the view: the rail and a refresh asked for while one runs ----

const stubs = globalThis.__herdsidianStubs;
const THEME = new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : "#808080") });
let AGENTS = [], PANES = [];
stubs["gpui-kit"].div = () => element("div");
stubs["gpui-kit"].svg = () => element("svg");
stubs["gpui-base"].h_flex = () => element("div");
stubs["gpui-base"].v_flex = () => element("div");
stubs.herdr.theme = () => THEME;
stubs.herdr.spaces = () => [{ id: "a", name: "alpha", folder: "/w", tabs: [], status: "idle" }];
stubs.herdr.panes = () => PANES;
stubs.herdr.terminals = () => [];
stubs.herdr.agents = () => AGENTS;
stubs.herdr.focused = () => null;

const { default: Agents } = await import("../mods/guide-agents/main.js");

const WIDE = { id: "root", children: [{ id: "sidebar", size: { px: 300 } }] };
const RAIL = { id: "root", children: [{ id: "sidebar", size: { px: 44 } }] };
const CLAUDE_OUT = '@@ -w-a\n"model":"claude-x"\n"input_tokens":124000\n"cache_read_input_tokens":0\n"cache_creation_input_tokens":0\n';
const ctxIds = (tree) => walk(tree).map((n) => n.nodeId).filter((id) => String(id).startsWith("ctx-"));

let execs, gate, release, hold, inflight, most;
beforeEach(() => {
  state.shared = {}; state.toasts = []; state.layout = WIDE;
  AGENTS = [{ address: "t1", pane: "p1", status: "idle", seq: 1, space: "a", space_name: "alpha", tab: "x", program: { key: "claude", name: "claude" } }];
  PANES = [{ pane: "p1", cwd: "/w/a", terminal: "term-p1", tab: "x" }];
  execs = 0; hold = false; inflight = 0; most = 0;
  gate = new Promise((r) => { release = r; });
  state.exec = async (_cmd, args) => {
    if (args?.[1] !== CLAUDE_CONTEXT_SCRIPT) return { code: 0, stdout: "", stderr: "" };
    execs++; inflight++; most = Math.max(most, inflight);
    try {
      if (hold) await gate;
      return { code: 0, stdout: CLAUDE_OUT, stderr: "" };
    } finally { inflight--; }
  };
  state.readTextFile = async (path) => { throw new Error(`no file ${path}`); };
});

// The view after init and its first refresh. tick() fires every timer it still has, as 30 s would.
async function mount() {
  const view = new Agents(), cx = fakeCx(), timers = [];
  cx.timer = { every: (ms, fn) => { const t = { ms, fn, cancel() { t.cancelled = true; } }; timers.push(t); return t; }, after() {} };
  view.init({}, cx);
  await settle();
  const tick = () => { for (const t of timers) if (!t.cancelled) t.fn(cx); };
  return { view, cx, tick, tree: () => during(fakeCx(), (rcx) => view.render(rcx)) };
}

test("rail: entering the rail clears the values, so expanding never shows the old numbers", async () => {
  const { tree } = await mount();
  assert.deepEqual(ctxIds(tree()), ["ctx-t1"]);
  const before = execs;
  state.layout = RAIL;
  tree();
  await settle();
  state.layout = WIDE;
  assert.deepEqual(ctxIds(tree()), []);
  assert.equal(execs, before, "no refresh ran in between");
});

test("refresh: asked for while one runs, exactly one follow-up runs when it ends, never two at once", async () => {
  const { tick } = await mount();
  assert.equal(execs, 1);
  hold = true;
  tick();
  await settle();
  assert.equal(execs, 2);
  tick();
  tick();
  tick();
  await settle();
  assert.equal(execs, 2, "none starts while one runs");
  release();
  await settle();
  await settle();
  assert.equal(execs, 3, "one follow-up");
  assert.equal(most, 1, "never two at once");
});

test("refresh: after an off/on toggle during a refresh, the follow-up brings the values back", async () => {
  const { tree, tick } = await mount();
  hold = true;
  tick();
  await settle();
  assert.equal(execs, 2);
  state.shared[SETTINGS] = { contextInSidebar: false };
  tree();
  await settle();
  state.shared[SETTINGS] = { contextInSidebar: true };
  tree();
  await settle();
  assert.equal(execs, 2, "the toggle's refresh waits for the running one");
  assert.deepEqual(ctxIds(tree()), []);
  release();
  await settle();
  await settle();
  assert.equal(execs, 3);
  assert.equal(most, 1);
  assert.deepEqual(ctxIds(tree()), ["ctx-t1"]);
});

// ---- 4: a relative XDG_STATE_HOME is ignored ----

const hookPayload = (over = {}) => JSON.stringify({
  session_id: "sess-1", workspace: { current_dir: "/work/demo" }, model: { id: "grok-4", display_name: "Grok 4" },
  cost: { total_cost_usd: 1.25 },
  context_window: { context_window_size: 256000, context_tokens: 30720, used_percentage: 12, session_input_tokens: 900, session_output_tokens: 34, ...over },
});
const runHook = (input, env, cwd) => spawnSync("/bin/sh", [HOOK], { input, env: { PATH: "/usr/bin:/bin", ...env }, cwd, encoding: "utf8" });

test("hook: XDG_STATE_HOME=rel writes under $HOME/.local/state/herdsidian/grok and nothing in the cwd", { skip: !onMac }, () => withTemp((root) => {
  const home = join(root, "home"), work = join(root, "work");
  mkdirSync(home); mkdirSync(work);
  const r = runHook(hookPayload(), { HOME: home, XDG_STATE_HOME: "rel" }, work);
  assert.equal(r.status, 0);
  const got = JSON.parse(readFileSync(join(home, ".local", "state", "herdsidian", "grok", "sess-1.json"), "utf8"));
  assert.equal(got.session_id, "sess-1");
  assert.deepEqual(readdirSync(work), []);
}));

test("STATE_DIR_SH: after DROP_RELATIVE_STATE_HOME_SH a relative value resolves like the hook", () => {
  const resolve = (env) => sh(`${DROP_RELATIVE_STATE_HOME_SH}\nprintf %s "${STATE_DIR_SH}"`, env).stdout;
  assert.equal(resolve({ HOME: "/h/me", XDG_STATE_HOME: "rel" }), "/h/me/.local/state/herdsidian");
  assert.equal(resolve({ HOME: "/h/me", XDG_STATE_HOME: "rel/a" }), "/h/me/.local/state/herdsidian");
  assert.equal(resolve({ HOME: "/h/me", XDG_STATE_HOME: "" }), "/h/me/.local/state/herdsidian");
  assert.equal(resolve({ HOME: "/h/me" }), "/h/me/.local/state/herdsidian");
  assert.equal(resolve({ HOME: "/h/me", XDG_STATE_HOME: "/x/state" }), "/x/state/herdsidian");
});

test("Grok listing scripts with XDG_STATE_HOME=rel list the file the hook wrote", { skip: !onMac }, () => withTemp((root) => {
  const home = join(root, "home"), work = join(root, "work");
  mkdirSync(home); mkdirSync(work);
  runHook(hookPayload(), { HOME: home, XDG_STATE_HOME: "rel" }, work);
  const file = join(home, ".local", "state", "herdsidian", "grok", "sess-1.json");
  for (const script of [grokListScript(), GROK_CONTEXT_SCRIPT]) {
    const out = spawnSync("/bin/sh", ["-c", script], { env: { PATH: "/usr/bin:/bin", HOME: home, XDG_STATE_HOME: "rel" }, cwd: work, encoding: "utf8" }).stdout;
    assert.ok(out.includes(` ${file}\n`), out);
  }
}));

// ---- 5: the hook's number check ----

test("hook: a number field that is not a plain number is null and the other fields are kept", { skip: !onMac }, () => withTemp((home) => {
  const r = runHook(hookPayload({ used_percentage: "1-2" }), { HOME: home, XDG_STATE_HOME: home });
  assert.equal(r.status, 0);
  const got = JSON.parse(readFileSync(join(home, "herdsidian", "grok", "sess-1.json"), "utf8"));
  assert.equal(got.used_percentage, null);
  assert.equal(got.context_tokens, 30720);
  assert.equal(got.context_window_size, 256000);
  assert.equal(got.cost_usd, 1.25);
  assert.equal(r.stdout, "Grok 4\n");
}));

test("hook: only -?digits(.digits)?([eE][-+]?digits)? is a number; one bad field never loses the file", { skip: !onMac }, () => withTemp((home) => {
  const cases = [
    ["-3", -3], ["2.5e1", 25], ["1.5E+2", 150], ["7", 7],
    ["1-2", null], ["1.", null], [".5", null], ["1e", null], ["+1", null], ["--1", null], ["1.2.3", null],
    ["0x10", null], ["1e5e3", null], ["abc", null], ["1e999", null], ["007", null],
  ];
  for (const [raw, want] of cases) {
    rmSync(join(home, "herdsidian", "grok", "sess-1.json"), { force: true });
    const r = runHook(hookPayload({ context_tokens: raw }), { HOME: home, XDG_STATE_HOME: home });
    assert.equal(r.status, 0, raw);
    const got = JSON.parse(readFileSync(join(home, "herdsidian", "grok", "sess-1.json"), "utf8"));
    assert.equal(got.context_tokens, want, raw);
    assert.equal(got.used_percentage, 12, raw);
  }
}));

// ---- 8: the shared listing scripts ----

test("kiroListScript and grokListScript: no minutes lists every file, minutes adds the window", () => {
  assert.equal(kiroListScript(), `${KIRO_DIR_FN}\n${LIST_JSON_FN}\nlist_json "$(kiro_dir)/sessions/cli"`);
  assert.equal(kiroListScript(1440), `${KIRO_DIR_FN}\n${LIST_JSON_FN}\nlist_json "$(kiro_dir)/sessions/cli" 1440`);
  assert.equal(KIRO_CONTEXT_SCRIPT, kiroListScript(1440));
  assert.equal(grokListScript(), `${DROP_RELATIVE_STATE_HOME_SH}\n${LIST_JSON_FN}\nlist_json "${STATE_DIR_SH}/grok"`);
  assert.equal(GROK_CONTEXT_SCRIPT, grokListScript(1440));
});
