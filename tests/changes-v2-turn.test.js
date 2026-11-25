// The session reader of the last-prompt card (AC10, AC12, AC13, AC14; plan Decision 3, ADR-0007):
// the turn script, its parser, the turn files, the target and the one exec. Claude Code only
// (scope cut of 2026-11-25): a Codex pane gets no target and no exec. Fixtures are synthetic lines
// in the shape of Claude Code's session files; the scripts run with HOME set to a temp folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { CLAUDE_CONTEXT_SCRIPT } from "../mods/guide-agents/agent-context.js";

// Loaded per test, so each test fails on its own until the module exists.
const load = () => import("../mods/herdsidian/turn.js");

const onMac = process.platform === "darwin";
const CWD = "/work/repo";
const DIR = "-work-repo";
const MARKER = "SECRET-MARKER";

// A temp HOME, removed after `fn`.
async function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), "changes-turn-"));
  try { return await fn(home); } finally { rmSync(home, { recursive: true, force: true }); }
}
const session = (home, name = "s.jsonl") => join(home, ".claude", "projects", DIR, name);
const put = (path, lines, ageMin = 0) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, lines.join("\n") + "\n");
  if (ageMin) { const t = new Date(Date.now() - ageMin * 60000); utimesSync(path, t, t); }
};
const env = (home) => ({ env: { PATH: "/usr/bin:/bin", HOME: home }, encoding: "utf8" });
const sh = (home, script, args = [DIR]) => spawnSync("/bin/sh", ["-c", script, "sh", ...args], env(home));
async function turnOf(home) {
  const { CLAUDE_TURN_SCRIPT } = await load();
  return sh(home, CLAUDE_TURN_SCRIPT);
}
// The output lines, without the empty string after the last new line.
const linesOf = (stdout) => stdout.split("\n").filter((l, i, all) => !(l === "" && i === all.length - 1));

// Claude Code session lines, in the key order of real files (structure only).
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const META = { userType: "external", entrypoint: "cli", cwd: CWD, sessionId: "11111111-2222-4333-8444-555555555555", version: "2.1.0", gitBranch: "main" };
const T0 = "2026-11-25T10:00:00.000Z";
const line = (o) => JSON.stringify(o);
const typed = (content, { ts = T0, origin = { kind: "human" }, ...over } = {}) => line({
  parentUuid: uuid(), isSidechain: false, promptId: uuid(), type: "user", message: { role: "user", content }, uuid: uuid(), timestamp: ts,
  permissionMode: "auto", ...(origin ? { origin } : {}), ...META, ...over,
});
const assistant = (content, over = {}) => line({
  parentUuid: uuid(), isSidechain: false,
  message: { model: "claude-x", id: "msg_1", type: "message", role: "assistant", content, stop_reason: null, usage: { input_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3, output_tokens: 4 } },
  requestId: "req_1", type: "assistant", uuid: uuid(), timestamp: T0, ...META, ...over,
});
const say = (text, over) => assistant([{ type: "text", text }], over);
const tool = (name, input, over) => assistant([{ type: "tool_use", id: `toolu_${++seq}`, name, input }], over);
const toolResult = (text, over = {}) => line({
  parentUuid: uuid(), isSidechain: false, promptId: uuid(), type: "user",
  message: { role: "user", content: [{ tool_use_id: "toolu_1", type: "tool_result", content: [{ type: "text", text }] }] },
  uuid: uuid(), timestamp: T0, toolUseResult: { stdout: text, stderr: "" }, sourceToolAssistantUUID: uuid(), ...META, ...over,
});

const WRAPPERS = ["<command-name>", "<command-message>", "<command-args>", "<local-command-stdout>", "<local-command-stderr>",
  "<local-command-caveat>", "<bash-input>", "<bash-stdout>", "<bash-stderr>", "<task-notification>", "<system-reminder>"];

