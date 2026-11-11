// Context window, sources and mapping (ACs 24-30): the four context scripts and parsers, the
// pane-to-session mapping and the refresher. Fixtures are strings and temp folders; the scripts
// run with HOME set to a temp folder, so no test reads a real agent folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLAUDE_CONTEXT_SCRIPT, CODEX_CONTEXT_SCRIPT, CONTEXT_KEYS, GROK_CONTEXT_SCRIPT, KIRO_CONTEXT_SCRIPT,
  claudeDir, contextTargets, createContextRefresher, grokContext, kiroContext, parseClaudeContext, parseCodexContext,
} from "../mods/guide-agents/agent-context.js";
import { parseGrokState, parseKiroSession } from "../mods/guide-agents/agent-files.js";

const onMac = process.platform === "darwin";
const never = () => new Promise(() => {});
const pick = (v) => (v ? { percent: v.percent, usedTokens: v.usedTokens, windowTokens: v.windowTokens } : v);

// A temp HOME, removed after `fn`.
async function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), "agent-context-"));
  try { return await fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
}
const put = (path, text, ageMin = 0) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  if (ageMin) { const t = new Date(Date.now() - ageMin * 60000); utimesSync(path, t, t); }
};
const sh = (home, script, args = []) => spawnSync("/bin/sh", ["-c", script, "sh", ...args], { env: { PATH: "/usr/bin:/bin", HOME: home }, encoding: "utf8" });

// The host's exec and readTextFile over the temp HOME. Every call and every path read is recorded.
function realHost(home) {
  const calls = [], reads = [];
  return {
    calls, reads,
    exec: async (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      const r = spawnSync(cmd, args, { env: { PATH: "/usr/bin:/bin", HOME: home }, encoding: "utf8" });
      return { stdout: r.stdout, stderr: r.stderr, code: r.status };
    },
    readTextFile: async (path) => {
      reads.push(path);
      assert.ok(path.startsWith(home), `read outside the temp home: ${path}`);
      return readFileSync(path, "utf8");
    },
  };
}
const agent = (address, pane, key) => ({ address, pane, status: "idle", program: { key, name: key } });
const pane = (id, cwd) => ({ pane: id, cwd, terminal: `term-${id}` });

// Claude Code transcript lines.
const assistant = ({ model = "claude-x", usage, sidechain = false, content = [{ type: "text", text: "hi" }] }) => JSON.stringify({
  parentUuid: "u0", isSidechain: sidechain, userType: "external", cwd: "/tmp/a b_c", sessionId: "s1",
  message: { id: "m1", type: "message", role: "assistant", model, content, usage }, type: "assistant", uuid: "u1",
});
const userLine = (text = "hello") => JSON.stringify({ parentUuid: null, isSidechain: false, type: "user", message: { role: "user", content: text } });
const usage = (input, read, create) => ({ input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: create, output_tokens: 50 });

test("the four program keys and the Claude folder rule", () => {
  assert.deepEqual(CONTEXT_KEYS, ["claude", "codex", "kiro", "grok"]);
  assert.equal(claudeDir("/tmp/a b_c"), "-tmp-a-b-c");
  assert.equal(claudeDir("/Software/add_ons/x.y"), "-Software-add-ons-x-y");
});

// AC 24
test("AC24: Claude: the last non-sidechain assistant usage gives 67 % of 200K; a later sidechain line is ignored", () => {
  const out = '@@ -tmp-a-b-c\n"model":"claude-x"\n"input_tokens":2\n"cache_read_input_tokens":130000\n"cache_creation_input_tokens":3998\n';
  assert.deepEqual(pick(parseClaudeContext(out).get("-tmp-a-b-c")), { percent: 67, usedTokens: 134000, windowTokens: 200000 });
  const big = '@@ -w\n"model":"claude-x"\n"input_tokens":50000\n"cache_read_input_tokens":200000\n"cache_creation_input_tokens":0\n';
  assert.deepEqual(pick(parseClaudeContext(big).get("-w")), { percent: 25, usedTokens: 250000, windowTokens: 1000000 });
  const oneM = '@@ -w\n"model":"claude-x[1m]"\n"input_tokens":100000\n"cache_read_input_tokens":0\n"cache_creation_input_tokens":0\n';
  assert.deepEqual(pick(parseClaudeContext(oneM).get("-w")), { percent: 10, usedTokens: 100000, windowTokens: 1000000 });
});

