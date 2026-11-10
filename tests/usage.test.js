// Usage: providers, parsers, formatting, the fetch scripts and the cache (pure, no Herdr runtime).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TOKEN_FN, CLAUDE_SCRIPT, CODEX_SCRIPT, ERROR_TEXT, createUsage, fetchProvider, formatAge, formatPercent, formatReset, formatWindow,
  parseClaude, parseClaudeOutput, parseCodexLine, parseCodexOutput, parseOpencode, providersFrom, windowView,
} from "../mods/herdsidian-status/usage.js";

const NOW = Date.parse("2026-11-06T12:00:00Z");
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;

// ---- AC2 providers ----

test("providersFrom keeps installed claude, codex and opencode in that order, once each", () => {
  const list = [
    { key: "opencode", installed: true, name: "opencode" },
    { key: "gemini", installed: true },
    { key: "codex", installed: false },
    { key: "claude", installed: true, name: "Claude Code" },
    { key: "claude", installed: true, name: "dup" },
    { key: "codex", installed: true, name: "Codex" },
  ];
  assert.deepEqual(providersFrom(list).map((p) => p.name), ["Claude Code", "Codex", "opencode"]);
});

test("providersFrom leaves out uninstalled entries and answers [] for no list", () => {
  assert.deepEqual(providersFrom([{ key: "claude", installed: false }]), []);
  assert.deepEqual(providersFrom(null), []);
  assert.deepEqual(providersFrom(undefined), []);
});

// ---- AC21-24 formatting ----

test("percent rounds and clamps", () => {
  assert.equal(formatPercent(23.4), "23%");
  assert.equal(formatPercent(23.5), "24%");
  assert.equal(formatPercent(-5), "0%");
  assert.equal(formatPercent(180), "100%");
});

test("reset text", () => {
  assert.equal(formatReset(NOW, NOW), "reset");
  assert.equal(formatReset(NOW - HOUR, NOW), "reset");
  assert.equal(formatReset(NOW + 30000, NOW), "resets in <1 m");
  assert.equal(formatReset(NOW + 14 * MIN + 5000, NOW), "resets in 14 m");
  assert.equal(formatReset(NOW + 2 * HOUR + 14 * MIN, NOW), "resets in 2 h 14 m");
  assert.equal(formatReset(NOW + 3 * DAY + 4 * HOUR + MIN, NOW), "resets in 3 d 4 h");
  assert.equal(formatReset(null, NOW), "");
});

test("a Codex window already reset shows 0%, an empty bar and reset; Claude keeps its percent", () => {
  const w = { label: "5 h", percent: 80, resetsAt: NOW - 1000 };
  assert.deepEqual(windowView(w, NOW, true), { label: "5 h", percent: 0, percentText: "0%", resetText: "reset" });
  assert.equal(windowView(w, NOW, false).percent, 80);
  assert.equal(windowView({ ...w, resetsAt: NOW + HOUR }, NOW, true).percent, 80);
});

test("window label from minutes", () => {
  assert.equal(formatWindow(10080), "7 d");
  assert.equal(formatWindow(300), "5 h");
  assert.equal(formatWindow(45), "45 m");
  assert.equal(formatWindow(90), "90 m");
});

test("age text", () => {
  assert.equal(formatAge(NOW - 10000, NOW), "updated just now");
  assert.equal(formatAge(NOW - 5 * MIN, NOW), "updated 5 m ago");
  assert.equal(formatAge(NOW - 3 * HOUR, NOW), "updated 3 h ago");
  assert.equal(formatAge(NOW - 6 * DAY, NOW), "updated 6 d ago");
  assert.equal(formatAge(null, NOW), "");
  assert.equal(formatAge(NaN, NOW), "");
});

// ---- AC20 Claude parser ----

const CLAUDE_BODY = JSON.stringify({
  five_hour: { utilization: 4.0, resets_at: "2026-11-07T02:30:00.989525+00:00" },
  seven_day: { utilization: 25.0, resets_at: "2026-11-10T00:00:00+00:00" },
  seven_day_opus: null, extra_usage: { is_enabled: false },
});

test("Claude 200 with both windows gives two windows and ignores other fields", () => {
  const { data } = parseClaude(200, CLAUDE_BODY);
  assert.deepEqual(data.windows.map((w) => [w.label, w.percent]), [["5 h", 4], ["7 d", 25]]);
  assert.equal(data.windows[0].resetsAt, Date.parse("2026-11-07T02:30:00.989525+00:00"));
});