// AC14: the script text.
test("AC14: the Claude turn script reads the last 256 KiB only, writes nothing and uses no network", async () => {
  const { CLAUDE_TURN_SCRIPT } = await load();
  assert.equal(typeof CLAUDE_TURN_SCRIPT, "string");
  assert.ok(CLAUDE_TURN_SCRIPT.includes("tail -c 262144"), CLAUDE_TURN_SCRIPT);
  const rest = CLAUDE_TURN_SCRIPT.split("2>/dev/null").join("");
  assert.ok(!rest.includes(">"), "the only redirect is 2>/dev/null");
  for (const word of ["curl", "wget", "nc", "ssh", "scp", "tee", "mv", "cp", "touch", "mkdir", "rm", "dd", "sed", "perl", "python", "osascript", "eval"]) {
    assert.ok(!new RegExp(`\\b${word}\\b`).test(CLAUDE_TURN_SCRIPT), `the script names ${word}`);
  }
  // No socket device, no awk command or pipe out of awk, no co-process.
  for (const text of ["/dev/tcp", "/dev/udp", "system(", "getline", "|&"]) {
    assert.ok(!CLAUDE_TURN_SCRIPT.includes(text), `the script holds ${text}`);
  }
  assert.ok(!/https?:/.test(CLAUDE_TURN_SCRIPT));
  assert.ok(!CLAUDE_TURN_SCRIPT.includes(".codex"), "no Codex session is read (scope cut)");
});

// AC12: the last typed prompt.
test("AC12: the last typed prompt wins, with its time", { skip: !onMac }, () => withHome(async (home) => {
  put(session(home), [
    typed("first prompt", { ts: "2026-11-25T09:00:00.000Z" }),
    say("a reply"),
    typed("second prompt", { ts: "2026-11-25T10:05:00.000Z" }),
    say("another reply"),
  ]);
  const { parseTurn } = await load();
  const r = await turnOf(home);
  assert.equal(r.status, 0);
  assert.deepEqual(parseTurn(r.stdout), { prompt: "second prompt", at: Date.parse("2026-11-25T10:05:00.000Z"), paths: [] });
}));

test("AC12: a typed line with no origin field (an older transcript) is a prompt", { skip: !onMac }, () => withHome(async (home) => {
  put(session(home), [typed("with origin"), typed("no origin", { origin: null })]);
  const { parseTurn } = await load();
  assert.equal(parseTurn((await turnOf(home)).stdout)?.prompt, "no origin");
}));

// Each skipped kind is the last user line; the typed prompt before it must win.
const SKIPPED = [
  ["a tool_result line", () => toolResult("tool output")],
  ["an isMeta line", () => typed("meta text", { isMeta: true })],
  ["a sidechain line", () => typed("sidechain text", { isSidechain: true })],
  ["a compact summary", () => typed("This session is being continued from a summary", { isCompactSummary: true, isVisibleInTranscriptOnly: true })],
  ["another origin.kind", () => typed("an agent hand-back", { origin: { kind: "task-notification" } })],
  ["the interrupt marker", () => typed([{ type: "text", text: "[Request interrupted by user for tool use]" }])],
  ["the interrupt marker as a string", () => typed("[Request interrupted by user]")],
  ...WRAPPERS.map((tag) => [`the wrapper ${tag}`, () => typed(`${tag}x${tag.replace("<", "</")}`)]),
];
for (const [name, make] of SKIPPED) {
  test(`AC12: ${name} is not a typed prompt`, { skip: !onMac }, () => withHome(async (home) => {
    put(session(home), [typed("the real prompt"), say("ok"), make()]);
    const { parseTurn } = await load();
    const r = await turnOf(home);
    assert.equal(parseTurn(r.stdout)?.prompt, "the real prompt", r.stdout);
  }));
}

test("AC12: quotes, backslashes, new lines, tabs, shell signs and non-ASCII text come back equal", { skip: !onMac }, () => withHome(async (home) => {
  const text = 'He said "hi" \\ C:\\dir\\n\nline 2\twith a tab\n$(echo x) `y` \'z\'\n— ñandú 日本語 🦊 e\u0301';
  put(session(home), [typed(text)]);
  const { parseTurn } = await load();
  assert.equal(parseTurn((await turnOf(home)).stdout)?.prompt, text);
}));

test("AC12: a prompt that talks about the skip keys is still the prompt", { skip: !onMac }, () => withHome(async (home) => {
  const text = 'why is "isMeta":true and "type":"tool_result" set? see <command-name> and "origin":{"kind":"agent"}';
  put(session(home), [typed("older"), typed(text)]);
  const { parseTurn } = await load();
  assert.equal(parseTurn((await turnOf(home)).stdout)?.prompt, text);
}));

