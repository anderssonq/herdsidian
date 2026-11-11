// Review fixes for the context ring data: the 1M window from requestedModel, interactive-session
// choice by entrypoint, the kept value when the tail has no usage line, one shared limit sleep,
// no overlapping execs per program, and the shared helpers from agent-files.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_CONTEXT_SCRIPT, KIRO_CONTEXT_SCRIPT, createContextRefresher, parseClaudeContext } from "../mods/guide-agents/agent-context.js";
import * as files from "../mods/guide-agents/agent-files.js";

const onMac = process.platform === "darwin";
const never = () => new Promise(() => {});
const pick = (v) => (v ? { percent: v.percent, usedTokens: v.usedTokens, windowTokens: v.windowTokens } : v);

async function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), "agent-context-fix-"));
  try { return await fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
}
const put = (path, text, ageMin = 0) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  if (ageMin) { const t = new Date(Date.now() - ageMin * 60000); utimesSync(path, t, t); }
};
const sh = (home, script, args = []) => spawnSync("/bin/sh", ["-c", script, "sh", ...args], { env: { PATH: "/usr/bin:/bin", HOME: home }, encoding: "utf8" });
const agent = (address, pane, key) => ({ address, pane, status: "idle", program: { key, name: key } });
const pane = (id, cwd) => ({ pane: id, cwd, terminal: `term-${id}` });

const line = ({ entrypoint, requestedModel, input = 2, read = 130000, create = 3998 }) => JSON.stringify({
  parentUuid: "u0", isSidechain: false, ...(entrypoint ? { entrypoint } : {}), ...(requestedModel ? { requestedModel } : {}),
  message: { id: "m1", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: "SECRET-MARKER" }], usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: create, output_tokens: 5 } },
  type: "assistant", uuid: "u1",
});

// Finding 1
test("fix1: a requestedModel with [1m] gives the 1M window even when message.model is the API id", () => {
  const out = '@@ -w\n"model":"claude-opus-5-5"\n"requestedModel":"claude-opus-5-5[1m]"\n"input_tokens":2\n"cache_read_input_tokens":130000\n"cache_creation_input_tokens":3998\n';
  assert.deepEqual(pick(parseClaudeContext(out).get("-w")), { percent: 13, usedTokens: 134000, windowTokens: 1000000 });
  const plain = out.replace("[1m]", "");
  assert.equal(parseClaudeContext(plain).get("-w").windowTokens, 200000);
});

test("fix1: the script prints requestedModel", { skip: !onMac }, () => withHome((home) => {
  put(join(home, ".claude", "projects", "-w", "s.jsonl"), `${line({ entrypoint: "cli", requestedModel: "claude-opus-5-5[1m]" })}\n`);
  const r = sh(home, CLAUDE_CONTEXT_SCRIPT, ["-w"]);
  assert.equal(parseClaudeContext(r.stdout).get("-w").windowTokens, 1000000);
  assert.ok(!r.stdout.includes("SECRET-MARKER"));
}));

// Finding 3
test("fix3: an SDK run newer than the interactive session does not steal the ring", { skip: !onMac }, () => withHome((home) => {
  const dir = join(home, ".claude", "projects", "-w");
  put(join(dir, "pane.jsonl"), `${line({ entrypoint: "cli", read: 130000 })}\n`, 30);
  put(join(dir, "sdk.jsonl"), `${line({ entrypoint: "sdk-cli", read: 10000 })}\n`);
  put(join(dir, "desk.jsonl"), `${line({ entrypoint: "claude-desktop", read: 20000 })}\n`, 1);
  const m = parseClaudeContext(sh(home, CLAUDE_CONTEXT_SCRIPT, ["-w"]).stdout);
  assert.equal(m.get("-w").usedTokens, 134000);
}));

test("fix3: only non-interactive sessions give no value; more than 5 newer files are not walked", { skip: !onMac }, () => withHome((home) => {
  put(join(home, ".claude", "projects", "-w", "a.jsonl"), `${line({ entrypoint: "sdk-cli" })}\n`);
  assert.equal(parseClaudeContext(sh(home, CLAUDE_CONTEXT_SCRIPT, ["-w"]).stdout).get("-w") ?? null, null);
  const dir = join(home, ".claude", "projects", "-x");
  put(join(dir, "pane.jsonl"), `${line({ entrypoint: "cli" })}\n`, 60);
  for (let i = 0; i < 5; i++) put(join(dir, `sdk${i}.jsonl`), `${line({ entrypoint: "sdk-cli" })}\n`, i + 1);
  assert.equal(parseClaudeContext(sh(home, CLAUDE_CONTEXT_SCRIPT, ["-x"]).stdout).get("-x") ?? null, null);
}));

