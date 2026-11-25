// The Git tab, graph view (TA11). Smoke test of the kit, then the states (AC12), the layout (AC27, AC28), the rows
// (AC29, AC34, AC35), the filter (AC36), the splitter (AC37), paging (AC16), reloads (AC17) and render safety (AC18).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset, mountGit, fakeRepo, fakeOps, commitsOf, focusRepo, deferred, state, fakeCx, findById, walk, texts, has, call, settle } from "./support/git-kit.js";
import { tokens } from "../mods/herdsidian/tokens.js";
import { ago } from "../mods/herdsidian/diff.js";

const THEME = { foreground: "#eeeeee", background: "#111111", chrome: "#222222", canvas: "#333333", raised: "#2a2a2a", accent: "#ff00aa",
  muted: "#999999", dim: "#555555", hover: "#444444", blocked: "#ffaa00", ansi1: "#ff0001", ansi2: "#00ff02",
  ansi3: "#ffff03", ansi4: "#0000ff", ansi5: "#ff00ff", ansi6: "#00ffff" };
const SOFT = tokens(THEME).accentSoft;

// Every paint_path call a render makes: the lane strokes are drawn through it.
const painted = [];
const realWindow = globalThis.window;
globalThis.window = new Proxy(realWindow, {
  get: (target, key) => (key === "paint_path" ? (...args) => { painted.push(args); return target.paint_path(...args); } : target[key]),
});

