// The Git tab's confirm gate as drawn (critical, locked): the card, the disabled buttons, one action at a time and the
// result panel (AC45, AC48, AC49, AC50). Every write is asserted through the fake git's exec log.
import { mountGit, fakeRepo, fakeOps, focusRepo, deferred, commitsOf, reset, state, findById, walk, texts, has, settle } from "./support/git-kit.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as tokenLib from "../mods/herdsidian/tokens.js";

beforeEach(() => { reset(); state.toasts = []; });

const T = { foreground: "#eeeeee", background: "#111111", chrome: "#222222", canvas: "#333333", raised: "#2a2a2a", accent: "#ff00aa",
  muted: "#999999", dim: "#555555", hover: "#444444", blocked: "#ffaa00", ansi1: "#ff0001", ansi2: "#00ff02",
  ansi3: "#ffff03", ansi4: "#0000ff", ansi5: "#ff00ff", ansi6: "#00ffff" };

const WRITES = ["pull", "push", "branch", "stash", "pop"];
const ALL = ["fetch", ...WRITES];
const COMMITS = commitsOf(`
  c3 <- c2 | third | Ann Lee <ann@example.com>
  c2 <- c1 | second | Ann Lee <ann@example.com>
  c1 <- | first | Ann Lee <ann@example.com>
`);
// A middle repo where every action is enabled: a branch with an upstream, 2 commits ahead, 3 changed files, one stash.
const BASE = { commits: COMMITS, upstream: { remote: "origin", ref: "refs/heads/main", short: "origin/main" }, ahead: 2, behind: 0,
  remotes: ["origin"], changed: 3, stash: { hash: "5".repeat(40), message: "On main: wip" } };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, what) {
  for (let i = 0; i < 60; i++) {
    const value = await check();
    if (value) return value;
    await sleep(15);
  }
  assert.fail(`timed out waiting for ${what}`);
}

function scene(over = {}, { tab = "git", ops = [] } = {}) {
  fakeOps(ops);
  const repo = fakeRepo({ ...BASE, ...over });
  const m = mountGit({ theme: T, tab });
  return { repo, m };
}

// The tab once the snapshot is read: the actions bar with the graph or a message.
async function ready(m) {
  await until(() => { const t = m.render(); return findById(t, "git-actions") && (findById(t, "git-graph") || findById(t, "git-message")); }, "the Git tab with its actions");
  await settle();
  return m.render();
}

const button = (tree, action) => findById(tree, `git-act-${action}`);
const inputOf = (tree) => walk(findById(tree, "git-confirm-input")).find((n) => n.kind === "input").arg;
const colorsIn = (node) => walk(node).flatMap((n) => n.calls.filter(([name]) => name === "text_color").map(([, args]) => args[0]));
const writeIs = (action) => (args) => args.includes(action);

async function openCard(m, action) {
  const tree = await ready(m);
  m.click(button(tree, action));
  return until(() => { const t = m.render(); return findById(t, "git-confirm") && t; }, `the ${action} card`);
}

// Opens the card, types a branch name when given, and clicks the card's confirm button.
async function confirmAction(m, action, name = null) {
  let tree = await openCard(m, action);
  if (name !== null) { m.type(inputOf(tree), name); tree = m.render(); }
  m.click(findById(tree, "git-confirm-yes"));
  return tree;
}

// The last text color set on the way from `root` down to the node that holds `text` (gpui inherits it).
function inkOf(root, text) {
  const path = [];
  const find = (n) => {
    if (!n || typeof n !== "object" || !("kids" in n)) return false;
    path.push(n);
    if (n.kids.includes(text) || n.kids.some(find)) return true;
    path.pop();
    return false;
  };
  if (!find(root)) return undefined;
  return path.flatMap((n) => n.calls.filter(([name]) => name === "text_color").map(([, args]) => args[0])).at(-1);
}

function assertDisabled(tree, action, reason) {
  const node = button(tree, action);
  assert.ok(node, `git-act-${action} is drawn`);
  const colors = colorsIn(node);
  assert.ok(colors.length > 0 && colors.every((c) => c === T.muted), `${action} is drawn in t.muted, got ${JSON.stringify(colors)}`);
  assert.ok(!walk(node).some((n) => n.calls.some(([name]) => name === "hover")), `${action} has no hover`);
  assert.ok(!walk(node).some((n) => n.onClick), `${action} has no on_click`);
  assert.ok(has(node, "tooltip", reason), `${action} tooltip is "${reason}"`);
}

