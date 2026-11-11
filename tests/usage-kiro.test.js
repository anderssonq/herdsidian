// Usage: Kiro (agent-usage-context spec, AC 6-11). The month reader runs its real listing script
// against temp folders (macOS only: `stat -f` is BSD); the status mod runs against stubs.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { state, fakeCx, settle, element, walk, findById } from "./support/mod-stubs.js";

const stubs = globalThis.__herdsidianStubs;
const hooks = { knownAgents: async () => [], panes: [], focused: null };
stubs["gpui-base"].HoverCard = { new: (id) => element("hovercard", id) };
stubs.herdr.knownAgents = (...args) => hooks.knownAgents(...args);
stubs.herdr.panes = () => hooks.panes;
stubs.herdr.focused = () => hooks.focused;
stubs.herdr.agents = () => [];
stubs.herdr.keys = () => [];
stubs.herdr.settings = () => ({ theme: "hs_nord_theme" });
const T = { foreground: "#ffffff", muted: "#888888", accent: "#00ff00", blocked: "#ff0000", canvas: "#101010", chrome: "#202020", background: "#101010", raised: "#303030", working: "#0000ff" };
stubs.herdr.theme = () => new Proxy(T, { get: (target, key) => (typeof key === "string" ? target[key] ?? "#808080" : undefined) });

const { default: Status } = await import("../mods/herdsidian-status/main.js");
const { fetchProvider } = await import("../mods/herdsidian-status/usage.js");
const { reading } = await import("../mods/herdsidian-status/usage-status.js");
const { usageCard } = await import("../mods/herdsidian-status/usage-view.js");
const { tokens } = await import("../mods/herdsidian-status/tokens.js");
const k = tokens(T);

const mac = process.platform === "darwin";
const NOW = new Date(2026, 10, 15, 12).getTime(); // 15 Nov 2026, local
const iso = (day, hour = 9, month = 10) => new Date(2026, month, day, hour).toISOString();
const credit = (value) => ({ value, unit: "credit", unitPlural: "credits" });
const turn = (end, ...values) => ({ ...(end ? { end_timestamp: end } : {}), metering_usage: values.map(credit) });
const session = (updatedAt, turns) => JSON.stringify({
  session_id: "s", cwd: "/w", created_at: updatedAt, updated_at: updatedAt, title: "SECRET-TITLE",
  session_state: { conversation_metadata: { user_turn_metadatas: turns } },
});

const realExec = (env, cwd) => async (command, args) => {
  const r = spawnSync(command, args, { env: { PATH: "/usr/bin:/bin", ...env }, cwd, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
const readReal = (path) => readFile(path, "utf8");
const put = (dir, name, text, when = NOW - 86400000) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), text);
  utimesSync(join(dir, name), new Date(when), new Date(when));
};

// A fetch that records every exec and every read.
const recorded = (env, cwd) => {
  const log = { execs: [], reads: [] };
  const exec = realExec(env, cwd);
  return {
    log,
    exec: async (command, args) => { log.execs.push([command, args]); return exec(command, args); },
    readTextFile: async (path) => { log.reads.push(path); return readReal(path); },
  };
};

test("AC6: the month's credits, sessions, turns and skipped files from a temp <kiro>", { skip: !mac }, async () => {
  const home = mkdtempSync(join(tmpdir(), "hs-kiro-home-"));
  const dir = join(home, ".kiro", "sessions", "cli");
  put(dir, "a.json", session(iso(13), [turn(iso(12), 1.25, 0.1), turn(iso(13), 2.0)]));
  put(dir, "b.json", session(iso(14), [turn(iso(20, 9, 9), 5)])); // its only turn ended last month
  put(dir, "c.json", session(iso(10, 10), [turn(null, 0.5)])); // no end_timestamp: updated_at decides
  put(dir, "d.json", session(iso(14), []));
  put(dir, "e.json", "not json {");
  put(dir, "big.json", `{"x":"${"a".repeat(Math.floor(1.1 * 1048576))}"}`);
  put(dir, "x.jsonl", '{"SECRET-TRANSCRIPT":1}');
  const r = recorded({ HOME: home });
  const got = await fetchProvider("kiro", r.exec, { readTextFile: r.readTextFile, now: NOW });
  assert.deepEqual(got, { data: { kind: "month", month: "2026-11", credits: 3.85, costUsd: null, tokens: null,
    sessions: 2, turns: 3, skipped: 2, at: Date.parse(iso(13)) } });
  assert.ok(!r.log.reads.some((p) => p.endsWith("big.json")), "the 1.1 MiB file is listed and counted in skipped, but never read");
  assert.ok(!r.log.reads.some((p) => p.endsWith(".jsonl")), "no transcript is read");
});