test("AC12: a prompt with an image block gives its text", { skip: !onMac }, () => withHome(async (home) => {
  const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB" } };
  put(session(home), [typed("older"), typed([{ type: "text", text: "look at this screen" }, image])]);
  const { parseTurn } = await load();
  assert.equal(parseTurn((await turnOf(home)).stdout)?.prompt, "look at this screen");
}));

// AC14: output hygiene.
test("AC14: every output line starts with P, T, F or G, and no assistant text or tool output is printed", { skip: !onMac }, () => withHome(async (home) => {
  put(session(home), [
    typed(`an older prompt ${MARKER}`),
    typed("the prompt"),
    assistant([{ type: "thinking", thinking: `thinking ${MARKER}`, signature: "sig" }]),
    say(`assistant text ${MARKER}`),
    tool("Bash", { command: `echo ${MARKER}`, description: "print" }),
    toolResult(`tool output ${MARKER}`),
    tool("Edit", { replace_all: false, file_path: "/work/repo/a.js", old_string: `old ${MARKER} "file_path":"/work/repo/evil.js"`, new_string: `new ${MARKER}` }),
    toolResult(`The file /work/repo/a.js has been updated ${MARKER}`),
    typed(`meta ${MARKER}`, { isMeta: true }),
    typed(`hand-back ${MARKER}`, { origin: { kind: "task-notification" } }),
  ]);
  const r = await turnOf(home);
  assert.equal(r.status, 0);
  const lines = linesOf(r.stdout);
  assert.ok(lines.length > 0, "the prompt is printed");
  for (const l of lines) assert.match(l, /^[PTFG] /, l);
  assert.ok(!r.stdout.includes(MARKER), r.stdout);
  assert.ok(!r.stdout.includes("evil.js"), r.stdout);
  const { parseTurn } = await load();
  assert.deepEqual(parseTurn(r.stdout)?.paths, ["/work/repo/a.js"]);
}));

// AC13: the turn files.
test("AC13: Edit, Write and MultiEdit after the prompt give their file_path; Read and calls before the prompt give none", { skip: !onMac }, () => withHome(async (home) => {
  put(session(home), [
    typed("the older prompt"),
    tool("Edit", { file_path: "/work/repo/before.js", old_string: "a", new_string: "b" }),
    tool("Write", { file_path: "/work/repo/before-write.js", content: "x" }),
    typed("the prompt"),
    tool("Read", { file_path: "/work/repo/read.js" }),
    toolResult("file content"),
    tool("Edit", { replace_all: false, file_path: "/work/repo/a.js", old_string: "a", new_string: "b" }),
    toolResult("ok"),
    tool("Write", { file_path: "/work/repo/dir name/q\"uote ñ.js", content: "x" }),
    tool("MultiEdit", { file_path: "/work/repo/c.js", edits: [{ old_string: "a", new_string: "b" }] }),
    tool("Grep", { pattern: "x", path: "/work/repo/grep.js" }),
    tool("NotebookEdit", { notebook_path: "/work/repo/n.ipynb", new_source: "x" }),
  ]);
  const { parseTurn } = await load();
  const r = await turnOf(home);
  assert.equal(r.status, 0);
  const turn = parseTurn(r.stdout);
  assert.equal(turn?.prompt, "the prompt");
  assert.deepEqual(turn.paths, ["/work/repo/a.js", "/work/repo/dir name/q\"uote ñ.js", "/work/repo/c.js"]);
}));

// AC10 and Q14: the tail.
test("AC10: a prompt before the last 256 KiB gives no output", { skip: !onMac }, () => withHome(async (home) => {
  const pad = Array.from({ length: 300 }, () => say("x".repeat(1000)));
  put(session(home), [typed("too early"), tool("Edit", { file_path: "/work/repo/a.js", old_string: "a", new_string: "b" }), ...pad]);
  assert.equal((await turnOf(home)).stdout, "");
}));

test("AC10: the cut first line of the tail of a long file is ignored", { skip: !onMac }, () => withHome(async (home) => {
  // The tail starts 100 bytes before the end of this line's parentUuid, so what is left of it
  // still holds "type":"user", the origin and the text.
  const cut = typed("cut prompt", { parentUuid: "p".repeat(5000) });
  const rest = cut.slice(cut.indexOf('","isSidechain"'));
  const base = say("");
  const fill = 262144 - (100 + rest.length + 1) - (base.length + 1);
  const after = say("x".repeat(fill));
  assert.equal(100 + rest.length + 1 + after.length + 1, 262144);
  put(session(home), [typed("outside the tail"), cut, after]);
  assert.equal((await turnOf(home)).stdout, "");
}));

