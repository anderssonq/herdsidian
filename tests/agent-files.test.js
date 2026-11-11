// Shared agent-file helpers: the <kiro> folder rule, the one listing script, and the
// Kiro session and Grok hook-file parsers (pure; fixtures are strings and temp folders).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIRO_DIR_FN, LIST_JSON_FN, MAX_READ_BYTES, STATE_DIR_SH, formatTokens, parseGrokState, parseKiroSession, parseListing,
} from "../lib/agent-files.js";

const onMac = process.platform === "darwin";
const sh = (script, env) => spawnSync("/bin/sh", ["-c", script], { env: { PATH: "/usr/bin:/bin", ...env }, encoding: "utf8" });

test("constants: the read limit is 1 MiB and the state folder follows ADR-0002", () => {
  assert.equal(MAX_READ_BYTES, 1048576);
  assert.equal(STATE_DIR_SH, "${XDG_STATE_HOME:-$HOME/.local/state}/herdsidian");
});

// AC 7: KIRO_HOME rule.
const kiro = (home, kiroHome) => sh(`${KIRO_DIR_FN}\nkiro_dir`, kiroHome === undefined ? { HOME: home } : { HOME: home, KIRO_HOME: kiroHome });

test("kiro_dir: an absolute KIRO_HOME is used, one trailing slash dropped", () => {
  assert.equal(kiro("/h/me", "/data/kiro").stdout, "/data/kiro");
  assert.equal(kiro("/h/me", "/data/kiro/").stdout, "/data/kiro");
});

test("kiro_dir: a folder inside $HOME is allowed, and a sibling that only shares a prefix is not a parent", () => {
  assert.equal(kiro("/h/me", "/h/me/cfg").stdout, "/h/me/cfg");
  assert.equal(kiro("/h/ab", "/h/a").stdout, "/h/a");
});

test("kiro_dir: unset, empty, relative, / and //: $HOME/.kiro", () => {
  for (const v of [undefined, "", "rel/dir", ".", "/", "//"]) assert.equal(kiro("/h/me", v).stdout, "/h/me/.kiro", JSON.stringify(v));
});

test("kiro_dir: $HOME itself and every parent of $HOME: $HOME/.kiro", () => {
  for (const v of ["/h/me", "/h/me/", "/h"]) assert.equal(kiro("/h/me", v).stdout, "/h/me/.kiro", v);
});

test("kiro_dir: prints nothing on stderr and writes nothing", () => {
  assert.equal(kiro("/h/me", "/x").stderr, "");
  assert.ok(!/[>]|\brm\b|\bmv\b|\btee\b|kiro-cli|curl|http/.test(KIRO_DIR_FN.replace(/>\s*\/dev\/null/g, "")));
});

// AC 8 / 16: the listing script is read-only.
test("list_json: contains no write, network or CLI call; redirection only to /dev/null", () => {
  const text = LIST_JSON_FN.replace(/2?>\s*\/dev\/null/g, "");
  assert.ok(!/>/.test(text), text);
  assert.ok(!/\b(rm|mv|tee|curl|kiro-cli|grok)\b|http/.test(text), text);
});

const listing = (dir, minutes) => sh(`${LIST_JSON_FN}\nlist_json '${dir}' ${minutes ?? ""}`, {});

test("list_json: a missing folder prints nodir", { skip: !onMac }, () => {
  assert.equal(listing(join(tmpdir(), "herdsidian-no-such-folder")).stdout, "nodir\n");
});