test("AC24: Claude: the model is the first match and the token fields the last", () => {
  const out = '@@ -w\n"model":"claude-x[1m]"\n"input_tokens":999999\n"model":"tool-model"\n"input_tokens":2\n"cache_read_input_tokens":130000\n"cache_creation_input_tokens":3998\n';
  assert.deepEqual(pick(parseClaudeContext(out).get("-w")), { percent: 13, usedTokens: 134000, windowTokens: 1000000 });
});

test("AC24: Claude: the script over a temp home reads the newest session of the folder", { skip: !onMac }, () => withHome((home) => {
  const dir = join(home, ".claude", "projects", "-tmp-a-b-c");
  put(join(dir, "old.jsonl"), `${assistant({ usage: usage(1, 1, 1) })}\n`, 60);
  const toolUse = [{ type: "text", text: "hi" }, { type: "tool_use", id: "x", name: "Task", input: { model: "tool-model", input_tokens: 999999 } }];
  put(join(dir, "new.jsonl"), [
    userLine(),
    assistant({ usage: usage(2, 130000, 3998), content: toolUse }),
    assistant({ usage: usage(9, 190000, 9000), sidechain: true }),
    userLine("after"),
  ].join("\n") + "\n");
  put(join(home, ".claude", "projects", "-w2", "s.jsonl"), `${assistant({ usage: usage(50000, 200000, 0) })}\n`);
  const r = sh(home, CLAUDE_CONTEXT_SCRIPT, ["-tmp-a-b-c", "-w2", "-none"]);
  assert.equal(r.status, 0);
  const m = parseClaudeContext(r.stdout);
  assert.deepEqual(pick(m.get("-tmp-a-b-c")), { percent: 67, usedTokens: 134000, windowTokens: 200000 });
  assert.deepEqual(pick(m.get("-w2")), { percent: 25, usedTokens: 250000, windowTokens: 1000000 });
  assert.equal(m.get("-none") ?? null, null);
}));

// AC 25
test("AC25: Claude: a 2 MiB file with the usage line in its last 256 KiB is read; one without has no value", { skip: !onMac }, () => withHome((home) => {
  const pad = userLine("x".repeat(1000));
  const lines = (n) => Array.from({ length: n }, () => pad);
  const secret = [{ type: "text", text: "SECRET-MARKER in the reply" }];
  put(join(home, ".claude", "projects", "-big", "s.jsonl"), [...lines(2100), assistant({ usage: usage(2, 130000, 3998), content: secret }), userLine("SECRET-MARKER")].join("\n") + "\n");
  put(join(home, ".claude", "projects", "-early", "s.jsonl"), [assistant({ usage: usage(2, 130000, 3998) }), ...lines(300)].join("\n") + "\n");
  const r = sh(home, CLAUDE_CONTEXT_SCRIPT, ["-big", "-early"]);
  const m = parseClaudeContext(r.stdout);
  assert.deepEqual(pick(m.get("-big")), { percent: 67, usedTokens: 134000, windowTokens: 200000 });
  assert.equal(m.get("-early") ?? null, null);
  assert.ok(!r.stdout.includes("SECRET-MARKER"), r.stdout);
  assert.ok(!r.stdout.includes("x".repeat(50)));
}));

test("AC25: the refresher keeps no message text: no SECRET-MARKER in any value", { skip: !onMac }, () => withHome(async (home) => {
  const secret = [{ type: "text", text: "SECRET-MARKER" }];
  put(join(home, ".claude", "projects", "-w", "s.jsonl"), `${assistant({ model: "claude-x", usage: usage(2, 130000, 3998), content: secret })}\n`);
  const host = realHost(home);
  const ctx = createContextRefresher({ exec: host.exec, readTextFile: host.readTextFile, sleep: never });
  await ctx.refresh([agent("t1", "p1", "claude")], [pane("p1", "/w")]);
  const v = ctx.value("t1");
  assert.deepEqual(pick(v), { percent: 67, usedTokens: 134000, windowTokens: 200000 });
  assert.ok(!JSON.stringify(v).includes("SECRET-MARKER"));
  assert.deepEqual(host.reads, [], "readTextFile is never used on a .jsonl");
}));