// Which file (A5, ADR-0005) and parity with the context script.
test("A5: a newer sdk-cli or claude-desktop file and a newer file in a subfolder are skipped", { skip: !onMac }, () => withHome(async (home) => {
  put(session(home, "interactive.jsonl"), [typed("interactive")], 10);
  put(session(home, "headless.jsonl"), [typed("headless", { entrypoint: "sdk-cli" })], 5);
  put(session(home, "desktop.jsonl"), [typed("desktop", { entrypoint: "claude-desktop" })], 3);
  put(session(home, join("interactive", "subagents", "agent-1.jsonl")), [typed("subagent")], 1);
  const { parseTurn } = await load();
  assert.equal(parseTurn((await turnOf(home)).stdout)?.prompt, "interactive");
}));

test("A5: a session file modified over 24 h ago is not used", { skip: !onMac }, () => withHome(async (home) => {
  put(session(home), [typed("old prompt")], 25 * 60);
  assert.equal((await turnOf(home)).stdout, "");
}));

test("A5: another folder's session is not used", { skip: !onMac }, () => withHome(async (home) => {
  put(join(home, ".claude", "projects", "-work-repo2", "s.jsonl"), [typed("other folder", { cwd: "/work/repo2" })]);
  assert.equal((await turnOf(home)).stdout, "");
}));

