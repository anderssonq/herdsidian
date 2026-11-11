// Usage: Kiro credits from messages.jsonl usage_summary lines (the Kiro usage JSONL spec,
// AC1-AC8). Parser and merge run on fixture strings and stub execs; the shell runs against temp
// folders on macOS only (`stat -f` is BSD). No real Kiro transcript is used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  KIRO_USAGE_MAX_FILES, kiroSessionId, kiroUsageScript, parseKiroSession, parseKiroUsageLines, parseKiroUsageListing,
} from "../lib/agent-files.js";
import { fetchKiro } from "../mods/herdsidian-status/usage-month.js";

const mac = process.platform === "darwin";
const NOW = new Date(2026, 10, 15, 12).getTime(); // 15 Nov 2026, local
const iso = (day, hour = 9, month = 10) => new Date(2026, month, day, hour).toISOString();

const FIXTURE = '{"timestamp":"2026-11-03T15:04:05.000Z","payload":{"type":"usage_summary","promptTurnSummaries":[{"unit":"credit","unitPlural":"credits","usage":1.25,"usedTools":["read"]},{"unit":"credit","usage":0.25},{"unit":"token","usage":9}],"turnId":"t1","executionId":"e1"}}';
const usageLine = (timestamp, ...credits) => JSON.stringify({ timestamp, payload: { type: "usage_summary",
  promptTurnSummaries: credits.map((usage) => ({ unit: "credit", unitPlural: "credits", usage, usedTools: ["read"] })), turnId: "t", executionId: "e" } });
const PROMPT = "SECRET-PROMPT-TEXT";
const promptLine = (timestamp) => JSON.stringify({ timestamp, payload: { type: "user", content: `${PROMPT} "type":"usage_summary"` } });

// The old session JSON (sessions/cli/*.json).
const oldSession = (id, updatedAt, turns) => JSON.stringify({
  ...(id === undefined ? {} : { session_id: id }), cwd: "/w", updated_at: updatedAt, title: "SECRET-TITLE",
  session_state: { conversation_metadata: { user_turn_metadatas: turns.map(([end, ...values]) => ({
    end_timestamp: end, metering_usage: values.map((value) => ({ value, unit: "credit", unitPlural: "credits" })) })) } },
});

// A stub exec that prints the old listing and the "new ..." lines; readTextFile from a map.
const OLD_DIR = "/k/sessions/cli";
const stub = ({ old = null, fresh = null, code = 0 } = {}) => {
  const sec = Math.floor((NOW - 86400000) / 1000);
  const lines = [];
  if (old === null) lines.push("nodir");
  else { lines.push(`dir ${OLD_DIR}`); for (const name of Object.keys(old)) lines.push(`${sec} 100 ${OLD_DIR}/${name}`); }
  lines.push(...(fresh ?? ["new nodir"]));
  const log = { reads: [], execs: [] };
  return {
    log,
    exec: async (command, args) => { log.execs.push([command, args]); return { code, stdout: `${lines.join("\n")}\n`, stderr: "" }; },
    readTextFile: async (path) => {
      log.reads.push(path);
      if (path.endsWith(".jsonl")) throw new Error(`a .jsonl was read: ${path}`);
      const name = path.slice(OLD_DIR.length + 1);
      if (old && Object.hasOwn(old, name)) return old[name];
      throw new Error(`no file ${path}`);
    },
  };
};
const freshLines = (sessions, { skip = 0, extra = 0 } = {}) => [
  "new dir /k/sessions",
  ...Array.from({ length: Object.keys(sessions).length + skip + extra }, () => "new total"),
  ...Array.from({ length: skip }, () => "new skip"),
  ...Object.entries(sessions).flatMap(([id, lines]) => [`new sess ${id}`, ...lines.map((l) => `new use ${l}`)]),
];
const month = (over) => ({ kind: "month", month: "2026-11", costUsd: null, tokens: null, skipped: 0, ...over });

// ---- parser ----

test("AC1: parseKiroUsageLines sums the credit entries of a usage_summary line and keeps nothing else", () => {
  const got = parseKiroUsageLines([FIXTURE, usageLine("not a time", 7), "not json {", promptLine(iso(3))].join("\n"));
  assert.deepEqual(got, [{ id: null, turns: [{ atMs: Date.parse("2026-11-03T15:04:05.000Z"), credits: 1.5 }] }]);
  const text = JSON.stringify(got);
  for (const key of ["usedTools", "turnId", "executionId", "readFile", "unitPlural"]) assert.ok(!text.includes(key), key);
});