test("Claude null reset time gives no reset text", () => {
  const body = JSON.stringify({ five_hour: { utilization: 1, resets_at: null }, seven_day: { utilization: 2 } });
  const { data } = parseClaude(200, body);
  assert.deepEqual(data.windows.map((w) => w.resetsAt), [null, null]);
  assert.equal(formatReset(data.windows[0].resetsAt, NOW), "");
});

test("Claude 401 is the login case; anything else unusable is unavailable", () => {
  assert.deepEqual(parseClaude(401, ""), { error: "login" });
  for (const [status, body] of [
    [500, CLAUDE_BODY], [403, CLAUDE_BODY], [200, "not json"], [200, "null"],
    [200, JSON.stringify({ five_hour: { utilization: 1 } })],
    [200, JSON.stringify({ five_hour: { utilization: "3" }, seven_day: { utilization: 2 } })],
    [200, JSON.stringify({ five_hour: { utilization: null }, seven_day: { utilization: 2 } })],
    [200, JSON.stringify({ five_hour: { utilization: 1 }, seven_day: { utilization: 2 } }).replace("2", "1e999")],
  ]) assert.deepEqual(parseClaude(status, body), { error: "unavailable" }, `${status} ${body}`);
});

test("Claude output is the body, a newline and the status; nocreds is signed out", () => {
  assert.equal(parseClaudeOutput(`${CLAUDE_BODY}\n200`).data.windows.length, 2);
  assert.deepEqual(parseClaudeOutput("\n401"), { error: "login" });
  assert.deepEqual(parseClaudeOutput("\nnocreds"), { error: "signedOut" });
  assert.deepEqual(parseClaudeOutput("\n000"), { error: "unavailable" });
  assert.deepEqual(parseClaudeOutput(""), { error: "unavailable" });
});

// ---- AC25 Codex parser ----

const CODEX_LINE = '{"timestamp":"2026-10-31T19:45:27.541Z","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":23.0,"window_minutes":300,"resets_at":1793481034},"secondary":{"used_percent":53.0,"window_minutes":10080,"resets_at":1793779206},"plan_type":"plus"}}}';

test("Codex parser reads windows, plan and reading time from the real line shape", () => {
  const d = parseCodexLine(CODEX_LINE);
  assert.deepEqual(d.windows, [
    { label: "5 h", percent: 23, resetsAt: 1793481034000 },
    { label: "7 d", percent: 53, resetsAt: 1793779206000 },
  ]);
  assert.equal(d.plan, "plus");
  assert.equal(d.at, Date.parse("2026-10-31T19:45:27.541Z"));
});

test("Codex parser keeps a window only with finite used_percent and window_minutes", () => {
  const line = JSON.parse(CODEX_LINE);
  line.payload.rate_limits.primary.used_percent = "x";
  assert.deepEqual(parseCodexLine(JSON.stringify(line)).windows.map((w) => w.label), ["7 d"]);
  line.payload.rate_limits.secondary.window_minutes = null;
  assert.equal(parseCodexLine(JSON.stringify(line)), null);
});

test("Codex parser: not JSON, no limits or another type is no reading", () => {
  assert.equal(parseCodexLine("{broken"), null);
  assert.equal(parseCodexLine('{"payload":{"type":"token_count","rate_limits":null}}'), null);
  assert.equal(parseCodexLine('{"payload":{"type":"agent_message"}}'), null);
});

test("Codex reading time missing or not a date gives no age; plan not a string gives no plan", () => {
  const line = JSON.parse(CODEX_LINE);
  delete line.timestamp; line.payload.rate_limits.plan_type = 3;
  const d = parseCodexLine(JSON.stringify(line));
  assert.equal(d.at, null);
  assert.equal(d.plan, null);
  line.timestamp = "yesterday";
  assert.equal(parseCodexLine(JSON.stringify(line)).at, null);
});

test("Codex output: the first usable line wins (S7); none is 'none'", () => {
  assert.equal(parseCodexOutput(`{bad\n${CODEX_LINE}\n`).data.plan, "plus");
  assert.deepEqual(parseCodexOutput(""), { error: "none" });
  assert.deepEqual(parseCodexOutput("{bad\n"), { error: "none" });
});

// ---- AC26 opencode parser ----

