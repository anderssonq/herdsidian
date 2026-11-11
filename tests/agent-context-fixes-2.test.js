// Second review round for the context ring and Usage: the Claude ring never shows an older
// session's value, Kiro files of 1 MiB or more (Usage counts them as skipped, the ring gives their
// folder no value), the lazy agent load restarts an ended retry chain, the Codex known-file check
// is one pass, a task that never settles cannot freeze its program, and the docs and hook comment
// say what the code does.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { state, fakeCx, settle, element } from "./support/mod-stubs.js";
import { CLAUDE_CONTEXT_SCRIPT, CODEX_CONTEXT_SCRIPT, createContextRefresher, parseClaudeContext, parseCodexScan } from "../mods/guide-agents/agent-context.js";
import { fetchKiro } from "../mods/herdsidian-status/usage-month.js";

const onMac = process.platform === "darwin";
const never = () => new Promise(() => {});
const MiB = 1048576;

async function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), "agent-context-fix2-"));
  try { return await fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
}
const put = (path, text, ageMin = 0) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  if (ageMin) { const t = new Date(Date.now() - ageMin * 60000); utimesSync(path, t, t); }
};
const sh = (home, script, args = []) => spawnSync("/bin/sh", ["-c", script, "sh", ...args], { env: { PATH: "/usr/bin:/bin", HOME: home }, encoding: "utf8" });
// The host's exec over a temp HOME and a readTextFile that records every path.
const realHost = (home) => {
  const reads = [];
  return {
    reads,
    exec: async (cmd, args) => {
      const r = spawnSync(cmd, args, { env: { PATH: "/usr/bin:/bin", HOME: home }, encoding: "utf8" });
      return { stdout: r.stdout, stderr: r.stderr, code: r.status };
    },
    readTextFile: async (path) => {
      reads.push(path);
      if (statSync(path).size >= MiB) throw new Error("Text file exceeds 1 MiB");
      return readFileSync(path, "utf8");
    },
  };
};
const agent = (address, pane, key) => ({ address, pane, status: "idle", program: { key, name: key } });
const pane = (id, cwd) => ({ pane: id, cwd, terminal: `term-${id}` });