test("AC7: KIRO_HOME is read when absolute; otherwise $HOME/.kiro", { skip: !mac }, async () => {
  const root = mkdtempSync(join(tmpdir(), "hs-kiro-root-"));
  const home = join(root, "home", "user");
  const files = [join(root, "kh"), join(root, "home"), home, join(root, "rel")];
  put(join(root, "kh", "sessions", "cli"), "a.json", session(iso(12), [turn(iso(12), 1)]));
  put(join(root, "home", "sessions", "cli"), "a.json", session(iso(12), [turn(iso(12), 4)])); // a parent of $HOME
  put(join(home, "sessions", "cli"), "a.json", session(iso(12), [turn(iso(12), 8)])); // $HOME itself
  put(join(root, "rel", "sessions", "cli"), "a.json", session(iso(12), [turn(iso(12), 16)])); // a relative KIRO_HOME resolved from cwd
  put(join(home, ".kiro", "sessions", "cli"), "a.json", session(iso(12), [turn(iso(12), 2)]));
  const run = async (kiroHome) => {
    const env = { HOME: home, ...(kiroHome === undefined ? {} : { KIRO_HOME: kiroHome }) };
    const r = recorded(env, root);
    const got = await fetchProvider("kiro", r.exec, { readTextFile: r.readTextFile, now: NOW });
    return { credits: got.data?.credits, reads: r.log.reads };
  };
  assert.equal((await run(files[0])).credits, 1);
  assert.equal((await run(`${files[0]}/`)).credits, 1, "a trailing slash is dropped");
  for (const bad of ["rel", "/", files[1], home, `${home}/`, ""]) {
    const got = await run(bad);
    assert.equal(got.credits, 2, `KIRO_HOME=${JSON.stringify(bad)} falls back to $HOME/.kiro`);
    assert.ok(got.reads.every((p) => p.startsWith(`${home}/.kiro/sessions/cli/`)), bad);
  }
  assert.equal((await run(undefined)).credits, 2);
});

test("AC8: every exec is a read-only /bin/sh script and every read is a .json under <kiro>/sessions/cli", { skip: !mac }, async () => {
  const home = mkdtempSync(join(tmpdir(), "hs-kiro-ro-"));
  const dir = join(home, ".kiro", "sessions", "cli");
  put(dir, "a.json", session(iso(12), [turn(iso(12), 1)]));
  put(dir, "a.jsonl", "{}");
  const r = recorded({ HOME: home });
  await fetchProvider("kiro", r.exec, { readTextFile: r.readTextFile, now: NOW });
  assert.ok(r.log.execs.length >= 1);
  for (const [command, args] of r.log.execs) {
    assert.equal(command, "/bin/sh");
    assert.equal(args[0], "-c");
    assert.doesNotMatch(args[1], /\b(kiro-cli|curl|http|rm|mv|tee)\b/);
    assert.ok(!args[1].replaceAll("2>/dev/null", "").includes(">"), "no redirection but to /dev/null");
  }
  assert.ok(r.log.reads.length >= 1);
  for (const p of r.log.reads) {
    assert.ok(p.endsWith(".json") && p.startsWith(`${dir}/`), p);
  }
});

// ---- the status mod and the card ----

const agent = (key, name) => ({ key, name, icon: `icons/${key}.svg`, tint: true, installed: true });
const AGENTS = [agent("claude", "Claude Code"), agent("codex", "Codex"), agent("opencode", "opencode"), agent("kiro", "Kiro")];
const FAR = "2099-01-01T00:00:00Z";
const CLAUDE = `{"five_hour":{"utilization":42,"resets_at":"${FAR}"},"seven_day":{"utilization":25.0,"resets_at":"${FAR}"}}\n200`;
const CODEX = '{"timestamp":"2026-10-31T19:45:27.541Z","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":61.0,"window_minutes":300,"resets_at":4102444800},"secondary":{"used_percent":53.0,"window_minutes":10080,"resets_at":4102444800},"plan_type":"plus"}}}';
const OPENCODE = "│Total Cost      $30.95 │\n│Input            4.1M │\n│Output         325.2K │\n";
const ok = (stdout) => ({ code: 0, stdout, stderr: "" });
const FILE = "/k/sessions/cli/a.json";
const listing = `dir /k/sessions/cli\n${Math.floor(NOW / 1000)} 100 ${FILE}\n`;

let kiroExec, realNow, timers;
beforeEach(() => {
  realNow = Date.now;
  Date.now = () => NOW;
  timers = [];
  kiroExec = async () => ok(listing);
  state.exec = async (command, args) => {
    if (command === "opencode") return ok(OPENCODE);
    if (args[1].includes("kiro_dir")) return kiroExec(command, args);
    return ok(args[1].includes("curl") ? CLAUDE : CODEX);
  };
  state.readTextFile = async (path) => {
    if (path === FILE) return session(iso(14), [turn(iso(14), 12.346)]);
    throw new Error(`no file ${path}`);
  };
  state.shared = {};
  hooks.knownAgents = async () => AGENTS;
  hooks.panes = [{ pane: "p1", terminal: "t1", program: { key: "kiro" } }];
  hooks.focused = { pane: "p1" };
});
afterEach(() => { Date.now = realNow; });