const BOX = [
  "┌────────────────────────────────────────────────────────┐",
  "│                       COST & TOKENS                    │",
  "├────────────────────────────────────────────────────────┤",
  "│Total Cost                                       $0.00 │",
  "│Avg Cost/Day                                     $0.00 │",
  "│Input                                                0 │",
  "│Output                                               0 │",
  "│Cache Read                                           0 │",
  "└────────────────────────────────────────────────────────┘",
].join("\n");
const WITH_VALUES = BOX.replace("$0.00 │\n│Avg", () => "$30.95 │\n│Avg").replace(/Input +0/, () => "Input          4.1M").replace(/Output +0/, () => "Output         325.2K");

test("opencode parser reads Total Cost, Input and Output as printed", () => {
  assert.deepEqual(parseOpencode(BOX).data, { kind: "stats", cost: "$0.00", input: "0", output: "0" });
  const d = parseOpencode(WITH_VALUES).data;
  assert.deepEqual([d.cost, d.input, d.output], ["$30.95", "4.1M", "325.2K"]);
});

test("opencode parser gives the same result with ANSI codes", () => {
  const colored = BOX.split("\n").map((l) => `\u001b[90m${l.slice(0, 1)}\u001b[0m\u001b[1;32m${l.slice(1)}\u001b[0m`).join("\n");
  assert.deepEqual(parseOpencode(colored), parseOpencode(BOX));
});

test("opencode parser: a missing row is unavailable", () => {
  assert.deepEqual(parseOpencode(BOX.replace("Output", "Outputs").replace("Total Cost", "Cost")), { error: "unavailable" });
  assert.deepEqual(parseOpencode(""), { error: "unavailable" });
});

// ---- AC27-AC30 scripts ----