function assertEnabled(tree, action) {
  const node = button(tree, action);
  assert.ok(node, `git-act-${action} is drawn`);
  assert.equal(typeof node.onClick, "function", `${action} has on_click`);
}

// ---- AC45: the card, cancel, confirm, Fetch, leaving and another repo ----

for (const action of WRITES) {
  test(`AC45 a click on git-act-${action} shows git-confirm and runs no write; git-confirm-no closes it and runs nothing`, async () => {
    const { repo, m } = scene();
    const tree = await openCard(m, action);
    assert.ok(findById(tree, "git-confirm"));
    await settle();
    assert.deepEqual(repo.log.writes(), []);
    const before = repo.calls.length;
    m.click(findById(tree, "git-confirm-no"));
    await settle();
    assert.equal(findById(m.render(), "git-confirm"), null);
    assert.deepEqual(repo.log.writes(), []);
    assert.equal(repo.calls.length, before, "Cancel starts no command");
  });

  test(`AC45 git-confirm-yes on the ${action} card runs exactly one write, after the re-check reads`, async () => {
    const { repo, m } = scene();
    await openCard(m, action);
    const mark = repo.calls.length;
    const tree = m.render();
    if (action === "branch") m.type(inputOf(tree), "feat/new");
    m.click(findById(m.render(), "git-confirm-yes"));
    await until(() => repo.log.writes().length > 0, `the ${action} write`);
    await settle();
    assert.equal(repo.log.writes().length, 1);
    assert.equal(repo.log.count(action), 1);
    const after = repo.calls.slice(mark);
    const at = after.findIndex(([cmd, args]) => repo.log.writes().some(([c, a]) => c === cmd && a === args));
    const reread = after.slice(0, at);
    assert.ok(reread.some(([cmd, args]) => cmd === "git" && args.includes("--absolute-git-dir")), "the re-check reads the folders first");
    assert.ok(reread.some(([cmd, args]) => cmd === "git" && args.includes("--porcelain=v2")), "the re-check reads the status first");
  });
}

test("AC45 git-act-fetch runs the Fetch command at once, with no card", async () => {
  const { repo, m } = scene();
  const tree = await ready(m);
  m.click(button(tree, "fetch"));
  await until(() => repo.log.writes().length > 0, "the fetch write");
  await settle();
  assert.equal(findById(m.render(), "git-confirm"), null);
  assert.equal(repo.log.writes().length, 1);
  const [cmd, args] = repo.log.writes()[0];
  assert.equal(cmd, "env");
  assert.deepEqual(args, ["GIT_TERMINAL_PROMPT=0", "git", "-C", "/work/repo", "fetch", "--all"]);
});

test("AC45 leave() removes an open card; its kept confirm button then runs nothing", async () => {
  const { repo, m } = scene();
  const tree = await openCard(m, "pull");
  m.leave();
  await settle();
  assert.equal(findById(m.render(), "git-confirm"), null);
  m.click(findById(tree, "git-confirm-yes"));
  await settle();
  assert.deepEqual(repo.log.writes(), []);
});

test("AC45 a focus move to another repo removes an open card; its kept confirm button then runs nothing", async () => {
  const { repo, m } = scene();
  const tree = await openCard(m, "push");
  repo.set({ root: "/work/other" });
  focusRepo("/work/other");
  await m.apply();
  await until(() => !findById(m.render(), "git-confirm"), "the card to go");
  m.click(findById(tree, "git-confirm-yes"));
  await settle();
  assert.deepEqual(repo.log.writes(), []);
});

// ---- AC48: one cause at a time ----

const CAUSES = [
  { cause: "no remote", over: { remotes: [], upstream: null }, action: "fetch", reason: "No remote", enabled: "branch" },
  { cause: "detached", over: { branch: null, upstream: null }, action: "pull", reason: "Detached HEAD", enabled: "branch" },
  { cause: "no commit", over: { commits: [], head: null, upstream: null }, action: "branch", reason: "No commits yet", enabled: "fetch" },
  { cause: "an operation", ops: ["MERGE_HEAD"], action: "branch", reason: "Finish the merge first", enabled: "fetch" },
  { cause: "nothing to stash", over: { changed: 0 }, action: "stash", reason: "Nothing to stash", enabled: "pull" },
  { cause: "no stash", over: { stash: null }, action: "pop", reason: "No stash", enabled: "stash" },
  { cause: "nothing to push", over: { ahead: 0 }, action: "push", reason: "Nothing to push", enabled: "pull" },
];