// AC 26
const codexMeta = (cwd) => JSON.stringify({
  timestamp: "2026-11-10T10:00:00Z", type: "session_meta",
  payload: { id: "c1", timestamp: "2026-11-10T10:00:00Z", cwd, originator: "codex_cli_rs", cli_version: "0.50.0", base_instructions: { text: 'Say "cwd":"/fake" SECRET-MARKER' } },
});
const tokenCount = (total, window) => JSON.stringify({
  timestamp: "2026-11-10T10:01:00Z", type: "event_msg",
  payload: { type: "token_count", info: { total_token_usage: { input_tokens: 9, total_tokens: 999999 }, last_token_usage: { input_tokens: total - 100, cached_input_tokens: 0, output_tokens: 100, reasoning_output_tokens: 0, total_tokens: total }, model_context_window: window }, rate_limits: null },
});
const codexText = JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "SECRET-MARKER" }] } });
const codexNoInfo = JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: null } });

test("AC26: Codex: the newest token_count line of the matching folder; the newest file per folder wins", () => {
  const out = [
    "@@ 1762790000", '"cwd":"/w/one two"', '"last_token_usage":{"input_tokens":1,"total_tokens":1000}', '"model_context_window":258400',
    "@@ 1762790100", '"cwd":"/w/one two"', '"last_token_usage":{"input_tokens":35233,"cached_input_tokens":0,"total_tokens":35333}', '"model_context_window":258400',
    "@@ 1762790050", '"cwd":"/w/q\\"d"', '"last_token_usage":{"total_tokens":5000}', '"model_context_window":100000',
    "",
  ].join("\n");
  const m = parseCodexContext(out);
  assert.deepEqual(pick(m.get("/w/one two")), { percent: 14, usedTokens: 35333, windowTokens: 258400 });
  assert.deepEqual(pick(m.get('/w/q"d')), { percent: 5, usedTokens: 5000, windowTokens: 100000 });
});

test("AC26: Codex: a window of 0 or a missing token line gives no value", () => {
  const out = ["@@ 1", '"cwd":"/a"', '"last_token_usage":{"total_tokens":5}', '"model_context_window":0', "@@ 2", '"cwd":"/b"', ""].join("\n");
  const m = parseCodexContext(out);
  assert.equal(m.get("/a") ?? null, null);
  assert.equal(m.get("/b") ?? null, null);
});

test("AC26: Codex: the script over a temp home; the 24-hour filter drops an older file", { skip: !onMac }, () => withHome((home) => {
  const day = join(home, ".codex", "sessions", "2026", "11", "10");
  put(join(day, "rollout-a.jsonl"), [codexMeta("/w/one two"), tokenCount(1000, 258400), codexText, tokenCount(35333, 258400), codexNoInfo].join("\n") + "\n");
  put(join(day, "rollout-b.jsonl"), [codexMeta("/w/two"), tokenCount(20000, 200000)].join("\n") + "\n");
  put(join(home, ".codex", "sessions", "2026", "11", "07", "rollout-c.jsonl"), [codexMeta("/w/three"), tokenCount(9000, 200000)].join("\n") + "\n", 3 * 1440);
  const r = sh(home, CODEX_CONTEXT_SCRIPT);
  assert.equal(r.status, 0);
  assert.ok(!r.stdout.includes("SECRET-MARKER"), r.stdout);
  const m = parseCodexContext(r.stdout);
  assert.deepEqual(pick(m.get("/w/one two")), { percent: 14, usedTokens: 35333, windowTokens: 258400 });
  assert.deepEqual(pick(m.get("/w/two")), { percent: 10, usedTokens: 20000, windowTokens: 200000 });
  assert.equal(m.get("/w/three") ?? null, null);
  assert.equal(m.get("/fake") ?? null, null);
}));

// AC 27
const kiroSession = (cwd, rts, last) => JSON.stringify({
  session_id: "k1", cwd, title: "Secret title", updated_at: "2026-11-10T10:00:00Z",
  session_state: { conversation_metadata: { user_turn_metadatas: [], ...(last === undefined ? {} : { last_context_usage: { percentage: last } }) }, rts_model_state: rts },
});

