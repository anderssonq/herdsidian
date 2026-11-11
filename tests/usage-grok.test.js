// Usage: Grok (agent-usage-context spec, AC 12-16). The month reader runs its real listing script
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
const day = (d, month = 10) => new Date(2026, month, d, 9).getTime();
const hook = (id, updatedAt, extra = {}) => JSON.stringify({
  v: 1, session_id: id, cwd: "/w", model: "grok-x", updated_at: updatedAt, cost_usd: null,
  context_window_size: 256000, context_tokens: 100, used_percentage: 1,
  session_input_tokens: 0, session_output_tokens: 0, ...extra,
});

const put = (dir, name, text, when = NOW - 86400000) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), text);
  utimesSync(join(dir, name), new Date(when), new Date(when));
};
const recorded = (env) => {
  const log = { execs: [], reads: [] };
  return {
    log,
    exec: async (command, args) => {
      log.execs.push([command, args]);
      const r = spawnSync(command, args, { env: { PATH: "/usr/bin:/bin", ...env }, encoding: "utf8" });
      return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    readTextFile: async (path) => { log.reads.push(path); return readFile(path, "utf8"); },
  };
};
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "hs-grok-"));
  const dir = join(root, "herdsidian", "grok");
  put(dir, "g1.json", hook("g1", day(12), { cost_usd: 1.0, session_input_tokens: 1000000, session_output_tokens: 200000 }));
  put(dir, "g2.json", hook("g2", day(14), { session_input_tokens: 34567, session_output_tokens: null }));
  put(dir, "g3.json", hook("g3", day(20, 9), { cost_usd: 9, session_input_tokens: 5 })); // updated last month
  put(dir, "bad.json", "not json {");
  return { root, dir };
};

test("AC12: the month's cost, tokens, sessions and skipped files from a temp <state>/grok", { skip: !mac }, async () => {
  const { root } = fixture();
  const r = recorded({ HOME: root, XDG_STATE_HOME: root });
  const got = await fetchProvider("grok", r.exec, { readTextFile: r.readTextFile, now: NOW });
  assert.deepEqual(got, { data: { kind: "month", month: "2026-11", credits: null, costUsd: 1.0, tokens: 1234567,
    sessions: 2, turns: null, skipped: 1, at: day(14) } });
});

// ---- cards and the status mod ----

const agent = (key, name) => ({ key, name, icon: `icons/${key}.svg`, tint: true, installed: true });
const month = (extra) => ({ kind: "month", month: "2026-11", credits: null, costUsd: 1.0, tokens: 1234567, sessions: 2, turns: null, skipped: 0, at: NOW - 5 * 60000, ...extra });
const textsOf = (node, out = []) => {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object" && "kids" in node) {
    for (const kid of node.kids) textsOf(kid, out);
    for (const [name, args] of node.calls) if (name !== "child" && name !== "children") for (const a of args) if (a && typeof a === "object" && "kids" in a) textsOf(a, out);
  }
  return out;
};
const cardOf = (data) => textsOf(usageCard(T, k, { providers: [agent("grok", "Grok")], agentsKnown: true, failed: false,
  view: () => ({ state: "ok", data }), now: NOW, focusedKey: null })).join(" | ");

test("AC13: with no cost the status text is the token total and the card says Cost unknown", () => {
  const data = month({ costUsd: null });
  assert.deepEqual(reading("grok", { state: "ok", data }, NOW), { text: "1.2M tok", percent: null, label: "Nov", high: false });
  const text = cardOf(data);
  assert.ok(text.includes("Cost unknown"), text);
  assert.doesNotMatch(text, /\$/);
});

test("AC14: the Grok card and a bar-less primary", async () => {
  const text = cardOf(month());
  for (const part of ["This month, no usage limits", "Only Grok sessions run with the Herdsidian status line.",
    "Cost | $1.00", "Tokens | 1.2M", "Sessions | 2", "updated 5 m ago"]) {
    assert.ok(text.includes(part), `${part} in ${text}`);
  }
  assert.deepEqual(reading("grok", { state: "ok", data: month() }, NOW), { text: "$1.00", percent: null, label: "Nov", high: false });
});

let realNow;
beforeEach(() => {
  realNow = Date.now;
  Date.now = () => NOW;
  state.exec = async () => ({ code: 0, stdout: "nodir\n", stderr: "" });
  state.readTextFile = async (path) => { throw new Error(`no file ${path}`); };
  state.shared = {};
  hooks.knownAgents = async () => [agent("claude", "Claude Code"), agent("grok", "Grok")];
  hooks.panes = [{ pane: "p1", terminal: "t1", program: { key: "grok" } }];
  hooks.focused = { pane: "p1" };
});
afterEach(() => { Date.now = realNow; });

test("AC14: with a Grok reading as primary there is no usage-bar", async () => {
  const file = "/s/herdsidian/grok/a.json";
  state.exec = async (command, args) => (args[1].includes("herdsidian/grok")
    ? { code: 0, stdout: `dir /s/herdsidian/grok\n${Math.floor(NOW / 1000)} 100 ${file}\n`, stderr: "" }
    : { code: 1, stdout: "", stderr: "" });
  state.readTextFile = async (path) => (path === file ? hook("a", day(14), { cost_usd: 1.0, session_input_tokens: 5 }) : Promise.reject(new Error("no")));
  const view = new Status();
  view.init({}, fakeCx());
  await settle();
  await view.hoverUsage(true);
  await settle();
  const control = walk(view.render()).find((n) => n.kind === "hovercard").calls.find(([n]) => n === "trigger")[1][0];
  const primary = findById(control, "usage-primary");
  assert.deepEqual(textsOf(findById(primary, "usage-percent")), ["$1.00"]);
  assert.equal(findById(primary, "usage-bar"), null);
});

test("AC15: Grok installed and no <state>/grok folder shows the hook note and the dash", async () => {
  const view = new Status();
  view.init({}, fakeCx());
  await settle();
  await view.hoverUsage(true);
  await settle();
  const hc = walk(view.render()).find((n) => n.kind === "hovercard");
  const text = textsOf(hc.calls.find(([n]) => n === "content")[1][0]).join(" | ");
  assert.ok(text.includes("Grok usage needs the Herdsidian status line hook. See Usage in the README."), text);
  const control = hc.calls.find(([n]) => n === "trigger")[1][0];
  assert.deepEqual(textsOf(findById(control, "usage-percent")), ["–"]);
});

test("AC16: a Grok fetch runs only /bin/sh read-only scripts, never grok, and reads only <state>/grok/*.json", { skip: !mac }, async () => {
  const { root, dir } = fixture();
  const r = recorded({ HOME: root, XDG_STATE_HOME: root });
  await fetchProvider("grok", r.exec, { readTextFile: r.readTextFile, now: NOW });
  assert.ok(r.log.execs.length >= 1);
  for (const [command, args] of r.log.execs) {
    assert.equal(command, "/bin/sh");
    assert.equal(args[0], "-c");
    assert.doesNotMatch(args[1], /\b(curl|http|rm|mv|tee)\b/);
    assert.doesNotMatch(args[1], /(^|[\s;|&(])grok(\s|$)/, "the grok program is never run");
    assert.ok(!args[1].replaceAll("2>/dev/null", "").includes(">"), "no redirection but to /dev/null");
  }
  assert.ok(r.log.reads.length >= 1);
  for (const p of r.log.reads) {
    assert.ok(p.endsWith(".json") && p.startsWith(`${dir}/`), p);
    assert.ok(!p.includes("/.grok/"), p);
  }
});
