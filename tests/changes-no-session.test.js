// AC1 of the Git tab spec (critical: access): with a Claude Code agent in the focused pane, the Changes tab runs no
// /bin/sh exec and reads no file under the home's .claude folder, through the list, an open diff and a watch refresh.
// Control in the same tests: the git reads of the list and the patch still run. Written from the spec only.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mount, fakeGit, fakeFiles, reset, world, state, findById, walk, texts, settle } from "./support/changes-kit.js";

beforeEach(reset);

const ROOT = "/work/repo";
const HOME = "/fixture/home";
const CLAUDE_DIR = `${HOME}/.claude`;

const STATUS = "## main\0 M a.txt\0 M c.txt\0";
const NUMSTAT = "3\t1\ta.txt\0" + "2\t0\tc.txt\0";
const PATCH = (path) => `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1,2 @@\n one\n+two\n`;
// What a session read would get, so a reader that still exists has something to show.
const SESSION = `P "2026-11-25T10:00:00.000Z"\nT "fix the bug"\nF "${ROOT}/a.txt"\n`;

// A Claude Code agent in the focused pane p1, in ROOT; the sidebar store says the Changes tab is shown.
function scene() {
  Object.assign(world, {
    spaces: [{ id: "s1", active: true, folder: ROOT }],
    panes: [{ pane: "p1", cwd: ROOT, pane_name: "pane p1" }],
    focused: { pane: "p1" },
    agents: [{ address: "w1:p1", pane: "p1", status: "idle", program: { key: "claude", name: "Claude Code" } }],
    home: HOME,
  });
  state.shared["herdsidian.sidebar"] = { tab: "changes" };
  const git = fakeGit({ status: STATUS, numstat: NUMSTAT, patches: { "a.txt": PATCH("a.txt"), "c.txt": PATCH("c.txt") }, session: () => SESSION });
  const files = fakeFiles({});
  return { git, files, m: mount() };
}

// Renders until `fn` finds what it waits for; about one second at most.
async function until(fn, what) {
  for (let i = 0; i < 50; i++) {
    const value = fn();
    if (value) return value;
    await settle();
  }
  return assert.fail(`timed out waiting for ${what}`);
}

// A few more ticks, so a read that would start has started and ended.
async function calm(m) {
  for (let i = 0; i < 4; i++) { m.render(); await settle(); }
  return m.render();
}

const shellCalls = (git) => git.calls.filter(([cmd]) => cmd === "/bin/sh");
// Any command that names the session folder or the home, so a reader that comes back through cat or plain sh fails too.
const namesSession = (value) => typeof value === "string" && (value.includes(".claude") || value.includes(HOME));
const sessionExecs = (git) => git.calls.filter(([cmd, args]) => namesSession(cmd) || (args ?? []).some(namesSession));
const sessionReads =(files) => files.calls.map(([path]) => path).filter((path) => path === CLAUDE_DIR || path.startsWith(`${CLAUDE_DIR}/`));
const gitCalls = (git, flag) => git.calls.filter(([cmd, args]) => cmd === "git" && args.includes(flag));
const patchFor = (git, path) => gitCalls(git, "-U3").filter(([, args]) => args.at(-1) === path);

// Asserts the access rule at one step, with its control.
function noSession(git, files, step) {
  assert.equal(shellCalls(git).length, 0, `${step}: no /bin/sh exec, got ${shellCalls(git).map(([, args]) => args.at(-1)).join(", ")}`);
  assert.equal(sessionExecs(git).length, 0, `${step}: no exec names .claude or ${HOME}, got ${sessionExecs(git).map(([cmd]) => cmd).join(", ")}`);
  assert.deepEqual(sessionReads(files), [], `${step}: no read under ${CLAUDE_DIR}`);
  assert.ok(gitCalls(git, "status").length >= 1, `${step}: the status read ran`);
  assert.ok(gitCalls(git, "--numstat").length >= 1, `${step}: the numstat read ran`);
}

// A watch refresh: the folder watch reports a change, and the watch applies the read that follows.
async function refresh(m) {
  const watcher = await until(() => world.watchers.filter((w) => w.root === ROOT).at(-1), "the folder watch");
  const before = m.watch.rev;
  watcher.resolve([`${ROOT}/a.txt`]);
  await until(() => m.watch.rev > before, "a watch refresh");
}

// Two renders, then the started work ends: no exec and no file read may start from them.
async function twoRenders(m, git, files, step) {
  const execs = git.calls.length, reads = files.calls.length;
  m.render();
  m.render();
  for (let i = 0; i < 4; i++) await settle();
  assert.equal(git.calls.length, execs, `${step}: a re-render starts no exec`);
  assert.equal(files.calls.length, reads, `${step}: a re-render reads no file`);
}

async function showList(m) {
  await until(() => findById(m.render(), "change-a.txt"), "the list");
  return calm(m);
}

async function openDiff(m, path) {
  m.click(findById(m.render(), `change-${path}`));
  await until(() => {
    const t = m.render();
    return findById(t, "diff-view") && walk(t).some((n) => n.kind === "vlist") && !texts(t).includes("Loading diff…") && t;
  }, `the diff of ${path}`);
  return calm(m);
}

test("AC1: list, open diff, watch refresh: no /bin/sh exec and no read under ~/.claude; the git reads still run", async () => {
  const { git, files, m } = scene();

  await showList(m);
  noSession(git, files, "the list");
  assert.deepEqual(gitCalls(git, "-U3"), [], "the list: no patch read yet");

  await openDiff(m, "a.txt");
  noSession(git, files, "the diff");
  assert.equal(patchFor(git, "a.txt").length, 1, "the diff: one -U3 patch read for the opened file");
  assert.equal(gitCalls(git, "-U3").length, 1, "the diff: no patch read for a file that was not opened");

  const statusBefore = gitCalls(git, "status").length;
  await refresh(m);
  await calm(m);
  noSession(git, files, "the refresh");
  assert.ok(gitCalls(git, "status").length > statusBefore, "the refresh: the status read ran again");
  assert.deepEqual(gitCalls(git, "-U3").filter(([, args]) => args.at(-1) !== "a.txt"), [], "the refresh: patch reads only for the opened file");
});

test("AC1: the same with two renders after each step; a re-render starts nothing", async () => {
  const { git, files, m } = scene();

  await showList(m);
  await twoRenders(m, git, files, "the list");
  noSession(git, files, "the list");
  assert.deepEqual(gitCalls(git, "-U3"), [], "the list: no patch read yet");

  await openDiff(m, "a.txt");
  await twoRenders(m, git, files, "the diff");
  noSession(git, files, "the diff");
  assert.equal(patchFor(git, "a.txt").length, 1, "the diff: one -U3 patch read for the opened file");
  assert.equal(gitCalls(git, "-U3").length, 1, "the diff: no patch read for a file that was not opened");

  const statusBefore = gitCalls(git, "status").length;
  await refresh(m);
  await calm(m);
  await twoRenders(m, git, files, "the refresh");
  noSession(git, files, "the refresh");
  assert.ok(gitCalls(git, "status").length > statusBefore, "the refresh: the status read ran again");
  assert.deepEqual(gitCalls(git, "-U3").filter(([, args]) => args.at(-1) !== "a.txt"), [], "the refresh: patch reads only for the opened file");
});