test("AC1: a usage_summary line with no credit entry is one turn of 0 credits; sess lines start sessions", () => {
  const tokenOnly = JSON.stringify({ timestamp: iso(4), payload: { type: "usage_summary", promptTurnSummaries: [{ unit: "token", usage: 5 }] } });
  assert.deepEqual(parseKiroUsageLines(["sess sess_a", tokenOnly, "sess sess_b", "sess sess_c", usageLine(iso(5), 2)].join("\n")), [
    { id: "sess_a", turns: [{ atMs: Date.parse(iso(4)), credits: 0 }] },
    { id: "sess_b", turns: [] },
    { id: "sess_c", turns: [{ atMs: Date.parse(iso(5)), credits: 2 }] },
  ]);
});

test("parseKiroUsageListing reads only the new lines; none gives dir null", () => {
  assert.deepEqual(parseKiroUsageListing(`dir ${OLD_DIR}\n1 2 ${OLD_DIR}/a.json\n`), { dir: null, total: 0, skipped: 0, sessions: [] });
  assert.deepEqual(parseKiroUsageListing("new nodir\n"), { dir: null, total: 0, skipped: 0, sessions: [] });
  const got = parseKiroUsageListing(freshLines({ sess_a: [FIXTURE] }, { skip: 2, extra: 3 }).join("\n"));
  assert.equal(got.dir, "/k/sessions");
  assert.equal(got.total, 6);
  assert.equal(got.skipped, 2);
  assert.deepEqual(got.sessions, [{ id: "sess_a", turns: [{ atMs: Date.parse("2026-11-03T15:04:05.000Z"), credits: 1.5 }] }]);
});

test("kiroSessionId reads the top-level session_id string; parseKiroSession is unchanged", () => {
  const raw = oldSession("sess_x", iso(2), [[iso(2), 1]]);
  assert.equal(kiroSessionId(raw), "sess_x");
  assert.equal(kiroSessionId(oldSession(undefined, iso(2), [])), null);
  assert.equal(kiroSessionId(JSON.stringify({ session_id: 7 })), null);
  assert.equal(kiroSessionId("not json"), null);
  assert.deepEqual(Object.keys(parseKiroSession(raw)), ["cwd", "updatedAt", "turns", "context"]);
});

// ---- the month ----

test("AC2: the month counts in-month lines only, sets at, rounds once", async () => {
  const s = stub({ fresh: freshLines({
    sess_a: [usageLine(iso(2), 1.005), usageLine(iso(9, 10), 1.005), usageLine(iso(30, 9, 9), 50)], // Oct line ignored
    sess_b: [usageLine(iso(1, 9, 11), 70)], // December only: not a session this month
    sess_c: [usageLine(iso(12, 8), 0.5, 0.25)],
  }) });
  assert.deepEqual(await fetchKiro(s.exec, s.readTextFile, NOW),
    month({ credits: 2.76, sessions: 2, turns: 3, at: Date.parse(iso(12, 8)) }));
  const t = stub({ fresh: freshLines({ sess_a: [usageLine(iso(2), 1.005), usageLine(iso(3), 1.005)] }) });
  assert.equal((await fetchKiro(t.exec, t.readTextFile, NOW)).credits, 2.01, "1.005 + 1.005 is rounded once");
});

// ---- fallback and merge ----

test("AC3: old session_id and new sess_ folder merge; same time keeps the new credits", async () => {
  const s = stub({
    old: {
      "a.json": oldSession("sess_aaa", iso(6), [[iso(5), 9], [iso(6), 3]]), // iso(5) also in the new file
      "b.json": oldSession("bbb", iso(7), [[iso(7), 4]]), // bare uuid of the new sess_bbb
      "c.json": oldSession("ccc", iso(8), [[iso(8), 1]]), // another session
      "d.json": oldSession(undefined, iso(9), [[iso(9), 2]]), // no session_id: stays its own
    },
    fresh: freshLines({ sess_aaa: [usageLine(iso(5), 1.5)], sess_bbb: [usageLine(iso(7), 0.5)] }),
  });
  assert.deepEqual(await fetchKiro(s.exec, s.readTextFile, NOW),
    month({ credits: 1.5 + 3 + 0.5 + 1 + 2, sessions: 4, turns: 5, at: Date.parse(iso(9)) }));
});

test("AC3: old files that share a session_id but no new folder stay one session per file, as before", async () => {
  const s = stub({ old: { "a.json": oldSession("s", iso(3), [[iso(3), 1]]), "b.json": oldSession("s", iso(4), [[iso(4), 2]]) } });
  assert.deepEqual(await fetchKiro(s.exec, s.readTextFile, NOW), month({ credits: 3, sessions: 2, turns: 2, at: Date.parse(iso(4)) }));
});