test("AC27: Kiro: 12.763 % of 200,000 gives 13 %, 25,526 tokens; only last_context_usage gives the same percent", () => {
  const full = kiroContext(parseKiroSession(kiroSession("/w", { context_usage_percentage: 12.763, model_info: { context_window_tokens: 200000 } })));
  assert.deepEqual(pick(full), { percent: 13, usedTokens: 25526, windowTokens: 200000 });
  const fallback = kiroContext(parseKiroSession(kiroSession("/w", {}, 12.763)));
  assert.equal(fallback.percent, 13);
  assert.equal(kiroContext(parseKiroSession(kiroSession("/w", {}))), null);
});

test("AC27: Kiro: the script and the refresher read <kiro>/sessions/cli/*.json of the pane's folder only", { skip: !onMac }, () => withHome(async (home) => {
  const cli = join(home, ".kiro", "sessions", "cli");
  put(join(cli, "k1.json"), kiroSession("/w", { context_usage_percentage: 12.763, model_info: { context_window_tokens: 200000 } }));
  put(join(cli, "k2.json"), kiroSession("/other", { context_usage_percentage: 50, model_info: { context_window_tokens: 200000 } }));
  put(join(cli, "k1.jsonl"), "SECRET-MARKER\n");
  assert.match(sh(home, KIRO_CONTEXT_SCRIPT).stdout, /k1\.json\n/);
  const host = realHost(home);
  const ctx = createContextRefresher({ exec: host.exec, readTextFile: host.readTextFile, sleep: never });
  await ctx.refresh([agent("t1", "p1", "kiro")], [pane("p1", "/w")]);
  assert.deepEqual(pick(ctx.value("t1")), { percent: 13, usedTokens: 25526, windowTokens: 200000 });
  assert.ok(host.reads.every((p) => p.startsWith(join(cli, "/")) && p.endsWith(".json")), host.reads.join(", "));
  // A second refresh with the same mtimes reads nothing again.
  const before = host.reads.length;
  await ctx.refresh([agent("t1", "p1", "kiro")], [pane("p1", "/w")]);
  assert.equal(host.reads.length, before);
  assert.equal(ctx.value("t1").percent, 13);
}));

// AC 28
const grokFile = (over = {}) => JSON.stringify({
  v: 1, session_id: "g1", cwd: "/w", model: "grok-4", updated_at: Date.now(), cost_usd: 1.23,
  context_window_size: 256000, context_tokens: 30720, used_percentage: 12, session_input_tokens: 900000, session_output_tokens: 34567, ...over,
});

test("AC28: Grok: used_percentage 12 with 30,720 of 256,000 tokens", () => {
  assert.deepEqual(pick(grokContext(parseGrokState(grokFile()), Date.now())), { percent: 12, usedTokens: 30720, windowTokens: 256000 });
  assert.deepEqual(pick(grokContext(parseGrokState(grokFile({ used_percentage: null })), Date.now())), { percent: 12, usedTokens: 30720, windowTokens: 256000 });
});

test("AC28: Grok: the script and the refresher read the hook's state files", { skip: !onMac }, () => withHome(async (home) => {
  const dir = join(home, ".local", "state", "herdsidian", "grok");
  put(join(dir, "g1.json"), grokFile());
  assert.match(sh(home, GROK_CONTEXT_SCRIPT).stdout, /g1\.json\n/);
  const host = realHost(home);
  const ctx = createContextRefresher({ exec: host.exec, readTextFile: host.readTextFile, sleep: never });
  await ctx.refresh([agent("t1", "p1", "grok")], [pane("p1", "/w")]);
  assert.deepEqual(pick(ctx.value("t1")), { percent: 12, usedTokens: 30720, windowTokens: 256000 });
  assert.ok(host.reads.every((p) => p.startsWith(join(dir, "/")) && p.endsWith(".json")));
}));

// AC 29
const CLAUDE_OUT = (dir) => `@@ ${dir}\n"model":"claude-x"\n"input_tokens":20000\n"cache_read_input_tokens":0\n"cache_creation_input_tokens":0\n`;
const CODEX_OUT = '@@ 1762790000\n"cwd":"/w"\n"last_token_usage":{"total_tokens":25840}\n"model_context_window":258400\n';
const fakeHost = (answers) => {
  const calls = [], reads = [];
  return {
    calls, reads,
    exec: async (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      const a = answers[args[1]];
      return typeof a === "function" ? a(args) : { stdout: a ?? "", stderr: "", code: 0 };
    },
    readTextFile: async (path) => { reads.push(path); throw new Error(`no file ${path}`); },
  };
};