// Each file's prompt is its own name, so the prompt tells which file the turn script chose.
const PARITY = {
  "a newer sdk-cli file": [["cli", {}, 10], ["sdk", { entrypoint: "sdk-cli" }, 5]],
  "a newest file with no entrypoint": [["cli", {}, 10], ["bare", { entrypoint: undefined }, 5]],
  "a file older than 24 h": [["stale", {}, 25 * 60]],
  "five newer non-cli files": [["cli", {}, 60], ...[1, 2, 3, 4, 5].map((n) => [`sdk${n}`, { entrypoint: "sdk-cli" }, n])],
  "two cli files": [["older", {}, 30], ["newer", {}, 20]],
};
for (const [name, files] of Object.entries(PARITY)) {
  test(`A5 parity: the turn script and the context script choose the same file (${name})`, { skip: !onMac }, () => withHome(async (home) => {
    for (const [file, over, age] of files) put(session(home, `${file}.jsonl`), [typed(file, over), say("reply", over)], age);
    const context = sh(home, CLAUDE_CONTEXT_SCRIPT).stdout.match(/^## (.+)$/m)?.[1] ?? null;
    const { parseTurn } = await load();
    const prompt = parseTurn((await turnOf(home)).stdout)?.prompt ?? null;
    assert.equal(prompt, context === null ? null : basename(context, ".jsonl"));
  }));
}

// parseTurn.
test("parseTurn: a full output", async () => {
  const { parseTurn } = await load();
  const out = 'P "2026-11-25T10:05:00.000Z"\nT "fix the \\"bug\\"\\nnow"\nF "/work/repo/a.js"\nF "b.js"\n';
  assert.deepEqual(parseTurn(out), { prompt: 'fix the "bug"\nnow', at: Date.parse("2026-11-25T10:05:00.000Z"), paths: ["/work/repo/a.js", "b.js"] });
});

test("parseTurn: no T line, a T that is not a JSON string, or an empty text gives null", async () => {
  const { parseTurn } = await load();
  assert.equal(parseTurn('P "2026-11-25T10:05:00.000Z"\nF "/work/repo/a.js"\n'), null);
  assert.equal(parseTurn("T fix the bug\n"), null);
  assert.equal(parseTurn('T "unclosed\n'), null);
  assert.equal(parseTurn("T 42\n"), null);
  assert.equal(parseTurn('T "   "\n'), null);
  assert.equal(parseTurn(""), null);
});

test("parseTurn: junk lines are ignored", async () => {
  const { parseTurn } = await load();
  const out = '@@ -work-repo\n## /x/s.jsonl\nnoise\n\n"type":"user"\nT "the prompt"\nX "other"\nF "/work/repo/a.js"\n';
  assert.deepEqual(parseTurn(out), { prompt: "the prompt", at: null, paths: ["/work/repo/a.js"] });
});

test("parseTurn: a missing P gives at null", async () => {
  const { parseTurn } = await load();
  assert.deepEqual(parseTurn('T "the prompt"\n'), { prompt: "the prompt", at: null, paths: [] });
});

// AC13: turnFiles.
test("AC13 turnFiles: absolute and relative paths are made relative to the root", async () => {
  const { turnFiles } = await load();
  assert.deepEqual(turnFiles(["/work/repo/src/a.js", "b.js", "dir name/c.js"], "/work/repo/sub", "/work/repo"), ["src/a.js", "sub/b.js", "sub/dir name/c.js"]);
});

test("AC13 turnFiles: . and .. are resolved", async () => {
  const { turnFiles } = await load();
  assert.deepEqual(turnFiles(["../c.js", "./d.js", "/work/repo/sub/../e.js", "x/../../f.js"], "/work/repo/sub", "/work/repo"), ["c.js", "sub/d.js", "e.js", "f.js"]);
});

test("AC13 turnFiles: a path outside the root or equal to it is dropped", async () => {
  const { turnFiles } = await load();
  assert.deepEqual(turnFiles(["/work/other/x.js", "../../y.js", "/work/repo", "/work/repo/", ".", "/etc/hosts", "a.js"], "/work/repo", "/work/repo"), ["a.js"]);
});

test("AC13 turnFiles: duplicates are removed", async () => {
  const { turnFiles } = await load();
  assert.deepEqual(turnFiles(["/work/repo/a.js", "a.js", "./a.js", "/work/repo/b.js", "/work/repo/a.js"], "/work/repo", "/work/repo"), ["a.js", "b.js"]);
});

test("AC13 turnFiles: a sibling folder whose name starts with the root's is outside", async () => {
  const { turnFiles } = await load();
  assert.deepEqual(turnFiles(["/work/repo2/x.js", "../repo2/y.js", "/work/repo/z.js"], "/work/repo", "/work/repo"), ["z.js"]);
});

// AC10: turnTarget.
const agent = (address, pane, key, over = {}) => ({
  address, pane, space: "s1", space_name: "Space", tab: "t1", tab_index: 0, tab_name: "Tab", status: "working", app: null,
  program: { key, name: { claude: "Claude Code", codex: "Codex", opencode: "opencode" }[key] ?? key, agent: true, shell: false },
  title: "Claude title", pane_name: "api", seq: 1, pinned: false, focused: false, ...over,
});
const pane = (id, cwd, over = {}) => ({ pane: id, terminal: `term-${id}`, tab: "t1", title: "Claude title", name: "api", cwd, branch: "main", status: null, focused: false, ...over });
const focus = (id, over = {}) => ({ space: "s1", tab: "t1", pane: id, terminal: id ? `term-${id}` : null, shown: null, agent: null, cwd: CWD, ...over });

test("AC10 turnTarget: Claude Code in the focused pane gives a target", async () => {
  const { turnTarget } = await load();
  const target = turnTarget([agent("t1", "p1", "claude")], [pane("p1", CWD)], focus("p1", { agent: "t1" }));
  assert.deepEqual(target, { key: "claude", cwd: CWD, address: "t1", name: "Claude Code", paneName: "api", status: "working" });
});

test("AC10 turnTarget: with no pane name the pane name is the title", async () => {
  const { turnTarget } = await load();
  const target = turnTarget([agent("t1", "p1", "claude", { pane_name: null, status: "idle" })], [pane("p1", CWD, { name: null })], focus("p1", { agent: "t1" }));
  assert.equal(target?.paneName, "Claude title");
  assert.equal(target?.status, "idle");
});

test("AC10 turnTarget: a Claude and a Codex agent in one folder: the focused Claude pane gives a target", async () => {
  const { turnTarget } = await load();
  const target = turnTarget([agent("t1", "p1", "claude"), agent("t2", "p2", "codex")], [pane("p1", CWD), pane("p2", CWD)], focus("p1", { agent: "t1" }));
  assert.equal(target?.address, "t1");
});

const NULLS = {
  "another program": [[agent("t1", "p1", "opencode")], [pane("p1", CWD)], focus("p1", { agent: "t1" })],
  "a plain terminal": [[agent("t2", "p2", "claude")], [pane("p1", CWD), pane("p2", "/work/other")], focus("p1")],
  "no focused pane (null)": [[agent("t1", "p1", "claude")], [pane("p1", CWD)], null],
  "no focused pane id": [[agent("t1", "p1", "claude")], [pane("p1", CWD)], focus(null)],
  "a remote address": [[agent("vps/t1", "p1", "claude")], [pane("p1", CWD)], focus("p1", { agent: "vps/t1" })],
  "two Claude agents in one folder": [[agent("t1", "p1", "claude"), agent("t2", "p2", "claude")], [pane("p1", CWD), pane("p2", CWD)], focus("p1", { agent: "t1" })],
  "two Claude folders with one claudeDir": [[agent("t1", "p1", "claude"), agent("t2", "p2", "claude")], [pane("p1", "/work/a-b"), pane("p2", "/work/a_b")], focus("p1", { agent: "t1", cwd: "/work/a-b" })],
  "a pane with no cwd": [[agent("t1", "p1", "claude")], [pane("p1", null)], focus("p1", { agent: "t1", cwd: null })],
};
for (const [name, [agents, panes, focused]] of Object.entries(NULLS)) {
  test(`AC10 turnTarget: ${name} gives null`, async () => {
    const { turnTarget } = await load();
    assert.equal(turnTarget(agents, panes, focused), null);
  });
}

test("AC10 scope cut: a Codex pane gives no target and no /bin/sh call", async () => {
  const { turnTarget, readTurn } = await load();
  const target = turnTarget([agent("t1", "p1", "codex")], [pane("p1", CWD)], focus("p1", { agent: "t1" }));
  assert.equal(target, null);
  const calls = [];
  const exec = async (...args) => { calls.push(args); return { stdout: 'T "x"\n', stderr: "", code: 0 }; };
  assert.equal(await readTurn(exec, target), null);
  assert.equal(await readTurn(exec, { key: "codex", cwd: CWD, address: "t1", name: "Codex", paneName: "api", status: "idle" }), null);
  assert.deepEqual(calls, []);
});

// AC14: readTurn.
const target = { key: "claude", cwd: CWD, address: "t1", name: "Claude Code", paneName: "api", status: "idle" };

test("AC14 readTurn: one /bin/sh exec with the Claude folder name and no `on`, and parseTurn's value", async () => {
  const { readTurn, parseTurn, CLAUDE_TURN_SCRIPT } = await load();
  const out = 'P "2026-11-25T10:05:00.000Z"\nT "the prompt"\nF "/work/repo/a.js"\n';
  const calls = [];
  const exec = async (...args) => { calls.push(args); return { stdout: out, stderr: "", code: 0 }; };
  assert.deepEqual(await readTurn(exec, target), parseTurn(out));
  assert.equal(calls.length, 1);
  const [cmd, args, opts] = calls[0];
  assert.equal(cmd, "/bin/sh");
  assert.deepEqual(args, ["-c", CLAUDE_TURN_SCRIPT, "sh", DIR]);
  assert.ok(!("on" in (opts ?? {})), "no remote host");
  assert.equal(opts?.timeout, 10000);
});

test("AC14 readTurn: a rejecting exec, a non-zero exit and an empty output give null", async () => {
  const { readTurn } = await load();
  assert.equal(await readTurn(async () => { throw new Error("spawn failed"); }, target), null);
  assert.equal(await readTurn(async () => ({ stdout: 'T "the prompt"\n', stderr: "boom", code: 1 }), target), null);
  assert.equal(await readTurn(async () => ({ stdout: "", stderr: "", code: 0 }), target), null);
});

test("AC14 readTurn: over a fixture home it returns the prompt, its time and the turn's paths", { skip: !onMac }, () => withHome(async (home) => {
  put(session(home), [typed("the prompt", { ts: "2026-11-25T10:05:00.000Z" }), tool("Write", { file_path: "/work/repo/a.js", content: "x" })]);
  const { readTurn } = await load();
  const exec = async (cmd, args) => {
    const r = spawnSync(cmd, args, env(home));
    return { stdout: r.stdout, stderr: r.stderr, code: r.status };
  };
  assert.deepEqual(await readTurn(exec, target), { prompt: "the prompt", at: Date.parse("2026-11-25T10:05:00.000Z"), paths: ["/work/repo/a.js"] });
}));