// Finding 4
test("fix4: the script prints the path of the newest file even when its tail has no usage line", { skip: !onMac }, () => withHome((home) => {
  const file = join(home, ".claude", "projects", "-w", "s.jsonl");
  put(file, `${line({ entrypoint: "cli" })}\n${JSON.stringify({ type: "user", message: { content: "SECRET-MARKER ".repeat(30000) } })}\n`);
  const r = sh(home, CLAUDE_CONTEXT_SCRIPT, ["-w"]);
  assert.ok(r.stdout.split("\n").includes(`## ${file}`), r.stdout);
  assert.ok(!r.stdout.includes("SECRET-MARKER"));
}));

const OUT = (path, tokens = true) => `@@ -w\n## ${path}\n${tokens ? '"model":"claude-opus-5-5"\n"input_tokens":2\n"cache_read_input_tokens":130000\n"cache_creation_input_tokens":3998\n' : ""}`;
const scripted = (outputs) => {
  let n = 0;
  return async () => ({ stdout: typeof outputs[n] === "function" ? outputs[n++]() : outputs[n++] ?? "", stderr: "", code: 0 });
};

test("fix4: the same newest file without a usage line keeps the last value; another file or none drops it", async () => {
  const exec = scripted([OUT("/p/a.jsonl"), OUT("/p/a.jsonl", false), OUT("/p/a.jsonl", false), OUT("/p/b.jsonl", false), OUT("/p/b.jsonl"), "@@ -w\n"]);
  const ctx = createContextRefresher({ exec, readTextFile: never, sleep: never });
  const run = () => ctx.refresh([agent("t1", "p1", "claude")], [pane("p1", "/w")]);
  await run();
  assert.equal(ctx.value("t1").usedTokens, 134000);
  await run();
  assert.equal(ctx.value("t1").usedTokens, 134000, "same file, no usage line: kept");
  await run();
  assert.equal(ctx.value("t1").usedTokens, 134000);
  await run();
  assert.equal(ctx.value("t1"), null, "a different file drops it");
  await run();
  assert.equal(ctx.value("t1").usedTokens, 134000);
  await run();
  assert.equal(ctx.value("t1"), null, "no file drops it");
});

// Finding 6
test("fix6: one limit sleep per refresh, shared by all programs", async () => {
  let sleeps = 0;
  const exec = async () => ({ stdout: "", stderr: "", code: 0 });
  const ctx = createContextRefresher({ exec, readTextFile: never, sleep: () => { sleeps += 1; return never(); } });
  await ctx.refresh([agent("t1", "p1", "claude"), agent("t2", "p2", "codex"), agent("t3", "p3", "kiro")], [pane("p1", "/a"), pane("p2", "/b"), pane("p3", "/c")]);
  assert.equal(sleeps, 1);
});

test("fix6: a program whose previous task is still running is not started again", async () => {
  const calls = { claude: 0, kiro: 0 };
  let release;
  const slow = new Promise((resolve) => { release = resolve; });
  const exec = async (_cmd, args) => {
    if (args[1] === CLAUDE_CONTEXT_SCRIPT) { calls.claude += 1; await slow; return { stdout: OUT("/p/a.jsonl"), stderr: "", code: 0 }; }
    if (args[1] === KIRO_CONTEXT_SCRIPT) calls.kiro += 1;
    return { stdout: "", stderr: "", code: 0 };
  };
  let sleeps = 0;
  const ctx = createContextRefresher({ exec, readTextFile: never, sleep: () => (++sleeps <= 2 ? Promise.resolve() : never()) });
  const agents = [agent("t1", "p1", "claude"), agent("t3", "p3", "kiro")];
  const panes = [pane("p1", "/w"), pane("p3", "/c")];
  await ctx.refresh(agents, panes);
  await ctx.refresh(agents, panes);
  assert.deepEqual(calls, { claude: 1, kiro: 2 });
  release();
  await new Promise((r) => setTimeout(r, 10));
  await ctx.refresh(agents, panes);
  assert.equal(calls.claude, 2, "started again once the first settled");
  assert.equal(ctx.value("t1").usedTokens, 134000);
});

// Finding 10
test("fix10: agent-files exports finite and object; agent-context keeps no copy of them", () => {
  assert.equal(files.finite(3), 3);
  assert.equal(files.finite("3"), null);
  assert.equal(files.finite(NaN), null);
  assert.deepEqual(files.object('{"a":1}'), { a: 1 });
  assert.equal(files.object("[1]"), null);
  const src = readFileSync(new URL("../mods/guide-agents/agent-context.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /const (finite|json)\s*=/);
  assert.match(src, /import\s*\{[^}]*\bfinite\b[^}]*\}\s*from\s*"\.\/agent-files\.js"/s);
});