test("the Claude script is one constant pipeline that never prints the token or writes anything", () => {
  assert.deepEqual(CLAUDE_SCRIPT.match(/https?:\/\/[^\s'"]+/g), ["https://api.anthropic.com/api/oauth/usage"]);
  assert.match(CLAUDE_SCRIPT, /\/usr\/bin\/curl -q -s -m \d+ --proto =https --max-redirs 0 -H @- /);
  assert.match(CLAUDE_SCRIPT, /printf 'Authorization: Bearer %s\\n' "\$t" \| \/usr\/bin\/curl -q /);
  assert.match(CLAUDE_SCRIPT, /\/usr\/bin\/security find-generic-password/);
  assert.doesNotMatch(CLAUDE_SCRIPT.replaceAll("/usr/bin/security", ""), /\bsecurity\b/);
  for (const forbidden of [/curl[^|\n]*\s-(v|i|X)\b/, /--trace/, /--verbose/, /--include/, /-d\b/, /--data/, /add-generic-password/, /delete-generic-password/, /\becho\b[^\n]*\$t/, /\bset -x\b/])
    assert.doesNotMatch(CLAUDE_SCRIPT, forbidden);
  // The only redirections are to /dev/null.
  assert.deepEqual(CLAUDE_SCRIPT.match(/\d?>\s*\S+/g)?.filter((r) => !r.endsWith("/dev/null")), []);
  // The token only appears as the printf argument inside the pipeline, never as a curl argument.
  const curlLine = CLAUDE_SCRIPT.split("\n").find((l) => l.includes("curl"));
  assert.doesNotMatch(curlLine.split("|").at(-1), /\$t\b/);
});

test("the Codex script only reads", () => {
  assert.doesNotMatch(CODEX_SCRIPT, /\d?>\s*(?!\/dev\/null)\S+|\brm\b|\bmv\b|\btee\b/);
  assert.match(CODEX_SCRIPT, /head -n 5/);
});

// ---- the token reader, run through /bin/sh on FAKE credentials (no Keychain, no network) ----

const FAKE_CLAUDE = { accessToken: "FAKE-CLAUDE-TOKEN", refreshToken: "FAKE-REFRESH", expiresAt: 1 };
const FAKE_MCP = { "server-a|1": { serverName: "a", accessToken: "FAKE-MCP-TOKEN-A" }, "server-b|2": { serverName: "b", accessToken: "FAKE-MCP-TOKEN-B" } };
const readToken = (json) => spawnSync("/bin/sh", ["-c", `${TOKEN_FN}\ntok`], { input: json, encoding: "utf8" });

test("the Claude script includes the token reader as written", () => {
  assert.ok(CLAUDE_SCRIPT.split("\n").includes(TOKEN_FN));
  assert.match(TOKEN_FN, /plutil -extract claudeAiOauth\.accessToken raw -o - -/);
});

test("the token reader returns the claudeAiOauth token whether mcpOAuth comes before or after it", () => {
  for (const json of [
    JSON.stringify({ claudeAiOauth: FAKE_CLAUDE, mcpOAuth: FAKE_MCP }),
    JSON.stringify({ mcpOAuth: FAKE_MCP, claudeAiOauth: FAKE_CLAUDE }),
    JSON.stringify({ mcpOAuth: FAKE_MCP, claudeAiOauth: FAKE_CLAUDE, other: { accessToken: "FAKE-OTHER" } }),
  ]) {
    const r = spawnSync("/bin/sh", ["-c", `${TOKEN_FN}\ntok`], { input: json, encoding: "utf8" });
    assert.equal(r.stdout.trimEnd(), "FAKE-CLAUDE-TOKEN"); // the script's $(...) drops the newline
  }
});

test("the token reader prints nothing when claudeAiOauth is missing, whatever else holds an accessToken", () => {
  for (const json of [JSON.stringify({ mcpOAuth: FAKE_MCP }), JSON.stringify({ claudeAiOauth: { refreshToken: "x" }, mcpOAuth: FAKE_MCP }), "not json", ""]) {
    assert.equal(readToken(json).stdout, "");
  }
});

test("without a claudeAiOauth token the script reports no credentials and never reaches curl", () => {
  // Same script with the Keychain and the file source replaced by fake JSON on stdin; curl is a trap.
  const script = [TOKEN_FN, `t=$(cat | tok)`, `[ -n "$t" ] || { printf '\\nnocreds'; exit 0; }`, `echo CURL-REACHED`].join("\n");
  const r = spawnSync("/bin/sh", ["-c", script], { input: JSON.stringify({ mcpOAuth: FAKE_MCP }), encoding: "utf8" });
  assert.equal(r.stdout, "\nnocreds");
  assert.deepEqual(parseClaudeOutput(r.stdout), { error: "signedOut" });
});

// ---- the Codex script, run for real against a fake HOME ----

test("the Codex script orders every session file by time, also with spaces in a path", { skip: process.platform !== "darwin" }, () => {
  const home = mkdtempSync(join(tmpdir(), "codex-home-"));
  try {
    const dir = join(home, ".codex", "sessions", "2026", "11 06");
    mkdirSync(dir, { recursive: true });
    const put = (name, text, ageMin) => {
      const file = join(dir, name);
      writeFileSync(file, text);
      const t = new Date(Date.now() - ageMin * 60000);
      utimesSync(file, t, t);
    };
    const line = (used) => CODEX_LINE.replace('"used_percent":23.0', `"used_percent":${used}`);
    put("newest no count.jsonl", '{"type":"message"}\n', 1);
    put("with count.jsonl", `${line(41)}\n`, 2);
    put("older.jsonl", `${line(99)}\n`, 3);
    for (let i = 0; i < 8; i++) put(`filler ${i}.jsonl`, '{"type":"message"}\n', 100 + i);
    const r = spawnSync("/bin/sh", ["-c", CODEX_SCRIPT], { env: { HOME: home, PATH: "/usr/bin:/bin" }, encoding: "utf8" });
    const lines = r.stdout.split("\n").filter(Boolean);
    assert.equal(lines.length, 2); // only the 2 of the newest 5 that have a count
    assert.equal(parseCodexOutput(r.stdout).data.windows[0].percent, 41); // the newer one first
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ---- fetch + cache ----

// An exec stub that records calls and answers by command.
const recorder = (answers) => {
  const calls = [];
  const exec = (command, args = []) => { calls.push([command, args]); return answers(command, args, calls.length); };
  return { exec, calls };
};
const ok = (stdout) => Promise.resolve({ code: 0, stdout, stderr: "" });
const answerAll = (command, args) => (command === "opencode" ? ok(BOX)
  : args[1].includes("curl") ? ok(`${CLAUDE_BODY}\n200`) : ok(CODEX_LINE));

// Timers the test fires by hand.
const timers = () => {
  const list = [];
  return { list, after: (ms, fn) => { const t = { ms, fn, cancelled: false }; list.push(t); return () => { t.cancelled = true; }; } };
};
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("Claude fetch is one exec of /bin/sh with the constant script and nothing else", async () => {
  const { exec, calls } = recorder(answerAll);
  const r = await fetchProvider("claude", exec);
  assert.equal(r.data.windows.length, 2);
  assert.deepEqual(calls, [["/bin/sh", ["-c", CLAUDE_SCRIPT]]]);
});

test("a fetch never throws: a rejecting exec or a nonzero code is 'unavailable' (AC18)", async () => {
  for (const key of ["claude", "codex", "opencode"]) {
    assert.deepEqual(await fetchProvider(key, () => Promise.reject(new Error("spawn secret-token ENOENT"))), { error: "unavailable" });
    assert.deepEqual(await fetchProvider(key, () => ok("").then((r) => ({ ...r, code: 1 }))), { error: "unavailable" });
    assert.deepEqual(await fetchProvider(key, () => { throw new Error("sync"); }), { error: "unavailable" });
  }
});

test("Claude exit 0 with nocreds is signed out; Codex with no lines is 'none'; opencode runs `stats --days 7`", async () => {
  assert.deepEqual(await fetchProvider("claude", () => ok("\nnocreds")), { error: "signedOut" });
  assert.deepEqual(await fetchProvider("codex", () => ok("")), { error: "none" });
  const { exec, calls } = recorder(answerAll);
  assert.equal((await fetchProvider("opencode", exec)).data.cost, "$0.00");
  assert.deepEqual(calls, [["opencode", ["stats", "--days", "7"]]]);
});

test("no exec at start (AC13, AC16): creating the cache and waiting runs nothing", async () => {
  const { exec, calls } = recorder(answerAll);
  const t = timers();
  createUsage({ exec, after: t.after });
  await flush();
  assert.equal(calls.length, 0);
  assert.equal(t.list.length, 0);
});

test("the first hover starts one fetch per provider; each shows its result as it ends (AC8, AC13)", async () => {
  const slow = Promise.withResolvers();
  const { exec, calls } = recorder((command, args) => (command === "opencode" ? slow.promise : answerAll(command, args)));
  const t = timers();
  const usage = createUsage({ exec, after: t.after });
  usage.hover(["claude", "codex", "opencode"]);
  assert.equal(calls.length, 3);
  assert.equal(usage.view("claude").state, "loading");
  await flush();
  assert.equal(usage.view("claude").state, "ok");
  assert.equal(usage.view("codex").state, "ok");
  assert.equal(usage.view("opencode").state, "loading"); // a slow provider does not hold the others
  slow.resolve({ code: 0, stdout: BOX, stderr: "" });
  await flush();
  assert.equal(usage.view("opencode").state, "ok");
});

test("a provider not fetched yet reads as loading", () => {
  const usage = createUsage({ exec: () => ok(""), after: timers().after });
  assert.deepEqual(usage.view("claude"), { state: "loading" });
});

test("a hover within 5 minutes reuses the reading; after 5 minutes it fetches again and shows loading (AC14)", async () => {
  let now = 1000;
  const { exec, calls } = recorder(answerAll);
  const usage = createUsage({ exec, after: timers().after, now: () => now });
  usage.hover(["claude"]); await flush();
  assert.equal(calls.length, 1);
  now += 5 * MIN - 1;
  usage.hover(["claude"]); await flush();
  assert.equal(calls.length, 1);
  assert.equal(usage.view("claude").state, "ok");
  now += 2;
  usage.hover(["claude"]);
  assert.equal(calls.length, 2);
  assert.equal(usage.view("claude").state, "loading");
  await flush();
  assert.equal(usage.view("claude").state, "ok");
});

test("a failed provider is fetched again on the next hover; a hover while one runs starts no second (AC15)", async () => {
  let fail = true;
  const gate = Promise.withResolvers();
  const { exec, calls } = recorder((command, args) => (fail ? Promise.reject(new Error("x")) : gate.promise.then(() => answerAll(command, args))));
  const usage = createUsage({ exec, after: timers().after });
  usage.hover(["claude"]); await flush();
  assert.deepEqual(usage.view("claude"), { id: 1, state: "error", error: "unavailable" });
  fail = false;
  usage.hover(["claude"]);
  usage.hover(["claude"]);
  assert.equal(calls.length, 2, "one retry, not two");
  gate.resolve(); await flush();
  assert.equal(usage.view("claude").state, "ok");
});

test("a fetch over the limit shows 'Timed out.', the others still show, and a late answer is ignored (AC17)", async () => {
  const never = new Promise(() => {});
  const late = Promise.withResolvers();
  const { exec } = recorder((command, args) => (command === "opencode" ? never : args[1].includes("curl") ? late.promise : answerAll(command, args)));
  const t = timers();
  const usage = createUsage({ exec, after: t.after });
  usage.hover(["claude", "codex", "opencode"]);
  assert.deepEqual(t.list.map((x) => x.ms), [15000, 15000, 15000]);
  await flush();
  assert.equal(usage.view("codex").state, "ok");
  t.list[0].fn(); t.list[2].fn(); // claude and opencode hit the limit
  assert.equal(usage.view("claude").error, "timeout");
  assert.equal(ERROR_TEXT[usage.view("opencode").error], "Timed out.");
  late.resolve({ code: 0, stdout: `${CLAUDE_BODY}\n200`, stderr: "" });
  await flush();
  assert.equal(usage.view("claude").state, "error", "late answer ignored");
  assert.equal(usage.view("codex").state, "ok");
  // and the next hover retries the timed-out ones only
  usage.hover(["claude", "codex", "opencode"]);
  assert.equal(usage.view("claude").state, "loading");
  assert.equal(usage.view("codex").state, "ok");
});

test("a provider whose process still runs after the limit is not started again; it shows 'Timed out.'", async () => {
  const gate = Promise.withResolvers();
  const { exec, calls } = recorder((command, args) => (args[1]?.includes("curl") ? gate.promise : answerAll(command, args)));
  const t = timers();
  const usage = createUsage({ exec, after: t.after });
  usage.hover(["claude"]);
  t.list[0].fn(); // the limit
  assert.equal(usage.view("claude").error, "timeout");
  usage.hover(["claude"]);
  usage.hover(["claude"]);
  assert.equal(calls.length, 1, "no second process while the first runs");
  assert.equal(usage.view("claude").error, "timeout");
  gate.resolve({ code: 0, stdout: `${CLAUDE_BODY}\n200`, stderr: "" });
  await flush();
  assert.equal(usage.view("claude").error, "timeout", "the late answer is still ignored");
  usage.hover(["claude"]);
  assert.equal(calls.length, 2, "once the process has settled, the next hover fetches");
  assert.equal(usage.view("claude").state, "loading");
});

test("windowView clamps once: an out-of-range percent gives 0-100 for the bar and the text", () => {
  const w = { label: "5 h", resetsAt: null };
  assert.deepEqual([windowView({ ...w, percent: 180 }, NOW).percent, windowView({ ...w, percent: 180 }, NOW).percentText], [100, "100%"]);
  assert.deepEqual([windowView({ ...w, percent: -5 }, NOW).percent, windowView({ ...w, percent: -5 }, NOW).percentText], [0, "0%"]);
});

test("a finished fetch cancels its limit timer and asks for a redraw", async () => {
  const t = timers();
  let changes = 0;
  const usage = createUsage({ exec: answerAll, after: t.after, onChange: () => { changes += 1; } });
  usage.hover(["opencode"]); await flush();
  assert.equal(t.list[0].cancelled, true);
  assert.equal(changes, 1);
});

test("after a fetch the cache holds only the parsed readings, never the raw output or a token (AC29)", async () => {
  const secret = "sk-ant-oat01-FAKE-SECRET";
  const body = `{"five_hour":{"utilization":1,"resets_at":null},"seven_day":{"utilization":2,"resets_at":null},"note":"${secret}"}\n200`;
  const usage = createUsage({ exec: () => ok(body), after: timers().after });
  usage.hover(["claude"]); await flush();
  const entry = usage.view("claude");
  assert.equal(entry.state, "ok");
  assert.doesNotMatch(JSON.stringify(entry), new RegExp(secret));
  assert.deepEqual(Object.keys(entry).sort(), ["at", "data", "id", "state"]);
  assert.deepEqual(Object.keys(entry.data).sort(), ["at", "kind", "plan", "windows"]);
});

test("error texts are exactly the spec's (AC19)", () => {
  assert.deepEqual(ERROR_TEXT, {
    signedOut: "Not signed in to Claude Code.",
    login: "Open Claude Code to refresh its login.",
    none: "No Codex usage recorded yet.",
    timeout: "Timed out.",
    unavailable: "Usage unavailable.",
  });
});
