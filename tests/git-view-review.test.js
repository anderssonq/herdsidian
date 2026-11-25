// The Git tab after the Opus review of C10: a running write always redraws (M1), a drag ends when the button is up or the
// splitter goes (m1), the clamp counts the card above the graph (m2), a failed detail read is read again (m3), and a kept
// diff key after a repo change does nothing (m5). Import the kit before anything else (R6).
import { mountGit, fakeRepo, fakeOps, focusRepo, deferred, commitsOf, reset, state, findById, walk, texts, settle } from "./support/git-kit.js";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

beforeEach(() => { reset(); state.toasts = []; localStorage.removeItem("git.detail"); });

const T = { foreground: "#eeeeee", background: "#111111", chrome: "#222222", canvas: "#333333", raised: "#2a2a2a", accent: "#ff00aa",
  muted: "#999999", dim: "#555555", hover: "#444444", blocked: "#ffaa00", ansi1: "#ff0001", ansi2: "#00ff02",
  ansi3: "#ffff03", ansi4: "#0000ff", ansi5: "#ff00ff", ansi6: "#00ffff" };

const COMMITS = commitsOf(`
  c3 <- c2 | third | Ann Lee <ann@example.com>
  c2 <- c1 | second | Ann Lee <ann@example.com>
  c1 <- | first | Ann Lee <ann@example.com>
`);
const PATCH = ["diff --git a/a.txt b/a.txt", "--- a/a.txt", "+++ b/a.txt", "@@ -1 +1 @@", "-old", "+new", ""].join("\n");
// A repo where every action is enabled, and HEAD (c3) changes one file.
const BASE = { commits: COMMITS, upstream: { remote: "origin", ref: "refs/heads/main", short: "origin/main" }, ahead: 2, behind: 0,
  remotes: ["origin"], changed: 3, stash: { hash: "5".repeat(40), message: "On main: wip" },
  files: { c3: [{ path: "a.txt", status: "modified", add: 1, del: 1 }], c2: [{ path: "b.txt", status: "added", add: 1, del: 0 }] },
  patches: { "c3:a.txt": PATCH } };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, what) {
  for (let i = 0; i < 60; i++) {
    const value = await check();
    if (value) return value;
    await sleep(15);
  }
  return assert.fail(`timed out waiting for ${what}`);
}

function scene(over = {}) {
  fakeOps();
  const repo = fakeRepo({ ...BASE, ...over });
  const m = mountGit({ theme: T });
  return { repo, m };
}

// The tab with the graph, HEAD's files and enabled buttons.
const ready = (m) => until(() => { const t = m.render(); return findById(t, "git-file-a.txt") && findById(t, "git-act-pull")?.onClick && t; }, "the graph and the detail");

const handlerOf = (node, name, button) => node?.calls.find(([n, a]) => n === name && (button === undefined || a[0] === button))?.[1].at(-1);
const anywhere = (tree, name, button) => walk(tree).map((n) => handlerOf(n, name, button)).find(Boolean);
const heightOf = (tree) => findById(tree, "git-detail").calls.filter(([n]) => n === "h").at(-1)?.[1][0];
const at = (y, pressed = "left") => ({ position: { x: 0, y }, local_position: { x: 0, y: 0 }, modifiers: {}, pressed_button: pressed });

// A press on git-splitter at y, then kept handlers to move and release with.
function press(m, tree, y) {
  const down = handlerOf(findById(tree, "git-splitter"), "on_mouse_down", "left");
  const move = anywhere(tree, "on_window_mouse_move") ?? anywhere(tree, "on_mouse_move");
  m.cx.notify = () => {};
  m.click({ onClick: (_e, c) => down({ button: "left", click_count: 1, ...at(y) }, c) });
  return { move: (y, pressed) => m.click({ onClick: (_e, c) => move(at(y, pressed), c) }) };
}

// ---- M1: the running write redraws, and a dead context cannot turn it into a failure

test("M1 a second confirm click while the re-check runs: a redraw still shows the buttons disabled while the write runs", async () => {
  const hold = deferred();
  const { repo, m } = scene({ write: (args) => (args.includes("pull") ? hold.promise : null) });
  const tree = await ready(m);
  m.click(findById(tree, "git-act-pull"));
  const card = m.render();
  // Each redraw the tab asks for: is Fetch drawn disabled (an action running) at that moment?
  let runningRedraws = 0;
  m.cx.notify = () => { if (findById(m.render(), "git-act-fetch")?.onClick === null) runningRedraws++; };
  const yes = findById(card, "git-confirm-yes");
  m.click(yes);
  m.click(yes);
  await until(() => repo.log.count("pull") === 1, "the pull write");
  await settle();
  assert.ok(runningRedraws > 0, "a redraw while the write runs");
  hold.resolve({ code: 0, stdout: "Already up to date.\n" });
  await settle();
});

test("M1 a redraw that throws while the write runs does not turn a finished Pull into a failure, and Pull runs once", async () => {
  const { repo, m } = scene({ write: () => ({ code: 0, stdout: "Already up to date.\n" }) });
  const tree = await ready(m);
  m.click(findById(tree, "git-act-pull"));
  // A dead context: the first redraw asked for while the Pull runs throws.
  let thrown = false;
  m.cx.notify = () => {
    if (m.tab.gate.running && !thrown) { thrown = true; throw new Error("stale context: cx.notify used after its call returned"); }
  };
  m.click(findById(m.render(), "git-confirm-yes"));
  const done = await until(() => { const t = m.render(); return findById(t, "git-result") && t; }, "git-result");
  assert.ok(thrown, "a redraw threw while the Pull ran");
  assert.deepEqual(texts(findById(done, "git-result-title")), ["Pull done"]);
  assert.equal(repo.log.count("pull"), 1);
});