for (const { cause, over = {}, ops = [], action, reason, enabled } of CAUSES) {
  test(`AC48 ${cause}: git-act-${action} is muted, with no hover and no on_click, and its tooltip is "${reason}"`, async () => {
    const { m } = scene(over, { ops });
    const tree = await ready(m);
    assertDisabled(tree, action, reason);
    assertEnabled(tree, enabled);
  });
}

test("AC48 control: on a repo where every action is allowed, all six buttons have on_click", async () => {
  const { m } = scene();
  const tree = await ready(m);
  for (const action of ALL) assertEnabled(tree, action);
});

// ---- AC49: one action at a time ----

test("AC49 with a write held open all six buttons are disabled and kept click handlers add no call", async () => {
  const hold = deferred();
  const { repo, m } = scene({ write: (args) => (writeIs("pull")(args) ? hold.promise : null) });
  const tree = await confirmAction(m, "pull");
  await until(() => repo.log.count("pull") === 1, "the pull write");
  await settle();
  const running = m.render();
  for (const action of ALL) assertDisabled(running, action, "Pull is running");
  const before = repo.calls.length;
  for (const action of ["fetch", "stash", "push"]) m.click(button(tree, action));
  m.click(findById(tree, "git-confirm-yes"));
  await settle();
  assert.equal(repo.calls.length, before, "a kept handler starts no command");
  assert.equal(repo.log.writes().length, 1);
  hold.resolve({ code: 0, stdout: "Already up to date.\n" });
  await settle();
});

test("AC49 leave() does not stop a running Pull; when it ends on the Changes tab one toast names the repo folder and Pull done", async () => {
  const hold = deferred();
  const { repo, m } = scene({ write: (args) => (writeIs("pull")(args) ? hold.promise : null) });
  await confirmAction(m, "pull");
  await until(() => repo.log.count("pull") === 1, "the pull write");
  state.shared["herdsidian.sidebar"] = { tab: "changes" };
  m.leave();
  hold.resolve({ code: 0, stdout: "Already up to date.\n" });
  await until(() => state.toasts.length > 0, "the toast");
  await settle();
  assert.equal(state.toasts.length, 1);
  assert.equal(state.toasts[0].title, "repo: Pull done");
  assert.equal(repo.log.writes().length, 1);
});

test("AC49 a Pull that ends while another repo is focused gives one toast with the repo folder and Pull done", async () => {
  const hold = deferred();
  const { repo, m } = scene({ write: (args) => (writeIs("pull")(args) ? hold.promise : null) });
  await confirmAction(m, "pull");
  await until(() => repo.log.count("pull") === 1, "the pull write");
  repo.set({ root: "/work/other" });
  focusRepo("/work/other");
  await m.apply();
  m.render();
  await settle();
  m.render();
  hold.resolve({ code: 0, stdout: "Already up to date.\n" });
  await until(() => state.toasts.length > 0, "the toast");
  await settle();
  assert.equal(state.toasts.length, 1);
  assert.equal(state.toasts[0].title, "repo: Pull done");
});

test("AC49 a Pull that ends on the same repo with the tab shown gives no toast and shows git-result", async () => {
  const hold = deferred();
  const { repo, m } = scene({ write: (args) => (writeIs("pull")(args) ? hold.promise : null) });
  await confirmAction(m, "pull");
  await until(() => repo.log.count("pull") === 1, "the pull write");
  hold.resolve({ code: 0, stdout: "Already up to date.\n" });
  const tree = await until(() => { const t = m.render(); return findById(t, "git-result") && t; }, "git-result");
  await settle();
  assert.ok(texts(findById(tree, "git-result-title")).join(" ").includes("Pull done"));
  assert.deepEqual(state.toasts, []);
});

// ---- AC50: the result panel ----