beforeEach(() => {
  reset();
  painted.length = 0;
  localStorage.removeItem("git.detail");
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, what) {
  for (let i = 0; i < 60; i++) {
    const value = await check();
    if (value) return value;
    await sleep(15);
  }
  assert.fail(`timed out waiting for ${what}`);
}

// 40 hex characters whose first 7 differ for each n up to 999999.
const HEX = (n) => String(n).padStart(6, "0").padEnd(40, "f");
// A linear history, newest first: `${label} 1` is HEAD. Times are 5.5 minutes and more ago.
const chain = (n, label = "commit", offset = 0) => Array.from({ length: n }, (_, i) => ({
  hash: HEX(offset + i + 1), parents: i + 1 < n ? [HEX(offset + i + 2)] : [], author: "Ada Lovelace", email: "ada@example.com",
  at: Date.now() - 330000 - i * 60000, subject: `${label} ${i + 1}`,
}));

const ROOT = "/work/repo";
const logCalls = (repo) => repo.calls.filter(([cmd, args]) => cmd === "git" && args.includes("--topo-order"));
const lastLog = (repo) => logCalls(repo).at(-1)[1];
const nOf = (args) => args[args.indexOf("-n") + 1];
const skipOf = (args) => args.find((a) => a.startsWith("--skip="));
const isLog = (cmd, args) => cmd === "git" && args.includes("--topo-order");

// The rows of git-rows: the list, its keys and the elements its renderer builds.
const vlist = (tree) => walk(tree).find((n) => n.kind === "vlist" && (n.arg.id === "git-rows" || n.nodeId === "git-rows"));
const keysOf = (tree) => { const l = vlist(tree); return l ? Array.from({ length: l.arg.count }, (_, i) => l.arg.key(i)) : []; };
const rowsOfTree = (tree) => { const l = vlist(tree); return l ? l.arg.render({ start: 0, end: l.arg.count }, fakeCx()) : []; };
const rowOf = (tree, key) => rowsOfTree(tree)[keysOf(tree).indexOf(key)];
const rowsText = (tree) => rowsOfTree(tree).flatMap((r) => texts(r));
const joined = (node) => texts(node).join(" ");
const commitKeys = (tree) => keysOf(tree).filter((k) => k !== "wip" && k !== "more");
const heightOf = (node) => node.calls.filter(([n]) => n === "h").at(-1)?.[1][0];
const looksSelected = (row) => walk(row).some((n) => has(n, "bg", SOFT)) && walk(row).some((n) => has(n, "bg", THEME.accent) && has(n, "w", 2));

// A repo on main with 3 commits and one remote, the tab mounted and the graph drawn.
async function open(spec = {}, opts = {}) {
  const repo = fakeRepo({ commits: chain(3), remotes: ["origin"], ...spec });
  const m = mountGit({ theme: THEME, ...opts });
  const tree = await until(() => { const t = m.render(); return vlist(t) && t; }, "the graph");
  return { repo, m, tree };
}

// Delays the answer of the first call that `match` takes (the answer itself is computed at once) until release().
function holdFirst(match) {
  const inner = state.exec, gate = deferred();
  let taken = false;
  state.exec = async (cmd, args, opts) => {
    const reply = await inner(cmd, args, opts);
    if (!taken && match(cmd, args)) { taken = true; await gate.promise; }
    return reply;
  };
  return { release: () => gate.resolve(), held: () => taken };
}

test("kit smoke: the tab mounts on a 3-commit repo and draws tab-git", async () => {
  fakeRepo({ commits: commitsOf("c3 <- c2 | third\nc2 <- c1 | second\nc1 <- | first") });
  const m = mountGit();
  assert.ok(findById(m.render(), "tab-git"));
});

// AC12
test("AC12: Loading history shows alone while the first read runs", async () => {
  fakeRepo({ commits: chain(3), remotes: ["origin"] });
  const m = mountGit({ theme: THEME });
  const tree = m.render();
  assert.ok(texts(findById(tree, "git-message")).includes("Loading history…"));
  for (const id of ["git-header", "git-actions", "git-graph", "git-rows"]) assert.equal(findById(tree, id), null, id);
});

test("AC12: Loading history also shows while only the log is still running", async () => {
  fakeRepo({ commits: chain(3), remotes: ["origin"] });
  const hold = holdFirst(isLog);
  const m = mountGit({ theme: THEME });
  m.render();
  await until(() => hold.held(), "the log read");
  const tree = m.render();
  assert.ok(texts(findById(tree, "git-message")).includes("Loading history…"));
  assert.equal(findById(tree, "git-graph"), null);
  assert.equal(findById(tree, "git-actions"), null);
  hold.release();
});

test("AC12: No folder shows alone", async () => {
  fakeRepo({ commits: chain(3), focus: false });
  const m = mountGit({ theme: THEME });
  m.render();
  await settle();
  const tree = m.render();
  assert.ok(texts(findById(tree, "git-message")).includes("No folder"));
  for (const id of ["git-header", "git-actions", "git-graph"]) assert.equal(findById(tree, id), null, id);
});

test("AC12: Not a git repository shows alone", async () => {
  fakeRepo({ commits: chain(3), fail: ["top"] });
  const m = mountGit({ theme: THEME });
  m.render();
  await settle();
  const tree = m.render();
  assert.ok(texts(findById(tree, "git-message")).includes("Not a git repository"));
  for (const id of ["git-header", "git-actions", "git-graph"]) assert.equal(findById(tree, id), null, id);
});

test("AC12: Cannot read the git folder shows alone when the git dir read fails", async () => {
  fakeRepo({ commits: chain(3), fail: ["dirs"] });
  const m = mountGit({ theme: THEME });
  const tree = await until(() => { const t = m.render(); return texts(findById(t, "git-message")).includes("Cannot read the git folder") && t; }, "the message");
  for (const id of ["git-header", "git-actions", "git-graph"]) assert.equal(findById(tree, id), null, id);
});

test("AC12: a git error shows its first line alone", async () => {
  fakeRepo({ commits: chain(3), fail: ["log"] });
  const m = mountGit({ theme: THEME });
  const tree = await until(() => { const t = m.render(); return texts(findById(t, "git-message")).some((s) => s.includes("fake log failure")) && t; }, "the error");
  for (const id of ["git-header", "git-actions", "git-graph"]) assert.equal(findById(tree, id), null, id);
});

test("AC12: a repo with no commit says No commits yet, keeps the header and actions, enables only Fetch and runs no log", async () => {
  const repo = fakeRepo({ commits: [], remotes: ["origin"] });
  const m = mountGit({ theme: THEME });
  const tree = await until(() => { const t = m.render(); return texts(findById(t, "git-message")).includes("No commits yet on main") && t; }, "the message");
  assert.ok(findById(tree, "git-header"));
  assert.ok(findById(tree, "git-actions"));
  assert.equal(findById(tree, "git-graph"), null);
  assert.ok(findById(tree, "git-act-fetch").onClick, "Fetch is enabled");
  for (const action of ["pull", "push", "branch", "stash", "pop"]) assert.equal(findById(tree, `git-act-${action}`).onClick, null, action);
  await settle();
  assert.equal(repo.log.count("log"), 0);
});

test("AC12: the loaded graph has no message and every part of the tab", async () => {
  const { tree } = await open();
  assert.equal(findById(tree, "git-message"), null);
  for (const id of ["git-header", "git-actions", "git-filter", "git-graph", "git-splitter", "git-detail"]) assert.ok(findById(tree, id), id);
});

// AC27
test("AC27: the tab goes header, actions, filter, graph, splitter, detail", async () => {
  const { tree } = await open();
  const order = ["git-header", "git-actions", "git-filter", "git-graph", "git-splitter", "git-detail"].map((id) => walk(tree).indexOf(findById(tree, id)));
  assert.ok(order.every((at) => at >= 0), "all drawn");
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

// AC28
test("AC28: the header shows the branch, the ahead and behind counts above 0 and no wide-mode button", async () => {
  const { tree } = await open({ upstream: { remote: "origin", ref: "refs/heads/main", short: "origin/main" }, ahead: 2, behind: 3 });
  const header = findById(tree, "git-header");
  assert.ok(texts(header).includes("main"));
  assert.deepEqual(texts(findById(tree, "git-ahead")), ["↑2"]);
  assert.deepEqual(texts(findById(tree, "git-behind")), ["↓3"]);
  assert.equal(findById(tree, "git-no-upstream"), null);
  assert.ok(walk(header).every((n) => !n.onClick), "no button in the header");
  assert.ok(walk(tree).every((n) => !/wide/i.test(n.nodeId ?? "")), "no wide-mode id");
});

test("AC28: an ahead or behind count of 0 is not drawn", async () => {
  const { tree } = await open({ upstream: { remote: "origin", ref: "refs/heads/main", short: "origin/main" }, ahead: 0, behind: 3 });
  assert.equal(findById(tree, "git-ahead"), null);
  assert.deepEqual(texts(findById(tree, "git-behind")), ["↓3"]);
});

test("AC28: a branch with no upstream shows No upstream in t.muted", async () => {
  const { tree } = await open();
  const note = findById(tree, "git-no-upstream");
  assert.ok(texts(note).includes("No upstream"));
  assert.ok(has(note, "text_color", THEME.muted));
  assert.equal(findById(tree, "git-ahead"), null);
  assert.equal(findById(tree, "git-behind"), null);
});

test("AC28: a detached HEAD shows detached HEAD and the 7-character hash, with no No upstream", async () => {
  const { tree } = await open({ branch: null });
  assert.ok(joined(findById(tree, "git-header")).includes(`detached HEAD ${HEX(1).slice(0, 7)}`));
  assert.equal(findById(tree, "git-no-upstream"), null);
});

// AC29
test("AC29: a commit row is 24 px high with the subject on one line and the time in t.muted", async () => {
  const { tree } = await open();
  const sizes = vlist(tree).arg.sizes;
  assert.ok(sizes === 24 || (Array.isArray(sizes) && sizes.every((s) => s === 24)), "the list sizes are 24");
  const row = rowOf(tree, HEX(1));
  assert.ok(has(row, "h", 24));
  const subject = "commit 1";
  assert.ok(texts(row).includes(subject));
  assert.ok(walk(row).some((n) => call(n, "truncate") && joined(n).includes(subject)), "the subject is truncated");
  const time = ago(Date.now() - 330000, Date.now());
  assert.ok(texts(row).includes(time), `the time ${time}`);
  assert.ok(walk(row).some((n) => has(n, "text_color", THEME.foreground) && texts(n).includes(time)), "the selected row's time is t.foreground");
  const other = rowOf(tree, HEX(2));
  const otherTime = ago(Date.now() - 390000, Date.now());
  assert.ok(texts(other).includes(otherTime), `the time ${otherTime}`);
  assert.ok(walk(other).some((n) => has(n, "text_color", THEME.muted) && texts(n).includes(otherTime)), "an unselected row's time is t.muted");
});

test("AC29: a commit with one ref shows its pill and no +N", async () => {
  const { tree } = await open();
  const row = rowOf(tree, HEX(1));
  assert.ok(texts(row).includes("main"));
  assert.ok(texts(row).every((s) => !/^\+\d+$/.test(s)));
});

test("AC29: a commit with three refs shows one pill and +2", async () => {
  const refs = [{ kind: "local", name: "main", sha: HEX(1) }, { kind: "remote", name: "origin/main", sha: HEX(1) }, { kind: "tag", name: "v1", sha: HEX(1) }];
  const { tree } = await open({ refs });
  const row = rowOf(tree, HEX(1));
  assert.equal(texts(row).filter((s) => ["main", "origin/main", "v1"].includes(s)).length, 1);
  assert.ok(texts(row).includes("+2"));
});

test("AC29: a commit with no ref shows no pill and no +N", async () => {
  const { tree } = await open();
  const row = rowOf(tree, HEX(2));
  assert.ok(texts(row).every((s) => !/^\+\d+$/.test(s) && !["main", "origin/main", "v1"].includes(s)));
});

// AC34
test("AC34: the uncommitted row shows the count and the totals, and comes first", async () => {
  const { m } = await open({ changed: [{ path: "a.txt", add: 3, del: 1 }, { path: "b.txt", add: 1, del: 2 }] });
  const tree = await until(() => { const t = m.render(); return keysOf(t)[0] === "wip" && t; }, "the wip row");
  const text = joined(rowOf(tree, "wip"));
  assert.ok(text.includes("2 uncommitted files"));
  assert.ok(text.includes("+4"));
  assert.ok(text.includes("−3"));
  assert.equal(keysOf(tree)[1], HEX(1));
});

test("AC34: one file says 1 uncommitted file and a 0 part is not drawn", async () => {
  const { m } = await open({ changed: [{ path: "a.txt", add: 5, del: 0 }] });
  const tree = await until(() => { const t = m.render(); return keysOf(t)[0] === "wip" && t; }, "the wip row");
  const text = joined(rowOf(tree, "wip"));
  assert.ok(text.includes("1 uncommitted file"));
  assert.ok(text.includes("+5"));
  assert.ok(!text.includes("−"));
});

test("AC34: a click on the uncommitted row selects the Changes tab and no commit", async () => {
  const { m } = await open({ changed: [{ path: "a.txt", add: 3, del: 1 }] });
  const tree = await until(() => { const t = m.render(); return keysOf(t)[0] === "wip" && t; }, "the wip row");
  m.itemClick(tree, "wip");
  assert.deepEqual(m.selected, ["changes"]);
  const after = m.render();
  assert.ok(texts(findById(after, "git-detail-hash")).includes(HEX(1).slice(0, 7)), "HEAD stays selected");
  assert.equal(looksSelected(rowOf(after, "wip")), false);
});

test("AC34: with a count of 0 the row is absent", async () => {
  const { tree } = await open();
  assert.ok(!keysOf(tree).includes("wip"));
  assert.equal(keysOf(tree)[0], HEX(1));
});

// AC35
test("AC35: HEAD is selected when the tab opens, with the selected background and the 2 px accent bar", async () => {
  const { tree } = await open();
  assert.ok(looksSelected(rowOf(tree, HEX(1))));
  assert.equal(looksSelected(rowOf(tree, HEX(2))), false);
  assert.ok(texts(findById(tree, "git-detail-subject")).includes("commit 1"));
});

test("AC35: a click on a commit row selects it", async () => {
  const { m, tree } = await open();
  m.itemClick(tree, HEX(2));
  const after = m.render();
  assert.ok(looksSelected(rowOf(after, HEX(2))));
  assert.equal(looksSelected(rowOf(after, HEX(1))), false);
  assert.ok(texts(findById(after, "git-detail-subject")).includes("commit 2"));
});

test("AC35: a reload that drops the selected commit selects HEAD", async () => {
  const { repo, m, tree } = await open();
  m.itemClick(tree, HEX(3));
  assert.ok(texts(findById(m.render(), "git-detail-subject")).includes("commit 3"));
  const [first, second] = chain(3);
  repo.set({ commits: [{ ...chain(1, "fresh", 500)[0], parents: [HEX(1)] }, first, { ...second, parents: [] }] });
  await m.apply();
  const after = await until(() => { const t = m.render(); return keysOf(t)[0] === HEX(501) && t; }, "the new history");
  assert.ok(!keysOf(after).includes(HEX(3)));
  assert.ok(looksSelected(rowOf(after, HEX(501))));
  assert.ok(texts(findById(after, "git-detail-subject")).includes("fresh 1"));
});

// AC36
const FOUR = () => [
  { ...chain(4)[0], subject: "fix login bug", author: "Ada Lovelace", email: "ada@example.com" },
  { ...chain(4)[1], subject: "add search", author: "Grace Hopper", email: "grace@navy.example" },
  { ...chain(4)[2], subject: "fix typo", author: "Ada Lovelace", email: "ada@example.com" },
  { ...chain(4)[3], subject: "write docs", author: "Ada Lovelace", email: "ada@example.com" },
];
const filterInput = (tree) => walk(findById(tree, "git-filter")).find((n) => n.kind === "input").arg;

test("AC36: a filter hides the rows that do not match, shows the note and brings the graph back when emptied", async () => {
  const { m, tree } = await open({ commits: FOUR() });
  assert.equal(findById(tree, "git-filter-note"), null);
  m.type(filterInput(tree), "fix");
  const filtered = m.render();
  assert.deepEqual(commitKeys(filtered), [HEX(1), HEX(3)]);
  assert.ok(texts(findById(filtered, "git-filter-note")).includes("2 of 4 loaded commits"));
  m.type(filterInput(filtered), "");
  const back = m.render();
  assert.deepEqual(commitKeys(back), [HEX(1), HEX(2), HEX(3), HEX(4)]);
  assert.equal(findById(back, "git-filter-note"), null);
});

for (const [what, query, expected] of [
  ["the author name, in any case", "GRACE", [2]],
  ["the author email", "navy.example", [2]],
  ["a hash prefix", HEX(3).slice(0, 8), [3]],
  ["the subject, in any case", "FIX", [1, 3]],
]) {
  test(`AC36: the filter matches ${what}`, async () => {
    const { m, tree } = await open({ commits: FOUR() });
    m.type(filterInput(tree), query);
    assert.deepEqual(commitKeys(m.render()), expected.map(HEX));
  });
}

test("AC36: the filter matches a ref name", async () => {
  const refs = [{ kind: "local", name: "main", sha: HEX(1) }, { kind: "tag", name: "release-2", sha: HEX(3) }];
  const { m, tree } = await open({ commits: FOUR(), refs });
  m.type(filterInput(tree), "release");
  assert.deepEqual(commitKeys(m.render()), [HEX(3)]);
});

test("AC36: with a filter no lane is drawn, and without it lanes are drawn", async () => {
  const { m, tree } = await open({ commits: FOUR() });
  painted.length = 0;
  rowsOfTree(tree);
  assert.ok(painted.length > 0, "lanes are drawn without a filter");
  m.type(filterInput(tree), "fix");
  const filtered = m.render();
  painted.length = 0;
  rowsOfTree(filtered);
  assert.equal(painted.length, 0, "no lane op with a filter");
  m.type(filterInput(filtered), "");
  painted.length = 0;
  rowsOfTree(m.render());
  assert.ok(painted.length > 0, "lanes are back");
});

// AC37
const resized = async (spec) => {
  const { m, tree } = await open(spec);
  m.resize(tree, 400, 600);
  return { m, tree: m.render() };
};

test("AC37: the detail is 220 px at first", async () => {
  const { tree } = await resized();
  assert.equal(heightOf(findById(tree, "git-detail")), 220);
});

test("AC37: a drag up makes the detail higher by the distance and writes git.detail", async () => {
  const { m, tree } = await resized();
  m.drag(tree, 400, 360);
  const after = m.render();
  assert.equal(heightOf(findById(after, "git-detail")), 260);
  assert.equal(Number(localStorage.getItem("git.detail")), 260);
});

test("AC37: a drag far up keeps the graph at 96 px or more", async () => {
  const { m, tree } = await resized();
  m.drag(tree, 400, -5000);
  const height = heightOf(findById(m.render(), "git-detail"));
  assert.ok(height > 260 && height <= 600 - 96, `detail ${height}`);
  assert.equal(Number(localStorage.getItem("git.detail")), height);
});

test("AC37: a drag far down keeps the detail at 120 px", async () => {
  const { m, tree } = await resized();
  m.drag(tree, 400, 9000);
  assert.equal(heightOf(findById(m.render(), "git-detail")), 120);
  assert.equal(Number(localStorage.getItem("git.detail")), 120);
});

test("AC37: the stored detail height is used after a restart", async () => {
  localStorage.setItem("git.detail", "300");
  const { tree } = await resized();
  assert.equal(heightOf(findById(tree, "git-detail")), 300);
});

// AC16
test("AC16: a page of 300 keeps Load more at the end, and a click adds one log with --skip=300", async () => {
  const { repo, m, tree } = await open({ commits: chain(450) });
  assert.equal(commitKeys(tree).length, 300);
  assert.equal(keysOf(tree).at(-1), "more");
  assert.ok(texts(rowOf(tree, "more")).includes("Load more"));
  const before = repo.log.count("log");
  m.itemClick(tree, "more");
  const after = await until(() => { const t = m.render(); return commitKeys(t).length === 450 && t; }, "the second page");
  assert.equal(repo.log.count("log") - before, 1);
  assert.equal(nOf(lastLog(repo)), "300");
  assert.equal(skipOf(lastLog(repo)), "--skip=300");
  assert.ok(!keysOf(after).includes("more"), "a page of 150 removes it");
  assert.equal(new Set(keysOf(after)).size, keysOf(after).length);
});

test("AC16: a page of 120 has no Load more", async () => {
  const { tree } = await open({ commits: chain(120) });
  assert.equal(commitKeys(tree).length, 120);
  assert.ok(!keysOf(tree).includes("more"));
});

test("AC16: a page of 0 removes Load more and changes nothing else", async () => {
  const { m, tree } = await open({ commits: chain(300) });
  assert.equal(keysOf(tree).at(-1), "more");
  const before = commitKeys(tree);
  m.itemClick(tree, "more");
  const after = await until(() => { const t = m.render(); return !keysOf(t).includes("more") && t; }, "Load more to go");
  assert.deepEqual(commitKeys(after), before);
});

test("AC16: a hash that comes again in the next page is listed once", async () => {
  const first = chain(300);
  const { m, tree } = await open({ commits: [...first, { ...first[4] }, ...chain(1, "tail", 900)] });
  m.itemClick(tree, "more");
  const after = await until(() => { const t = m.render(); return keysOf(t).includes(HEX(901)) && t; }, "the second page");
  assert.equal(keysOf(after).filter((k) => k === HEX(5)).length, 1);
  assert.equal(new Set(keysOf(after)).size, keysOf(after).length);
});

test("AC16: when the refs changed, Load more reloads from the start with -n loaded + 300 and no --skip", async () => {
  const old = chain(300);
  const { repo, m, tree } = await open({ commits: old });
  const before = repo.log.count("log");
  repo.set({ commits: [{ ...chain(1, "fresh", 700)[0], parents: [HEX(1)] }, ...old] });
  m.itemClick(tree, "more");
  await until(() => repo.log.count("log") > before, "a log read");
  await settle();
  assert.equal(repo.log.count("log") - before, 1);
  assert.equal(nOf(lastLog(repo)), "600");
  assert.equal(skipOf(lastLog(repo)), undefined);
  const after = m.render();
  assert.equal(keysOf(after)[0], HEX(701));
  assert.equal(new Set(keysOf(after)).size, keysOf(after).length);
});

// AC17
test("AC17: the tab shown again reloads once with -n 300", async () => {
  const { repo, m } = await open();
  const before = repo.log.count("log");
  m.leave();
  m.render();
  await until(() => repo.log.count("log") > before, "a log read");
  await settle();
  assert.equal(repo.log.count("log") - before, 1);
  assert.equal(nOf(lastLog(repo)), "300");
});

test("AC17: a reload keeps the commits already loaded (-n 450 after Load more)", async () => {
  const { repo, m, tree } = await open({ commits: chain(450) });
  m.itemClick(tree, "more");
  await until(() => commitKeys(m.render()).length === 450, "the second page");
  const before = repo.log.count("log");
  m.leave();
  m.render();
  await until(() => repo.log.count("log") > before, "a log read");
  assert.equal(nOf(lastLog(repo)), "450");
  assert.equal(skipOf(lastLog(repo)), undefined);
});

test("AC17: the end of an action reloads once", async () => {
  const { repo, m, tree } = await open();
  const before = repo.log.count("log");
  m.click(findById(tree, "git-act-fetch"));
  await until(() => repo.log.count("log") > before, "a log read");
  await settle();
  assert.equal(repo.log.count("fetch"), 1);
  assert.equal(repo.log.count("log") - before, 1);
});

test("AC17: another focused repo reloads its history", async () => {
  const { repo, m } = await open();
  const before = repo.log.count("log");
  repo.set({ root: "/work/other", commits: chain(3, "other", 300) });
  focusRepo("/work/other");
  await m.apply();
  const tree = await until(() => { const t = m.render(); return keysOf(t)[0] === HEX(301) && t; }, "the other history");
  assert.ok(repo.log.count("log") > before);
  assert.ok(lastLog(repo).includes("/work/other"));
  assert.ok(rowsText(tree).includes("other 1"));
});

test("AC17: a watch read with changed refs reloads once", async () => {
  const { repo, m } = await open();
  const before = repo.log.count("log");
  repo.set({ commits: [{ ...chain(1, "fresh", 800)[0], parents: [HEX(1)] }, ...chain(3)] });
  await m.apply();
  await until(() => repo.log.count("log") > before, "a log read");
  await settle();
  assert.equal(repo.log.count("log") - before, 1);
  assert.equal(nOf(lastLog(repo)), "300");
  assert.equal(keysOf(m.render())[0], HEX(801));
});

test("AC17: a watch read with the same refs runs no log", async () => {
  const { repo, m } = await open();
  const before = repo.log.count("log");
  await m.apply();
  m.render();
  await settle();
  assert.equal(repo.log.count("log"), before);
});

// AC18
test("AC18: render makes no exec and no file read in the same tick", async () => {
  const repo = fakeRepo({ commits: chain(3), remotes: ["origin"] });
  const ops = fakeOps();
  const m = mountGit({ theme: THEME });
  const calls = repo.calls.length, reads = ops.calls.length;
  const tree = m.render();
  assert.ok(findById(tree, "tab-git"), "render answers a tree, not a promise");
  assert.equal(repo.calls.length, calls);
  assert.equal(ops.calls.length, reads);
  await until(() => vlist(m.render()), "the graph");
  const settled = repo.calls.length, files = ops.calls.length;
  m.render();
  assert.equal(repo.calls.length, settled);
  assert.equal(ops.calls.length, files);
});

test("AC18: an answer for another repo is dropped", async () => {
  const live = fakeRepo({ commits: chain(3, "A"), remotes: ["origin"] });
  const hold = holdFirst((cmd, args) => isLog(cmd, args) && args.includes(ROOT));
  const m = mountGit({ theme: THEME });
  m.render();
  await until(() => hold.held(), "the first log read");
  live.set({ root: "/work/other", commits: chain(3, "B", 1000) });
  focusRepo("/work/other");
  await m.apply();
  await until(() => rowsText(m.render()).includes("B 1"), "the other repo");
  hold.release();
  await settle();
  const text = rowsText(m.render());
  assert.ok(text.includes("B 1"));
  assert.ok(text.every((s) => !s.startsWith("A ")), "nothing of the first repo");
});

test("AC18: an answer to an older request is dropped", async () => {
  const live = fakeRepo({ commits: chain(3, "old"), remotes: ["origin"] });
  const hold = holdFirst(isLog);
  const m = mountGit({ theme: THEME });
  m.render();
  await until(() => hold.held(), "the first log read");
  live.set({ commits: chain(3, "new", 100) });
  m.leave();
  m.render();
  await m.apply();
  await until(() => rowsText(m.render()).includes("new 1"), "the newer answer");
  hold.release();
  await settle();
  const text = rowsText(m.render());
  assert.ok(text.includes("new 1"));
  assert.ok(text.every((s) => !s.startsWith("old ")), "nothing of the older request");
});
