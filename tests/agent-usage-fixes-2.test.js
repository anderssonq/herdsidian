// Second review round: a context tick when the sidebar leaves the rail, and the Grok hook's line
// shows only a finite percent from 0 to 999.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { state, fakeCx, settle, element, walk } from "./support/mod-stubs.js";
import { during } from "./support/live-cx.js";
import { CLAUDE_CONTEXT_SCRIPT } from "../mods/guide-agents/agent-context.js";

const onMac = process.platform === "darwin";
const HOOK = new URL("../scripts/grok-status-line.sh", import.meta.url).pathname;
const SETTINGS = "herdsidian.settings";

// ---- 2: leaving the rail queues one context tick ----

const stubs = globalThis.__herdsidianStubs;
stubs["gpui-kit"].div = () => element("div");
stubs["gpui-kit"].svg = () => element("svg");
stubs["gpui-base"].h_flex = () => element("div");
stubs["gpui-base"].v_flex = () => element("div");
stubs.herdr.theme = () => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : "#808080") });
stubs.herdr.spaces = () => [{ id: "a", name: "alpha", folder: "/w", tabs: [], status: "idle" }];
stubs.herdr.panes = () => [{ pane: "p1", cwd: "/w/a", terminal: "term-p1", tab: "x" }];
stubs.herdr.terminals = () => [];
stubs.herdr.agents = () => [{ address: "t1", pane: "p1", status: "idle", seq: 1, space: "a", space_name: "alpha", tab: "x", program: { key: "claude", name: "claude" } }];
stubs.herdr.focused = () => null;

const { default: Agents } = await import("../mods/guide-agents/main.js");

const WIDE = { id: "root", children: [{ id: "sidebar", size: { px: 300 } }] };
const RAIL = { id: "root", children: [{ id: "sidebar", size: { px: 44 } }] };
const CLAUDE_OUT = '@@ -w-a\n"model":"claude-x"\n"input_tokens":124000\n"cache_read_input_tokens":0\n"cache_creation_input_tokens":0\n';
const ctxIds = (tree) => walk(tree).map((n) => n.nodeId).filter((id) => String(id).startsWith("ctx-"));

let execs;
beforeEach(() => {
  state.shared = {}; state.toasts = []; state.layout = WIDE;
  execs = 0;
  state.exec = async (_cmd, args) => {
    if (args?.[1] === CLAUDE_CONTEXT_SCRIPT) execs++;
    return { code: 0, stdout: args?.[1] === CLAUDE_CONTEXT_SCRIPT ? CLAUDE_OUT : "", stderr: "" };
  };
  state.readTextFile = async (path) => { throw new Error(`no file ${path}`); };
});

async function mount() {
  const view = new Agents(), cx = fakeCx();
  view.init({}, cx);
  await settle();
  return { tree: () => during(fakeCx(), (rcx) => view.render(rcx)) };
}

test("rail to wide: exactly one tick is queued and it refreshes the values", async () => {
  const { tree } = await mount();
  assert.equal(execs, 1, "the first refresh");
  state.layout = RAIL;
  tree();
  await settle();
  assert.equal(execs, 1, "none on the rail");
  state.layout = WIDE;
  tree();
  tree();
  tree();
  await settle();
  assert.equal(execs, 2, "one refresh after leaving the rail");
  assert.deepEqual(ctxIds(tree()), ["ctx-t1"]);
  await settle();
  assert.equal(execs, 2);
});

test("rail to wide with the setting off: no tick, no exec", async () => {
  state.shared[SETTINGS] = { contextInSidebar: false };
  const { tree } = await mount();
  state.layout = RAIL;
  tree();
  await settle();
  state.layout = WIDE;
  tree();
  await settle();
  assert.equal(execs, 0);
  assert.deepEqual(ctxIds(tree()), []);
});

// ---- 3: the hook's line shows only a finite percent from 0 to 999 ----

const payload = (pct) => JSON.stringify({
  session_id: "sess-1", workspace: { current_dir: "/w" }, model: { id: "grok-4", display_name: "Grok 4" },
  context_window: { context_window_size: 256000, context_tokens: 30720, used_percentage: pct },
});

test("hook: the line shows a percent only when it is a finite number from 0 to 999; stderr stays empty", { skip: !onMac }, () => {
  const home = mkdtempSync(join(tmpdir(), "agent-usage-fixes-2-"));
  try {
    const cases = [
      ["1e999", "Grok 4\n"], ["-3", "Grok 4\n"], ["1000", "Grok 4\n"], ["1-2", "Grok 4\n"],
      ["12.4", "Grok 4 · 12% ctx\n"], ["0", "Grok 4 · 0% ctx\n"], ["999", "Grok 4 · 999% ctx\n"], ["1.5E+1", "Grok 4 · 15% ctx\n"],
    ];
    for (const [raw, line] of cases) {
      const r = spawnSync("/bin/sh", [HOOK], { input: payload(raw), env: { PATH: "/usr/bin:/bin", HOME: home, XDG_STATE_HOME: home }, encoding: "utf8" });
      assert.equal(r.status, 0, raw);
      assert.equal(r.stdout, line, raw);
      assert.equal(r.stderr, "", raw);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});