test("AC29: two Claude agents in the same folder get no value; a Claude and a Codex agent in one folder both do", async () => {
  const targets = contextTargets([agent("t1", "p1", "claude"), agent("t2", "p2", "claude")], [pane("p1", "/w"), pane("p2", "/w")]);
  assert.equal(targets.size, 0);
  const mixed = contextTargets([agent("t1", "p1", "claude"), agent("t2", "p2", "codex")], [pane("p1", "/w"), pane("p2", "/w")]);
  assert.deepEqual([...mixed.entries()], [["t1", { key: "claude", cwd: "/w" }], ["t2", { key: "codex", cwd: "/w" }]]);

  const host = fakeHost({ [CLAUDE_CONTEXT_SCRIPT]: CLAUDE_OUT("-w"), [CODEX_CONTEXT_SCRIPT]: CODEX_OUT });
  const ctx = createContextRefresher({ exec: host.exec, readTextFile: host.readTextFile, sleep: never });
  await ctx.refresh([agent("t1", "p1", "claude"), agent("t2", "p2", "claude")], [pane("p1", "/w"), pane("p2", "/w")]);
  assert.equal(ctx.value("t1"), null);
  assert.equal(ctx.value("t2"), null);
  assert.equal(host.calls.length, 0);
  await ctx.refresh([agent("t1", "p1", "claude"), agent("t2", "p2", "codex")], [pane("p1", "/w"), pane("p2", "/w")]);
  assert.equal(ctx.value("t1").percent, 10);
  assert.equal(ctx.value("t2").percent, 10);
});

// AC 30
test("AC30: a null cwd, a missing pane, a remote address and opencode give no target and no exec", async () => {
  const list = [agent("t1", "p1", "claude"), agent("t2", "p9", "claude"), agent("vps/t3", "p3", "claude"), agent("t4", "p4", "opencode"), { address: "t5", pane: "p5", status: "idle", program: null }];
  const panes = [pane("p1", null), pane("p3", "/w"), pane("p4", "/w"), pane("p5", "/w")];
  assert.equal(contextTargets(list, panes).size, 0);
  const host = fakeHost({ [CLAUDE_CONTEXT_SCRIPT]: CLAUDE_OUT("-w") });
  const ctx = createContextRefresher({ exec: host.exec, readTextFile: host.readTextFile, sleep: never });
  await ctx.refresh(list, panes);
  assert.equal(host.calls.length, 0);
  for (const a of list) assert.equal(ctx.value(a.address), null, a.address);
});

test("AC30: a Grok state file updated over 24 h ago gives no value", () => {
  const now = Date.now();
  assert.equal(grokContext(parseGrokState(grokFile({ updated_at: now - 86400000 - 1000 })), now), null);
});

test("AC30: Claude and Kiro session files modified over 24 h ago are not listed", { skip: !onMac }, () => withHome((home) => {
  put(join(home, ".claude", "projects", "-w", "s.jsonl"), `${assistant({ usage: usage(2, 130000, 3998) })}\n`, 25 * 60);
  assert.equal(parseClaudeContext(sh(home, CLAUDE_CONTEXT_SCRIPT, ["-w"]).stdout).get("-w") ?? null, null);
  put(join(home, ".kiro", "sessions", "cli", "k.json"), kiroSession("/w", { context_usage_percentage: 5 }), 25 * 60);
  assert.doesNotMatch(sh(home, KIRO_CONTEXT_SCRIPT).stdout, /k\.json/);
}));

test("the scripts are read-only: no write, network, delete or agent CLI", () => {
  for (const s of [CLAUDE_CONTEXT_SCRIPT, CODEX_CONTEXT_SCRIPT, KIRO_CONTEXT_SCRIPT, GROK_CONTEXT_SCRIPT]) {
    const text = s.replace(/2?>\s*\/dev\/null/g, "");
    assert.ok(!/>/.test(text), text);
    assert.ok(!/\b(rm|mv|cp|tee|curl|wget|kiro-cli|python|node)\b|http/.test(text), text);
    assert.match(s, /tail -c 262144|list_json/);
  }
});
