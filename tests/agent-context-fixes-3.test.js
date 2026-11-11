// Third review round for the context ring: a failing big-Kiro-cwd script costs only those files'
// folders, a dropped task that settles late writes no shared cache, the Claude scan keeps one path,
// and isReadable is one shared helper.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KIRO_BIG_CWD_SCRIPT, KIRO_CONTEXT_SCRIPT, CLAUDE_CONTEXT_SCRIPT, createContextRefresher, parseClaudeScan } from "../mods/guide-agents/agent-context.js";
import * as files from "../lib/agent-files.js";
import { settle } from "./support/mod-stubs.js";

const agent = (address, pane, key) => ({ address, pane, status: "idle", program: { key, name: key } });
const pane = (id, cwd) => ({ pane: id, cwd, terminal: `term-${id}` });
const kiroJson = JSON.stringify({ cwd: "/w", updated_at: "2026-11-10T10:00:00Z", session_state: { rts_model_state: { context_usage_percentage: 40 } } });

for (const [name, failBig] of [
  ["exits non-zero", async () => ({ code: 1, stdout: "", stderr: "boom" })],
  ["rejects", async () => { throw new Error("exec failed"); }],
]) {
  test(`item1: the big-cwd script ${name}: the other Kiro folders keep their value`, async () => {
    const at = Math.floor(Date.now() / 1000);
    const exec = async (cmd, args) => {
      if (args[1] === KIRO_BIG_CWD_SCRIPT) return failBig();
      assert.equal(args[1], KIRO_CONTEXT_SCRIPT);
      return { code: 0, stdout: `dir /k\n${at} 2000000 /k/big.json\n${at} 100 /k/small.json\n`, stderr: "" };
    };
    const ctx = createContextRefresher({ exec, readTextFile: async () => kiroJson, sleep: () => new Promise(() => {}) });
    await ctx.refresh([agent("t1", "p1", "kiro")], [pane("p1", "/w")]);
    assert.equal(ctx.value("t1")?.percent, 40);
  });
}

test("item2: a replaced Claude task that settles late does not change claudeKept", async () => {
  const out = (tokens) => `@@ -w\n## /p/b.jsonl\n${tokens === null ? "" : `"input_tokens":${tokens}\n`}`;
  let calls = 0;
  let release;
  const held = new Promise((r) => { release = r; });
  const exec = async (cmd, args) => {
    assert.equal(args[1], CLAUDE_CONTEXT_SCRIPT);
    calls += 1;
    if (calls === 1) { await held; return { code: 0, stdout: out(20000), stderr: "" }; }
    return { code: 0, stdout: calls === 2 ? out(100000) : out(null), stderr: "" };
  };
  let fast = true;
  const sleep = () => (fast ? Promise.resolve() : new Promise(() => {}));
  const ctx = createContextRefresher({ exec, readTextFile: async () => "", sleep });
  const run = () => ctx.refresh([agent("t1", "p1", "claude")], [pane("p1", "/w")]);
  await run();
  await run();
  await run();
  await run();
  await settle();
  assert.equal(calls, 2, "the stuck task was dropped and a new one ran");
  release();
  await settle();
  fast = false;
  await run();
  assert.equal(calls, 3);
  assert.equal(ctx.value("t1")?.percent, 50, "kept value is the new task's, not the late one's 10 %");
});

test("item3: parseClaudeScan gives a single path string or null, not a list", () => {
  const scan = parseClaudeScan('@@ -w\n## /p/a.jsonl\n"input_tokens":2000\n@@ -x\n');
  assert.equal(scan.get("-w").path, "/p/a.jsonl");
  assert.equal(scan.get("-x").path, null);
  assert.equal("paths" in scan.get("-w"), false);
});

test("item4: isReadable is true only below MAX_READ_BYTES and the copies are identical", () => {
  assert.equal(files.isReadable({ size: files.MAX_READ_BYTES - 1 }), true);
  assert.equal(files.isReadable({ size: files.MAX_READ_BYTES }), false);
  const lib = readFileSync(new URL("../lib/agent-files.js", import.meta.url), "utf8");
  for (const mod of ["guide-agents", "herdsidian-status"]) {
    assert.equal(readFileSync(new URL(`../mods/${mod}/agent-files.js`, import.meta.url), "utf8"), lib, mod);
  }
});