test("AC4: the error keys and the empty-old success", async () => {
  const one = stub({ old: {}, fresh: freshLines({ sess_a: [usageLine(iso(3), 1)] }) });
  assert.deepEqual(await fetchKiro(one.exec, one.readTextFile, NOW), month({ credits: 1, sessions: 1, turns: 1, at: Date.parse(iso(3)) }));
  const none = stub({ old: null, fresh: ["new nodir"] });
  assert.deepEqual(await fetchKiro(none.exec, none.readTextFile, NOW), { error: "kiroNoSessions" });
  const emptyBoth = stub({ old: {}, fresh: ["new dir /k/sessions"] });
  assert.deepEqual(await fetchKiro(emptyBoth.exec, emptyBoth.readTextFile, NOW), { error: "kiroNoSessions" });
  const allSkipped = stub({ old: { "a.json": oldSession("x", iso(20, 9, 9), [[iso(20, 9, 9), 5]]) }, fresh: freshLines({}, { skip: 2 }) });
  assert.deepEqual(await fetchKiro(allSkipped.exec, allSkipped.readTextFile, NOW), { error: "unavailable" });
  const failed = stub({ old: {}, fresh: freshLines({ sess_a: [usageLine(iso(3), 1)] }), code: 1 });
  assert.deepEqual(await fetchKiro(failed.exec, failed.readTextFile, NOW), { error: "unavailable" });
});

test("AC4: skipped new files with an old in-month turn are a success with the skipped line", async () => {
  const s = stub({ old: { "a.json": oldSession("x", iso(3), [[iso(3), 5]]) }, fresh: freshLines({}, { skip: 1 }) });
  assert.deepEqual(await fetchKiro(s.exec, s.readTextFile, NOW), month({ credits: 5, sessions: 1, turns: 1, skipped: 1, at: Date.parse(iso(3)) }));
});

test("AC5 (stub): a .jsonl is never passed to readTextFile; the shell's usage counts", async () => {
  const s = stub({ old: { "a.json": oldSession("o", iso(4), [[iso(4), 1]]) }, fresh: freshLines({ sess_big: [usageLine(iso(4, 11), 2.25)] }, { skip: 1 }) });
  assert.deepEqual(await fetchKiro(s.exec, s.readTextFile, NOW), month({ credits: 3.25, sessions: 2, turns: 2, skipped: 1, at: Date.parse(iso(4, 11)) }));
  assert.deepEqual(s.log.reads, [`${OLD_DIR}/a.json`]);
  assert.equal(s.log.execs.length, 1, "one shell for both readers");
});

// ---- the shell ----