const STDOUT = "From origin\n";
const STDERR = "hint: Diverging branches can't be fast-forwarded\nerror: cannot pull with rebase\nfatal: Not possible to fast-forward, aborting.\n";
const LINES = ["error: cannot pull with rebase", "fatal: Not possible to fast-forward, aborting."];
const failedPull = (args) => (writeIs("pull")(args) ? { code: 1, stdout: STDOUT, stderr: STDERR } : null);

async function failedPanel(m) {
  await confirmAction(m, "pull");
  return until(() => { const t = m.render(); return findById(t, "git-result") && t; }, "git-result");
}

test("AC50 a failure shows git-result with Pull failed, the lines in gitTokens(t).errorText, and git-result-copy copies the full output", async () => {
  const { m } = scene({ write: failedPull });
  await failedPanel(m);
  await settle();
  const tree = m.render();
  const panel = findById(tree, "git-result");
  assert.ok(texts(findById(tree, "git-result-title")).join(" ").includes("Pull failed"));
  const shown = texts(findById(tree, "git-result-lines"));
  for (const line of LINES) assert.ok(shown.includes(line), `the panel shows "${line}"`);
  assert.ok(!shown.some((l) => l.startsWith("hint:")), "no hint: line");
  const ink = tokenLib.gitTokens(T).errorText;
  for (const line of LINES) assert.equal(inkOf(panel, line), ink, `"${line}" is drawn in errorText`);
  m.click(findById(tree, "git-result-copy"));
  const copied = m.cx.clipboard.at(-1);
  assert.equal(typeof copied, "string");
  for (const part of [STDOUT.trim(), ...STDERR.trim().split("\n")]) assert.ok(copied.includes(part), `the copy holds "${part}"`);
});

test("AC50 a rejected exec shows Pull failed and the Git did not answer text", async () => {
  const { m } = scene({ write: (args) => { if (writeIs("pull")(args)) throw new Error("`herdr.exec`: env took longer than 120 s and was stopped"); return null; } });
  const tree = await failedPanel(m);
  assert.ok(texts(findById(tree, "git-result-title")).join(" ").includes("Pull failed"));
  assert.ok(texts(findById(tree, "git-result")).includes("Git did not answer in 120 s. Check the repo in a terminal before you try again."));
});

test("AC50 the panel stays after two more renders and a watch apply, and goes on git-result-close", async () => {
  const { m } = scene({ write: failedPull });
  await failedPanel(m);
  await settle();
  m.render();
  m.render();
  await m.apply();
  const tree = m.render();
  assert.ok(findById(tree, "git-result"), "still shown");
  m.click(findById(tree, "git-result-close"));
  await settle();
  assert.equal(findById(m.render(), "git-result"), null);
});

test("AC50 the panel stays while a card only opens, and goes when the next action runs", async () => {
  const hold = deferred();
  const { repo, m } = scene({ write: (args) => (writeIs("fetch")(args) ? hold.promise : failedPull(args)) });
  await failedPanel(m);
  await settle();
  let tree = m.render();
  m.click(button(tree, "stash"));
  tree = await until(() => { const t = m.render(); return findById(t, "git-confirm") && t; }, "the stash card");
  assert.ok(findById(tree, "git-result"), "opening a card keeps the panel");
  m.click(findById(tree, "git-confirm-no"));
  await settle();
  m.click(button(m.render(), "fetch"));
  await until(() => repo.log.count("fetch") === 1, "the fetch write");
  await settle();
  assert.equal(findById(m.render(), "git-result"), null);
  hold.resolve({ code: 0 });
  await settle();
});

test("AC50 the panel goes on a repo change", async () => {
  const { repo, m } = scene({ write: failedPull });
  await failedPanel(m);
  await settle();
  repo.set({ root: "/work/other" });
  focusRepo("/work/other");
  await m.apply();
  await until(() => !findById(m.render(), "git-result"), "the panel to go");
});

test("AC50 a success never has git-result-copy", async () => {
  const { m } = scene({ write: (args) => (writeIs("pull")(args) ? { code: 0, stdout: "Updating c2..c3\nFast-forward\n" } : null) });
  await confirmAction(m, "pull");
  const tree = await until(() => { const t = m.render(); return findById(t, "git-result") && t; }, "git-result");
  assert.ok(texts(findById(tree, "git-result-title")).join(" ").includes("Pull done"));
  assert.equal(findById(tree, "git-result-copy"), null);
});