// Claude Code transcript lines, keys in the order Claude Code writes them (requestedModel after message).
const assistant = ({ read, requestedModel }) => JSON.stringify({
  parentUuid: "u0", isSidechain: false, userType: "external", cwd: "/w", sessionId: "s1", entrypoint: "cli",
  message: { id: "m1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: "SECRET-MARKER" }], usage: { input_tokens: 2, cache_read_input_tokens: read, cache_creation_input_tokens: 0, output_tokens: 5 } },
  ...(requestedModel ? { requestedModel } : {}),
  type: "assistant", uuid: "u1",
});
const user = (text = "hi") => JSON.stringify({ parentUuid: "u1", isSidechain: false, userType: "external", cwd: "/w", sessionId: "s1", entrypoint: "cli", type: "user", message: { role: "user", content: text } });

// Fix 1
test("fix1: a newer interactive session with no usage line yet gives no value, not the older session's 85 %", { skip: !onMac }, () => withHome(async (home) => {
  const dir = join(home, ".claude", "projects", "-w");
  put(join(dir, "old.jsonl"), `${user()}\n${assistant({ read: 170000 })}\n`, 30);
  const host = realHost(home);
  const ctx = createContextRefresher({ exec: host.exec, readTextFile: host.readTextFile, sleep: never });
  const run = () => ctx.refresh([agent("t1", "p1", "claude")], [pane("p1", "/w")]);
  await run();
  assert.equal(ctx.value("t1").percent, 85);
  const fresh = join(dir, "new.jsonl");
  put(fresh, `${user("a new session")}\n`);
  const r = sh(home, CLAUDE_CONTEXT_SCRIPT, ["-w"]);
  assert.ok(r.stdout.split("\n").includes(`## ${fresh}`), r.stdout);
  assert.equal(parseClaudeContext(r.stdout).get("-w") ?? null, null, "the script prints no usage from the older file");
  await run();
  assert.equal(ctx.value("t1"), null);
}));

test("fix1: the same newest session whose tail is one big line keeps its value; an older session never takes over", { skip: !onMac }, () => withHome(async (home) => {
  const dir = join(home, ".claude", "projects", "-w");
  put(join(dir, "older.jsonl"), `${assistant({ read: 170000 })}\n`, 30);
  const file = join(dir, "s.jsonl");
  put(file, `${user()}\n${assistant({ read: 134000 })}\n`);
  const host = realHost(home);
  const ctx = createContextRefresher({ exec: host.exec, readTextFile: host.readTextFile, sleep: never });
  const run = () => ctx.refresh([agent("t1", "p1", "claude")], [pane("p1", "/w")]);
  await run();
  assert.equal(ctx.value("t1").percent, 67);
  appendFileSync(file, `${user("SECRET-MARKER ".repeat(30000))}\n`);
  await run();
  assert.equal(ctx.value("t1").percent, 67, "same file, usage line out of the tail: kept");
}));

test("fix1: requestedModel written after message still gives the 1M window", { skip: !onMac }, () => withHome((home) => {
  put(join(home, ".claude", "projects", "-w", "s.jsonl"), `${assistant({ read: 130000, requestedModel: "claude-opus-5-5[1m]" })}\n`);
  const r = sh(home, CLAUDE_CONTEXT_SCRIPT, ["-w"]);
  const v = parseClaudeContext(r.stdout).get("-w");
  assert.deepEqual({ percent: v.percent, windowTokens: v.windowTokens }, { percent: 13, windowTokens: 1000000 });
  assert.ok(!r.stdout.includes("SECRET-MARKER"));
}));

// Fix 2
const NOW = new Date(2026, 10, 15, 12).getTime();
const kiroSession = (cwd, extra = {}) => JSON.stringify({
  session_id: "s", cwd, updated_at: new Date(NOW - 3600000).toISOString(), title: "SECRET-TITLE",
  session_state: { conversation_metadata: { user_turn_metadatas: [{ end_timestamp: new Date(NOW - 3600000).toISOString(), metering_usage: [{ value: 2, unit: "credit" }] }] },
    rts_model_state: { context_usage_percentage: 40, model_info: { context_window_tokens: 200000 } } },
  ...extra,
});

test("fix2: Usage counts a Kiro file of 1 MiB or more as skipped and never reads it", async () => {
  const sec = Math.floor((NOW - 3600000) / 1000);
  const reads = [];
  const readTextFile = async (path) => { reads.push(path); return kiroSession("/w"); };
  const both = await fetchKiro(async () => ({ code: 0, stdout: `dir /k\n${sec} 100 /k/a.json\n${sec} ${MiB} /k/big.json\n`, stderr: "" }), readTextFile, NOW);
  assert.equal(both.skipped, 1);
  assert.equal(both.credits, 2);
  const onlyBig = await fetchKiro(async () => ({ code: 0, stdout: `dir /k\n${sec} ${2 * MiB} /k/big.json\n`, stderr: "" }), readTextFile, NOW);
  assert.deepEqual(onlyBig, { error: "unavailable" }, "every file too big reads as Usage unavailable, not 0 credits");
  assert.deepEqual(reads, ["/k/a.json"]);
});

test("fix2: a too-big newest Kiro session gives its folder no value; an older too-big one hides nothing", { skip: !onMac }, () => withHome(async (home) => {
  const dir = join(home, ".kiro", "sessions", "cli");
  put(join(dir, "w-old.json"), kiroSession("/w"), 30);
  put(join(dir, "w-new.json"), kiroSession("/w", { pad: "a".repeat(Math.floor(1.1 * MiB)) }));
  put(join(dir, "x-old.json"), kiroSession("/x", { pad: "a".repeat(Math.floor(1.1 * MiB)) }), 60);
  put(join(dir, "x-new.json"), kiroSession("/x"), 10);
  const host = realHost(home);
  const ctx = createContextRefresher({ exec: host.exec, readTextFile: host.readTextFile, sleep: never });
  await ctx.refresh([agent("t1", "p1", "kiro"), agent("t2", "p2", "kiro")], [pane("p1", "/w"), pane("p2", "/x")]);
  assert.equal(ctx.value("t1"), null, "never the older, smaller session's percent");
  assert.equal(ctx.value("t2").percent, 40);
  assert.deepEqual(host.reads.filter((p) => statSync(p).size >= MiB), [], "a big file is never read");
}));

// Fix 3
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

beforeEach(() => {
  state.exec = async () => ({ code: 0, stdout: "", stderr: "" }); state.runs = []; state.shared = {};
});

test("fix3: after the retry chain ended with Usage off, rendering with Usage on again restarts it (once)", async () => {
  let asked = 0;
  const timers = [];
  hooks.knownAgents = async () => { asked++; throw new Error("down"); };
  state.shared["herdsidian.settings"] = { usageInStatus: true };
  const view = new Status(), cx = fakeCx();
  cx.timer.after = (ms, fn) => { const t = { ms, fn, live: true }; timers.push(t); return { cancel() { t.live = false; } }; };
  view.init({}, cx);
  await settle();
  state.shared["herdsidian.settings"] = { usageInStatus: false };
  const [t] = timers;
  t.live = false;
  t.fn();
  await settle();
  assert.equal(asked, 1);
  assert.equal(timers.filter((x) => x.live).length, 0, "the chain ended");
  state.shared["herdsidian.settings"] = { usageInStatus: true };
  view.render();
  await settle();
  assert.equal(asked, 2, "the lazy load in usageControl ran");
  assert.equal(timers.filter((x) => x.live).length, 1, "and scheduled the next retry");
  view.render();
  await settle();
  assert.equal(asked, 2, "no load while a retry timer is pending");
});

// Fix 4
test("fix4: the Codex script checks 1500 known files in one pass and reads only the changed one", { skip: !onMac }, () => withHome((home) => {
  const dir = join(home, ".codex", "sessions", "2026", "11", "10");
  mkdirSync(dir, { recursive: true });
  const meta = (cwd) => JSON.stringify({ type: "session_meta", payload: { cwd } });
  const tok = JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { total_tokens: 1000 }, model_context_window: 200000 } } });
  const paths = Array.from({ length: 1500 }, (_, i) => join(dir, `rollout ${i}.jsonl`));
  const t = new Date(Date.now() - 60000);
  for (const [i, p] of paths.entries()) { writeFileSync(p, `${meta(`/w/${i}`)}\n${tok}\n`); utimesSync(p, t, t); }
  const first = parseCodexScan(sh(home, CODEX_CONTEXT_SCRIPT).stdout);
  assert.equal(first.files.size, 1500);
  const known = [...first.files].map(([p, c]) => `${c.mtime} ${c.size} ${p}`);
  appendFileSync(paths[7], `${tok}\n`);
  utimesSync(paths[7], t, t);
  const started = Date.now();
  const r = sh(home, CODEX_CONTEXT_SCRIPT, known);
  const took = Date.now() - started;
  assert.equal(r.status, 0);
  assert.deepEqual(r.stdout.split("\n").filter((l) => l.startsWith('"cwd"')), ['"cwd":"/w/7"'], "only the changed file is read");
  const again = parseCodexScan(r.stdout, first.files);
  assert.equal(again.files.size, 1500);
  assert.equal(again.out.get("/w/1499").percent, 1, "known files keep their cached usage");
  assert.ok(took < 3000, `took ${took} ms`);
}));

