// Codex context, hybrid cache (finding 7): still one exec. The script takes "<mtimeSec> <size> <path>"
// args for the files already known; for those it prints only the header and a "## <size> <path>"
// marker, and the parser fills in the cwd and last usage from the refresher's cache.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODEX_CONTEXT_SCRIPT, createContextRefresher, parseCodexContext, parseCodexScan } from "../mods/guide-agents/agent-context.js";

const onMac = process.platform === "darwin";
const never = () => new Promise(() => {});
const agent = (address, pane, key) => ({ address, pane, status: "idle", program: { key, name: key } });
const pane = (id, cwd) => ({ pane: id, cwd, terminal: `term-${id}` });

const meta = (cwd) => JSON.stringify({ type: "session_meta", payload: { cwd, base_instructions: { text: "SECRET-MARKER" } } });
const tokens = (total, window) => JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { total_tokens: total }, model_context_window: window } } });

test("codex cache: the script skips head and tail for a known unchanged file and still reads a changed one", { skip: !onMac }, () => {
  const home = mkdtempSync(join(tmpdir(), "codex-cache-"));
  try {
    const a = join(home, ".codex", "sessions", "2026", "11", "10", "a.jsonl");
    const b = join(home, ".codex", "sessions", "2026", "11", "10", "b.jsonl");
    mkdirSync(join(a, ".."), { recursive: true });
    writeFileSync(a, [meta("/w/a"), tokens(1000, 200000)].join("\n") + "\n");
    writeFileSync(b, [meta("/w/b"), tokens(2000, 200000)].join("\n") + "\n");
    const t = new Date(Date.now() - 60000);
    utimesSync(a, t, t);
    utimesSync(b, t, t);
    const known = (p) => `${Math.floor(statSync(p).mtimeMs / 1000)} ${statSync(p).size} ${p}`;
    const run = (args) => spawnSync("/bin/sh", ["-c", CODEX_CONTEXT_SCRIPT, "sh", ...args], { env: { PATH: "/usr/bin:/bin", HOME: home }, encoding: "utf8" }).stdout;
    const out = run([known(a), `1 1 ${b}`]);
    assert.ok(out.includes(`## ${statSync(a).size} ${a}`), out);
    assert.ok(!out.includes('"cwd":"/w/a"'), "unchanged file: no head read");
    assert.ok(out.includes('"cwd":"/w/b"'), "changed file: read");
    assert.ok(out.includes('"model_context_window":200000'));
    assert.ok(!out.includes("SECRET-MARKER"));
    assert.ok(run([]).includes('"cwd":"/w/a"'), "no args: everything is read");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

const FULL = (path, size, mtime, cwd, total) => `@@ ${mtime}\n## ${size} ${path}\n"cwd":${JSON.stringify(cwd)}\n"last_token_usage":{"total_tokens":${total}}\n"model_context_window":200000\n`;
const MARKER = (path, size, mtime) => `@@ ${mtime}\n## ${size} ${path}\n`;

test("codex cache: a marker-only section takes the cwd and usage from the cache; a changed size does not", () => {
  const first = parseCodexScan(FULL("/s/a.jsonl", 10, 100, "/w", 20000), new Map());
  assert.equal(first.files.get("/s/a.jsonl").cwd, "/w");
  assert.equal(parseCodexContext(MARKER("/s/a.jsonl", 10, 100), first.files).get("/w").percent, 10);
  assert.equal(parseCodexContext(MARKER("/s/a.jsonl", 11, 100), first.files).get("/w") ?? null, null);
  assert.equal(parseCodexContext(MARKER("/s/a.jsonl", 10, 100)).get("/w") ?? null, null);
});

test("codex cache: the refresher sends known files as args, reuses them, and drops unlisted ones", async () => {
  const calls = [];
  const outs = [FULL("/s/a.jsonl", 10, 100, "/w", 20000), MARKER("/s/a.jsonl", 10, 100), "", MARKER("/s/a.jsonl", 10, 100)];
  const exec = async (_c, args) => {
    calls.push(args.slice(3));
    return { stdout: outs[calls.length - 1], stderr: "", code: 0 };
  };
  const ctx = createContextRefresher({ exec, readTextFile: never, sleep: never });
  const run = () => ctx.refresh([agent("t1", "p1", "codex")], [pane("p1", "/w")]);
  await run();
  assert.equal(ctx.value("t1").percent, 10);
  await run();
  assert.deepEqual(calls[1], ["100 10 /s/a.jsonl"]);
  assert.equal(ctx.value("t1").percent, 10);
  await run();
  assert.equal(ctx.value("t1"), null);
  await run();
  assert.deepEqual(calls[3], [], "a path no longer listed was dropped from the cache");
  assert.equal(ctx.value("t1"), null);
});