// ---- m1: a drag ends when the button is up, the repo changes or the splitter is gone

test("m1 a move with no button pressed ends the drag and keeps the height reached", async () => {
  const { m } = scene();
  let tree = await ready(m);
  m.resize(tree, 400, 600);
  tree = m.render();
  const drag = press(m, tree, 400);
  drag.move(360);
  assert.equal(heightOf(m.render()), 260);
  drag.move(300, null);
  assert.equal(heightOf(m.render()), 260, "a move after a release outside the window does not drag");
  assert.equal(Number(localStorage.getItem("git.detail")), 260, "the height is stored as on a release");
  drag.move(200);
  assert.equal(heightOf(m.render()), 260, "the drag stays ended");
});

test("m1 a repo change ends a drag: a later move does not resize", async () => {
  const { repo, m } = scene();
  let tree = await ready(m);
  m.resize(tree, 400, 600);
  tree = m.render();
  const drag = press(m, tree, 400);
  drag.move(360);
  repo.set({ root: "/work/other" });
  focusRepo("/work/other");
  await m.apply();
  // Read before any render: the repo change itself ends the drag and stores the height reached.
  assert.equal(Number(localStorage.getItem("git.detail")), 260, "the repo change stored the height");
  drag.move(300);
  assert.equal(Number(localStorage.getItem("git.detail")), 260);
  await until(() => findById(m.render(), "git-detail"), "the other repo");
  assert.equal(heightOf(m.render()), 260);
});

test("m1 a drag ends when the splitter is not drawn (a commit diff opened)", async () => {
  const { m } = scene();
  let tree = await ready(m);
  m.resize(tree, 400, 600);
  tree = m.render();
  const drag = press(m, tree, 400);
  drag.move(360);
  m.click(findById(m.render(), "git-file-a.txt"));
  await until(() => findById(m.render(), "diff-view"), "the diff");
  drag.move(300);
  m.key(m.render(), "escape");
  assert.equal(heightOf(m.render()), 260);
});

// ---- m2: the card above the graph counts in the clamp

test("m2 with a 200 px result panel above the graph, a far drag up still leaves the graph 96 px", async () => {
  const { m } = scene({ write: (args) => (args.includes("fetch") ? { code: 1, stderr: "fatal: no network\n" } : null) });
  let tree = await ready(m);
  m.resize(tree, 400, 600);
  m.click(findById(m.render(), "git-act-fetch"));
  tree = await until(() => { const t = m.render(); return findById(t, "git-result") && t; }, "git-result");
  const box = walk(tree).find((n) => n.nodeId !== "tab-git" && handlerOf(n, "on_size_change") && findById(n, "git-result"));
  assert.ok(box, "the panel's height is measured");
  m.click({ onClick: (_e, c) => handlerOf(box, "on_size_change")({ width: 400, height: 200 }, c) });
  tree = m.render();
  m.drag(tree, 400, -5000);
  const height = heightOf(m.render());
  assert.ok(height <= 600 - 200 - 96, `detail ${height} leaves the graph 96 px`);
});

test("m2 the measured card box has the stable id git-between", async () => {
  const { m } = scene({ write: (args) => (args.includes("fetch") ? { code: 1, stderr: "fatal: no network\n" } : null) });
  await ready(m);
  m.click(findById(m.render(), "git-act-fetch"));
  const tree = await until(() => { const t = m.render(); return findById(t, "git-result") && t; }, "git-result");
  const box = walk(tree).find((n) => n.nodeId !== "tab-git" && handlerOf(n, "on_size_change") && findById(n, "git-result"));
  assert.equal(box?.nodeId, "git-between");
});

test("m2 the filter note takes its room from the detail, not from the graph", async () => {
  const { m } = scene();
  let tree = await ready(m);
  m.resize(tree, 400, 600);
  m.drag(m.render(), 400, -5000);
  const open = heightOf(m.render());
  const input = walk(findById(m.render(), "git-filter")).find((n) => n.kind === "input").arg;
  m.type(input, "third");
  tree = m.render();
  assert.ok(findById(tree, "git-filter-note"), "the note shows");
  const filtered = heightOf(tree);
  assert.ok(open - filtered >= 15, `the detail gives up the note's height (${open} without a filter, ${filtered} with one)`);
});

// ---- m3: a failed detail read is not kept

test("m3 a rejected file read is read again when the commit is selected again", async () => {
  const { repo, m } = scene({ reject: ["files"] });
  let tree = await until(() => { const t = m.render(); return findById(t, "git-files-error") && t; }, "the detail error");
  repo.set({ reject: [] });
  m.itemClick(tree, "c2");
  await until(() => findById(m.render(), "git-file-b.txt"), "the files of c2");
  m.itemClick(m.render(), "c3");
  tree = await until(() => { const t = m.render(); return findById(t, "git-file-a.txt") && t; }, "the files of c3 read again");
  assert.ok(findById(tree, "git-file-a.txt"));
});

// ---- m5: a kept diff key after the repo changed

test("m5 a kept diff key after a repo change does nothing and does not throw", async () => {
  const { repo, m } = scene();
  await ready(m);
  m.click(findById(m.render(), "git-file-a.txt"));
  const open = await until(() => { const t = m.render(); return findById(t, "diff-view") && t; }, "the diff");
  repo.set({ root: "/work/other" });
  focusRepo("/work/other");
  await m.apply();
  await until(() => !findById(m.render(), "diff-view"), "the diff to close");
  assert.doesNotThrow(() => m.key(open, "]"));
  assert.doesNotThrow(() => m.key(open, "escape"));
});