test("list_json: lists top-level *.json with mtime, size and absolute path; skips others", { skip: !onMac }, () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-files-"));
  try {
    writeFileSync(join(dir, "a b.json"), "12345");
    writeFileSync(join(dir, "t.jsonl"), "x");
    writeFileSync(join(dir, ".hidden.tmp"), "x");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "deep.json"), "x");
    utimesSync(join(dir, "a b.json"), new Date(1762790000000), new Date(1762790000000));
    const r = listing(dir);
    const lines = r.stdout.split("\n").filter(Boolean);
    assert.equal(lines[0], `dir ${dir}`);
    assert.equal(lines.length, 2);
    assert.match(lines[1], /^1762790000 5 \/.*\/a b\.json$/);
    assert.equal(r.stderr, "");
    assert.deepEqual(parseListing(r.stdout).files.map((f) => [f.mtimeMs, f.size]), [[1762790000000, 5]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("list_json: an empty folder prints only the dir line", { skip: !onMac }, () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-files-"));
  try {
    assert.equal(listing(dir).stdout, `dir ${dir}\n`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("list_json: minutes keeps only files modified inside that window", { skip: !onMac }, () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-files-"));
  try {
    const put = (name, ageMin) => {
      writeFileSync(join(dir, name), "{}");
      const t = new Date(Date.now() - ageMin * 60000);
      utimesSync(join(dir, name), t, t);
    };
    put("new.json", 10);
    put("old.json", 3000);
    const names = (min) => parseListing(listing(dir, min).stdout).files.map((f) => f.path.split("/").pop()).sort();
    assert.deepEqual(names(1440), ["new.json"]);
    assert.deepEqual(names(), ["new.json", "old.json"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseListing: nodir, dir lines, bad lines dropped, paths with spaces kept", () => {
  assert.deepEqual(parseListing("nodir\n"), { dir: null, files: [] });
  assert.deepEqual(parseListing(""), { dir: null, files: [] });
  const out = ["dir /k/sessions/cli", "1762790000 5 /k/sessions/cli/a b.json", "junk", "x 5 /k/a.json", "1762790001 y /k/b.json", "1762790002 7 relative.json", ""].join("\n");
  assert.deepEqual(parseListing(out), { dir: "/k/sessions/cli", files: [{ path: "/k/sessions/cli/a b.json", mtimeMs: 1762790000000, size: 5 }] });
});

// parseKiroSession
const session = (over = {}) => JSON.stringify({
  session_id: "s1", cwd: "/w", created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-05T12:00:00Z", title: "Secret title",
  session_state: {
    conversation_metadata: {
      user_turn_metadatas: [
        { end_timestamp: "2026-11-05T11:00:00Z", metering_usage: [{ value: 1.25, unit: "credit", unitPlural: "credits" }, { value: 0.1, unit: "credit" }] },
        { end_timestamp: "2026-11-05T12:00:00Z", metering_usage: [{ value: 2, unit: "credit" }] },
      ],
      last_context_usage: { percentage: 7.5 },
    },
    rts_model_state: { context_usage_percentage: 12.763, model_info: { context_window_tokens: 200000 } },
  },
  ...over,
});

test("parseKiroSession: cwd, updatedAt, turns with summed credits, context", () => {
  const s = parseKiroSession(session());
  assert.equal(s.cwd, "/w");
  assert.equal(s.updatedAt, Date.parse("2026-11-05T12:00:00Z"));
  assert.deepEqual(s.turns, [{ endMs: Date.parse("2026-11-05T11:00:00Z"), credits: 1.35 }, { endMs: Date.parse("2026-11-05T12:00:00Z"), credits: 2 }]);
  assert.deepEqual(s.context, { percent: 12.763, windowTokens: 200000 });
});

test("parseKiroSession: only finite credit values count; other units and bad values are ignored", () => {
  const turn = { end_timestamp: "2026-11-05T11:00:00Z", metering_usage: [{ value: 1, unit: "credit" }, { value: 5, unit: "token" }, { value: "2", unit: "credit" }, { value: null, unit: "credit" }, { value: 0.5, unit: "credit" }] };
  const s = parseKiroSession(JSON.stringify({ session_state: { conversation_metadata: { user_turn_metadatas: [turn] } } }));
  assert.deepEqual(s.turns, [{ endMs: Date.parse("2026-11-05T11:00:00Z"), credits: 1.5 }]);
});

test("parseKiroSession: a missing or bad end_timestamp gives endMs null; no metering gives 0 credits", () => {
  const s = parseKiroSession(JSON.stringify({ session_state: { conversation_metadata: { user_turn_metadatas: [{ metering_usage: [{ value: 0.5, unit: "credit" }] }, { end_timestamp: "nope" }] } } }));
  assert.deepEqual(s.turns, [{ endMs: null, credits: 0.5 }, { endMs: null, credits: 0 }]);
});

test("parseKiroSession: percent falls back to last_context_usage.percentage; window may be null", () => {
  const s = parseKiroSession(JSON.stringify({ cwd: "/w", session_state: { conversation_metadata: { last_context_usage: { percentage: 12.763 } } } }));
  assert.deepEqual(s.context, { percent: 12.763, windowTokens: null });
});

test("parseKiroSession: no percent anywhere gives context null; a session with no turns has turns []", () => {
  const s = parseKiroSession(JSON.stringify({ session_id: "x" }));
  assert.equal(s.context, null);
  assert.deepEqual(s.turns, []);
  assert.equal(s.cwd, null);
  assert.equal(s.updatedAt, null);
});

test("parseKiroSession: bad updated_at and non-string cwd give null", () => {
  const s = parseKiroSession(JSON.stringify({ cwd: 5, updated_at: "yesterday" }));
  assert.equal(s.cwd, null);
  assert.equal(s.updatedAt, null);
});

test("parseKiroSession: not JSON, not an object: null", () => {
  for (const t of ["", "nope", "[]", "5", "null", '"s"', undefined, null]) assert.equal(parseKiroSession(t), null, String(t));
});

test("parseKiroSession: the title and every other field are never copied", () => {
  const s = parseKiroSession(session());
  assert.deepEqual(Object.keys(s).sort(), ["context", "cwd", "turns", "updatedAt"]);
  assert.ok(!JSON.stringify(s).includes("Secret title"));
});

// parseGrokState
const GROK = { v: 1, session_id: "g1", cwd: "/w", model: "grok-4", updated_at: 1762790000000, cost_usd: 1.23, context_window_size: 256000, context_tokens: 30720, used_percentage: 12, session_input_tokens: 900000, session_output_tokens: 34567 };
const GROK_KEYS = Object.keys(GROK).sort();

test("parseGrokState: a valid file gives exactly the 11 keys", () => {
  const s = parseGrokState(JSON.stringify(GROK));
  assert.deepEqual(s, GROK);
  assert.deepEqual(Object.keys(s).sort(), GROK_KEYS);
});

test("parseGrokState: extra keys are dropped", () => {
  const s = parseGrokState(JSON.stringify({ ...GROK, transcript_path: "/x", session_name: "n", extra: 1 }));
  assert.deepEqual(Object.keys(s).sort(), GROK_KEYS);
});

test("parseGrokState: a non-matching type becomes null, a missing key too", () => {
  const s = parseGrokState(JSON.stringify({ v: 1, session_id: "g1", updated_at: 5, cwd: 3, model: ["m"], cost_usd: "1", context_window_size: null, used_percentage: "12" }));
  assert.deepEqual(s, { v: 1, session_id: "g1", cwd: null, model: null, updated_at: 5, cost_usd: null, context_window_size: null, context_tokens: null, used_percentage: null, session_input_tokens: null, session_output_tokens: null });
});

test("parseGrokState: floats from plutil are kept as is", () => {
  assert.equal(parseGrokState('{"v":1,"session_id":"g","updated_at":1,"cost_usd":1.230000}').cost_usd, 1.23);
});

test("parseGrokState: null unless v is 1, session_id a string and updated_at finite", () => {
  const bad = [
    { ...GROK, v: 2 }, { ...GROK, v: "1" }, { ...GROK, session_id: 5 }, { ...GROK, session_id: undefined },
    { ...GROK, updated_at: "1" }, { ...GROK, updated_at: null }, { ...GROK, updated_at: undefined },
  ];
  for (const b of bad) assert.equal(parseGrokState(JSON.stringify(b)), null, JSON.stringify(b));
  for (const t of ["", "nope", "[]", "5", "null", undefined, null]) assert.equal(parseGrokState(t), null, String(t));
});

// formatTokens
test("formatTokens: plain below 1000, K and M with one decimal, trailing .0 dropped", () => {
  const cases = [[0, "0"], [999, "999"], [999.4, "999"], [1000, "1K"], [12300, "12.3K"], [124000, "124K"], [1234567, "1.2M"], [2000000, "2M"], [1000000, "1M"], [15500000, "15.5M"]];
  for (const [n, out] of cases) assert.equal(formatTokens(n), out, String(n));
});

test("formatTokens: a K that rounds to 1000 becomes 1M", () => {
  assert.equal(formatTokens(999999), "1M");
  assert.equal(formatTokens(999950), "1M");
});

test("the module reads no real home folder: its source has no fs or network import", () => {
  const src = readFileSync(new URL("../lib/agent-files.js", import.meta.url), "utf8");
  assert.ok(!/^\s*import\b/m.test(src));
  assert.ok(!/\b(readFileSync|exec\(|fetch\()/.test(src));
});