const call = (node, name) => node.calls.find(([n]) => n === name)?.[1][0];
const lastCall = (node, name) => node.calls.filter(([n]) => n === name).at(-1)?.[1][0];
const textsOf = (node, out = []) => {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object" && "kids" in node) {
    for (const kid of node.kids) textsOf(kid, out);
    for (const [name, args] of node.calls) if (name !== "child" && name !== "children") for (const a of args) if (a && typeof a === "object" && "kids" in a) textsOf(a, out);
  }
  return out;
};
const start = async () => {
  const view = new Status(), cx = fakeCx();
  cx.timer.after = (ms, fn) => { timers.push([ms, fn]); return { cancel() {} }; };
  view.init({}, cx);
  await settle();
  return view;
};
const hovercard = (view) => walk(view.render()).find((n) => n.kind === "hovercard");
const control = (view) => call(hovercard(view), "trigger");
const hover = async (view) => { await view.hoverUsage(true); await settle(); };
const cardText = (view) => textsOf(call(hovercard(view), "content")).join(" | ");

test("AC9: a Kiro reading shows credits and the month, never a bar or the blocked color", async () => {
  const view = await start();
  await hover(view);
  const primary = findById(control(view), "usage-primary");
  assert.deepEqual(textsOf(findById(primary, "usage-percent")), ["12.35 cr"]);
  assert.deepEqual(textsOf(findById(primary, "usage-label")), ["Nov"]);
  assert.equal(findById(primary, "usage-bar"), null);
  assert.notEqual(lastCall(findById(primary, "usage-percent"), "text_color"), T.blocked);
  const entry = { state: "ok", data: { kind: "month", month: "2026-11", credits: 12.346, costUsd: null, tokens: null, sessions: 1, turns: 1, skipped: 0, at: null } };
  assert.deepEqual(reading("kiro", entry, NOW), { text: "12.35 cr", percent: null, label: "Nov", high: false });
  // compact: another provider is focused
  hooks.panes = [{ pane: "p1", terminal: "t1", program: { key: "claude" } }];
  const other = await start();
  await hover(other);
  assert.deepEqual(textsOf(findById(control(other), "usage-other-kiro")), ["12.35 cr"]);
});

test("AC10: the card's Kiro section", () => {
  const data = { kind: "month", month: "2026-11", credits: 12.35, costUsd: null, tokens: null, sessions: 3, turns: 41, skipped: 2, at: NOW - 5 * 60000 };
  const card = usageCard(T, k, { providers: [agent("kiro", "Kiro")], agentsKnown: true, failed: false, view: () => ({ state: "ok", data }), now: NOW, focusedKey: null });
  const text = textsOf(card).join(" | ");
  for (const part of ["This month, no usage limits", "Credits | 12.35", "Sessions | 3", "Turns | 41", "updated 5 m ago", "2 files skipped"]) {
    assert.ok(text.includes(part), `${part} in ${text}`);
  }
  const one = usageCard(T, k, { providers: [agent("kiro", "Kiro")], agentsKnown: true, failed: false, view: () => ({ state: "ok", data: { ...data, skipped: 1, at: null } }), now: NOW, focusedKey: null });
  assert.ok(textsOf(one).join(" | ").includes("1 file skipped"));
  assert.doesNotMatch(textsOf(one).join(" | "), /updated/);
});

test("AC11: a missing folder, a failing listing and a timeout show their texts; the other sections keep their readings", async () => {
  const others = (text) => {
    assert.match(text, /5 h \| 42%/);
    assert.match(text, /5 h \| 61%/);
    assert.match(text, /\$30\.95/);
  };
  kiroExec = async () => ok("nodir\n");
  let view = await start();
  await hover(view);
  assert.match(cardText(view), /No Kiro sessions found\./);
  assert.deepEqual(textsOf(findById(control(view), "usage-percent")), ["–"]);
  others(cardText(view));

  for (const failing of [async () => { throw new Error("boom"); }, async () => ({ code: 1, stdout: "", stderr: "x" })]) {
    kiroExec = failing;
    view = await start();
    await hover(view);
    assert.match(cardText(view), /Usage unavailable\./);
    others(cardText(view));
  }

  kiroExec = () => new Promise(() => {});
  view = await start();
  await hover(view);
  for (const [ms, fn] of timers.filter(([ms]) => ms === 15000)) fn();
  await settle();
  assert.match(cardText(view), /Timed out\./);
  assert.deepEqual(textsOf(findById(control(view), "usage-percent")), ["–"]);
  others(cardText(view));
});