test("AC6: the script is read-only, has no network or kiro CLI, and quotes every path", () => {
  const script = kiroUsageScript(1793520000);
  assert.ok(!script.replaceAll("2>/dev/null", "").includes(">"), "no redirection but to /dev/null");
  assert.doesNotMatch(script, /\b(kiro-cli|curl|http|https|wget|nc|rm|mv|cp|tee|touch|mkdir|sh -c|eval)\b/);
  assert.match(script, /kiro_usage "\$\(kiro_dir\)\/sessions" 1793520000$/);
  assert.match(script, /list_json "\$\(kiro_dir\)\/sessions\/cli"/);
  assert.match(script, /grep -F '"type":"usage_summary"' "\$f"/);
  assert.match(kiroUsageScript("1; rm -x"), /sessions" 0$/, "only an integer reaches the script");
});

const realExec = (env) => async (command, args) => {
  const r = spawnSync(command, args, { env: { PATH: "/usr/bin:/bin", ...env }, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
const put = (dir, name, text, when = NOW - 86400000) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), text);
  utimesSync(join(dir, name), new Date(when), new Date(when));
};
const recordedReads = () => {
  const reads = [];
  return { reads, readTextFile: async (p) => { reads.push(p); if (p.endsWith(".jsonl")) throw new Error(p); return readFile(p, "utf8"); } };
};

test("AC5/AC6/AC7: real temp <kiro>: big file, odd paths, unreadable file, no prompt in stdout", { skip: !mac }, async () => {
  const home = mkdtempSync(join(tmpdir(), "hs-kiro-jsonl-"));
  const sessions = join(home, ".kiro", "sessions");
  const filler = promptLine(iso(3)).replace(PROMPT, "x".repeat(4096));
  const big = [usageLine(iso(3), 1.25), ...Array.from({ length: 300 }, () => filler), usageLine(iso(4), 0.75)].join("\n");
  assert.ok(Buffer.byteLength(big) > 1048576);
  put(join(sessions, "hash1", "sess_big"), "messages.jsonl", big);
  put(join(sessions, "_global", "sess_sp ace"), "messages.jsonl", [usageLine(iso(5), 2), promptLine(iso(5))].join("\n"));
  put(join(sessions, "hash2", "sess_q'uote"), "messages.jsonl", `${usageLine(iso(6), 0.5)}\n`);
  put(join(sessions, "hash2", "sess_locked"), "messages.jsonl", `${usageLine(iso(6), 99)}\n`);
  chmodSync(join(sessions, "hash2", "sess_locked", "messages.jsonl"), 0o000);
  put(join(sessions, "hash2", "sess_old"), "messages.jsonl", `${usageLine(iso(20, 9, 9), 40)}\n`, new Date(2026, 9, 20).getTime()); // before the month
  put(join(sessions, "hash2", "not_sess"), "messages.jsonl", `${usageLine(iso(6), 30)}\n`); // parent is not sess_*
  put(join(sessions, "cli"), "x.json", oldSession("sess_sp ace", iso(5), [[iso(5), 8], [iso(2), 1]]));

  const exec = realExec({ HOME: home });
  const res = await exec("/bin/sh", ["-c", kiroUsageScript(Math.floor(new Date(2026, 10, 1).getTime() / 1000))]);
  assert.equal(res.code, 0);
  assert.ok(!res.stdout.includes(PROMPT), "the prompt on the next line is not printed");
  assert.ok(!res.stdout.includes("usedTools") && !res.stdout.includes("turnId") && !res.stdout.includes("executionId"));
  assert.match(res.stdout, /^new sess sess_sp ace$/m);
  assert.match(res.stdout, /^new sess sess_q'uote$/m);

  const r = recordedReads();
  const got = await fetchKiro(exec, r.readTextFile, NOW);
  // big 1.25 + 0.75, space 2 (new wins over old 8 at the same time) + old-only 1, quote 0.5; locked skipped
  assert.deepEqual(got, month({ credits: 5.5, sessions: 3, turns: 5, skipped: 1, at: Date.parse(iso(6)) }));
  assert.deepEqual(r.reads, [join(sessions, "cli", "x.json")]);
  chmodSync(join(sessions, "hash2", "sess_locked", "messages.jsonl"), 0o644); // so the temp folder can be cleaned
});

test("shell: unit and usage pair per entry in any key order; only a sess_ parent folder counts", { skip: !mac }, async () => {
  const home = mkdtempSync(join(tmpdir(), "hs-kiro-order-"));
  const sessions = join(home, ".kiro", "sessions");
  const reordered = `{"timestamp":"${iso(3)}","payload":{"type":"usage_summary","promptTurnSummaries":[{"usage":1,"usedTools":["read"],"unit":"credit"},{"usage":2,"unit":"token"},{"unit":"credit"},{"usage":4}]}}`;
  put(join(sessions, "h", "sess_order"), "messages.jsonl", `${reordered}\n`);
  put(join(sessions, "sess_top", "sub"), "messages.jsonl", `${usageLine(iso(3), 5)}\n`); // grandparent sess_*, parent not
  const r = recordedReads();
  const got = await fetchKiro(realExec({ HOME: home }), r.readTextFile, NOW);
  assert.deepEqual(got, month({ credits: 1, sessions: 1, turns: 1, at: Date.parse(iso(3)) }));
  assert.deepEqual(parseKiroUsageLines(reordered)[0].turns, [{ atMs: Date.parse(iso(3)), credits: 1 }], "the shell and the parser agree");
});

test(`AC5: files past the ${KIRO_USAGE_MAX_FILES} cap are skipped and not opened`, { skip: !mac }, async () => {
  const home = mkdtempSync(join(tmpdir(), "hs-kiro-cap-"));
  const sessions = join(home, ".kiro", "sessions", "h");
  for (let i = 0; i <= KIRO_USAGE_MAX_FILES; i++) {
    put(join(sessions, `sess_${String(i).padStart(4, "0")}`), "messages.jsonl", `${usageLine(iso(3), 1)}\n`, NOW - 86400000 - i * 1000);
  }
  const r = recordedReads();
  const got = await fetchKiro(realExec({ HOME: home }), r.readTextFile, NOW);
  assert.deepEqual(got, month({ credits: KIRO_USAGE_MAX_FILES, sessions: KIRO_USAGE_MAX_FILES, turns: KIRO_USAGE_MAX_FILES, skipped: 1, at: Date.parse(iso(3)) }));
  assert.deepEqual(r.reads, []);
});