// Fix 5
test("fix5: a task that never settles is dropped after three refreshes, so a new one can start", async () => {
  let lists = 0;
  const exec = async () => { lists += 1; return { code: 0, stdout: `dir /k\n${Math.floor(Date.now() / 1000)} 100 /k/a.json\n`, stderr: "" }; };
  const ctx = createContextRefresher({ exec, readTextFile: never, sleep: async () => {} });
  const run = () => ctx.refresh([agent("t1", "p1", "kiro")], [pane("p1", "/w")]);
  await run();
  assert.equal(lists, 1);
  await run();
  await run();
  assert.equal(lists, 1, "still running: not started again");
  await run();
  assert.equal(lists, 2, "dropped and started again");
  assert.equal(ctx.running, false);
});

// Fixes 6 and 7
test("fix6: the Grok hook's cost comment counts the six payload numbers", () => {
  const text = readFileSync(new URL("../scripts/grok-status-line.sh", import.meta.url), "utf8");
  assert.doesNotMatch(text, /\beight\b/);
  assert.match(text, /\bsix\b[^\n]*numbers?/);
});

test("fix7: README and RECIPE describe the Claude walk and the Kiro skipped count", () => {
  for (const name of ["README.md", "RECIPE.md"]) {
    const text = readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /newest session log/, name);
    assert.match(text, /up to 5/, name);
    assert.match(text, /interactive/, name);
    assert.match(text, /\[1m\]/, name);
    assert.match(text, /skipped/, name);
  }
});
