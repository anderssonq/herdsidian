// The Changes tab V2, the data it shows: the total (AC4), when a patch is
// read (AC33) and the untracked whole-file read (AC34).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mount, fakeGit, fakeFiles, reset, world, state, findById, walk, texts, has, rowsOf, settle } from "./support/changes-kit.js";

beforeEach(reset);

const ROOT = "/work/repo";
const T = { ansi1: "#ff0001", ansi2: "#00ff02" };

// An agent in a pane, as herdr.agents() gives it.
const agent = (pane, key, name, address = `w1:${pane}`) => ({ address, pane, status: "idle", program: { key, name } });
const claude = (pane = "p1") => agent(pane, "claude", "Claude Code");
const pane = (id = "p1", cwd = ROOT) => ({ pane: id, cwd, pane_name: `pane ${id}` });

// The session script's output for one prompt and its turn files (still JSON-escaped, as the script prints).
const turn = (prompt, paths = []) => async () =>
  [`P ${JSON.stringify("2026-11-25T10:00:00.000Z")}`, `T ${JSON.stringify(prompt)}`, ...paths.map((p) => `F ${JSON.stringify(p)}`)].join("\n") + "\n";

const STATUS = "## main\0 M a.txt\0 M c.txt\0 M d.txt\0";
const NUMSTAT = "3\t1\ta.txt\0" + "2\t0\tc.txt\0" + "1\t4\td.txt\0";
const PATCH = (path) => `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1,2 @@\n one\n+two\n`;

// The focused pane p1 in ROOT; the sidebar store says the Changes tab is shown.
function scene({ status = STATUS, numstat = NUMSTAT, session = turn("fix the bug"), agentList = [claude()], paneList = [pane()], patches = {}, fail = null } = {}) {
  Object.assign(world, { spaces: [{ id: "s1", active: true, folder: ROOT }], panes: paneList, focused: { pane: "p1" }, agents: agentList });
  state.shared["herdsidian.sidebar"] = { tab: "changes" };
  const git = fakeGit({ status, numstat, patches, session, fail });
  return { git, m: mount() };
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

const shows = (m, id) => until(() => { const t = m.render(); return findById(t, id) && t; }, id);
// A few more ticks after the list shows, so a read that would start has finished.
async function calm(m) {
  for (let i = 0; i < 4; i++) { m.render(); await settle(); }
  return m.render();
}
const patchCalls = (git) => git.calls.filter(([cmd, args]) => cmd === "git" && args.includes("diff") && args.includes("-U3"));
const nodeWith = (tree, text) => walk(tree).find((n) => n.kids.includes(text));
const isInside = (outer, inner) => walk(outer).includes(inner);

// AC4: the total.

test("AC4: changes-total shows +A in ansi2 and −D in ansi1, outside changes-summary", async () => {
  const { m } = scene({ status: STATUS + " M bin.png\0?? new.txt\0", numstat: NUMSTAT + "-\t-\tbin.png\0", agentList: [] });
  const tree = await shows(m, "changes-total");
  const total = findById(tree, "changes-total"), summary = findById(tree, "changes-summary");
  // Binary and untracked files add nothing: 3 + 2 + 1 and 1 + 0 + 4.
  assert.ok(texts(total).includes("+6"), `texts: ${JSON.stringify(texts(total))}`);
  assert.ok(texts(total).includes("−5"), `texts: ${JSON.stringify(texts(total))}`);
  assert.ok(has(nodeWith(total, "+6"), "text_color", T.ansi2));
  assert.ok(has(nodeWith(total, "−5"), "text_color", T.ansi1));
  assert.equal(isInside(summary, total), false, "the total is not inside changes-summary");
  assert.deepEqual(texts(summary), ["5 files changed on main"]);
});

test("AC4: with 520 files the total sums all of them, also the files after the first 500", async () => {
  const names = Array.from({ length: 520 }, (_, i) => `f${String(i).padStart(3, "0")}.txt`);
  const { m } = scene({ status: "## main\0" + names.map((n) => ` M ${n}\0`).join(""), numstat: names.map((n) => `2\t1\t${n}\0`).join(""), agentList: [] });
  const tree = await shows(m, "changes-total");
  const total = findById(tree, "changes-total");
  assert.ok(texts(total).includes("+1040"), `texts: ${JSON.stringify(texts(total))}`);
  assert.ok(texts(total).includes("−520"), `texts: ${JSON.stringify(texts(total))}`);
});

test("AC4: a part that is 0 is not drawn", async () => {
  const adds = scene({ status: "## main\0 M a.txt\0", numstat: "3\t0\ta.txt\0", agentList: [] });
  const onlyAdd = findById(await shows(adds.m, "changes-total"), "changes-total");
  assert.ok(texts(onlyAdd).includes("+3"));
  assert.equal(texts(onlyAdd).some((s) => s.startsWith("−")), false, `texts: ${JSON.stringify(texts(onlyAdd))}`);

  reset();
  const dels = scene({ status: "## main\0 M a.txt\0", numstat: "0\t2\ta.txt\0", agentList: [] });
  const onlyDel = findById(await shows(dels.m, "changes-total"), "changes-total");
  assert.ok(texts(onlyDel).includes("−2"));
  assert.equal(texts(onlyDel).some((s) => s.startsWith("+")), false, `texts: ${JSON.stringify(texts(onlyDel))}`);
});

test("AC4: no changes-total with no changes, with only zero counts, or in a state that is not ready", async () => {
  // The control: the same scene with one counted change draws the total.
  const control = scene({ status: "## main\0 M a.txt\0", numstat: "3\t1\ta.txt\0", agentList: [] });
  await shows(control.m, "changes-total");
  const cases = [
    ["no changed file", { status: "## main\0", numstat: "" }, "No changes on main"],
    ["only an untracked file", { status: "## main\0?? new.txt\0", numstat: "" }, "change-new.txt"],
    ["a 0 and 0 count", { status: "## main\0 M a.txt\0", numstat: "0\t0\ta.txt\0" }, "change-a.txt"],
    ["not a git repository", { fail: "top" }, "Not a git repository"],
    ["a git error", { fail: "status" }, null],
  ];
  for (const [name, opts, mark] of cases) {
    reset();
    const { m } = scene({ ...opts, agentList: [] });
    // Loading: the first render, before any read finished.
    assert.equal(findById(m.render(), "changes-total"), null, `${name}: loading`);
    if (mark) await until(() => { const t = m.render(); return (findById(t, mark) || texts(t).some((s) => s.includes(mark))) && t; }, `${name}: ${mark}`);
    const tree = await calm(m);
    assert.equal(findById(tree, "changes-total"), null, name);
  }
});

// AC33: a patch is read only when a file opens.

test("AC33: no patch call while the list shows; each opened file adds exactly one, for that file only", async () => {
  const { m, git } = scene({ patches: { "a.txt": PATCH("a.txt"), "c.txt": PATCH("c.txt") } });
  await shows(m, "change-a.txt");
  await calm(m);
  assert.deepEqual(patchCalls(git), [], "no diff -U3 call while the list shows");

  m.click(findById(m.render(), "change-a.txt"));
  await shows(m, "diff-view");
  await calm(m);
  assert.equal(patchCalls(git).length, 1);
  const [, first] = patchCalls(git)[0];
  assert.equal(first.at(-1), "a.txt");
  assert.deepEqual(first.slice(first.indexOf("--") + 1), ["a.txt"]);

  m.click(findById(m.render(), "diff-back"));
  await shows(m, "change-c.txt");
  m.click(findById(m.render(), "change-c.txt"));
  await shows(m, "diff-view");
  await calm(m);
  assert.equal(patchCalls(git).length, 2);
  const [, second] = patchCalls(git)[1];
  assert.equal(second.at(-1), "c.txt");
  assert.deepEqual(second.slice(second.indexOf("--") + 1), ["c.txt"]);
});

// AC34: an untracked file is read whole.

const UNTRACKED = STATUS + "?? new.txt\0";
// Records each readTextFile path on top of fakeFiles.
function recordReads() {
  const reads = [], inner = state.readTextFile;
  state.readTextFile = async (path, ...rest) => { reads.push(path); return inner(path, ...rest); };
  return reads;
}

test("AC34: an untracked file is read with readTextFile(<root>/<path>), no git, and shows added lines from 1 under Line 1", async () => {
  const { m, git } = scene({ status: UNTRACKED, agentList: [] });
  fakeFiles({ [`${ROOT}/new.txt`]: "one\ntwo\n" });
  const reads = recordReads();
  await shows(m, "change-new.txt");
  await calm(m);
  const before = git.calls.length;
  m.click(findById(m.render(), "change-new.txt"));
  const tree = await until(() => { const t = m.render(); return walk(t).some((n) => n.kind === "vlist") && t; }, "the diff lines");
  assert.deepEqual(reads.filter((p) => p.endsWith("new.txt")), [`${ROOT}/new.txt`]);
  const gitForFile = git.calls.slice(before).filter(([cmd, args]) => cmd === "git" && (args.includes("new.txt") || args.includes("-U3")));
  assert.deepEqual(gitForFile, [], "no git call for an untracked file");
  const list = walk(tree).find((n) => n.kind === "vlist");
  assert.equal(list.arg.count, 3, "one hunk row and two line rows");
  const rows = rowsOf(tree, [0, 3]).map((row) => texts(row).filter((s) => s !== ""));
  assert.ok(rows[0].includes("Line 1"), `hunk row: ${JSON.stringify(rows[0])}`);
  for (const [i, text] of [[1, "one"], [2, "two"]]) {
    const [no, sign, ...pieces] = rows[i];
    assert.deepEqual([no, sign, pieces.join("")], [String(i), "+", text], `row ${i}: ${JSON.stringify(rows[i])}`);
  }
});

const notices = [
  ["a file over 1 MiB (the read rejects)", {}, { big: [`${ROOT}/new.txt`] }, "File too large to preview"],
  ["a text of 1 MiB", { [`${ROOT}/new.txt`]: "a".repeat(1048576) }, {}, "File too large to preview"],
  ["a read that returns null", {}, {}, "File not found"],
  ["a text with a NUL", { [`${ROOT}/new.txt`]: "a\0b\n" }, {}, "Binary file, no preview"],
];
for (const [name, files, marks, notice] of notices) {
  test(`AC34: ${name} shows "${notice}" with diff-back and no lines`, async () => {
    const { m } = scene({ status: UNTRACKED, agentList: [] });
    fakeFiles(files, marks);
    await shows(m, "change-new.txt");
    m.click(findById(m.render(), "change-new.txt"));
    const tree = await shows(m, "diff-notice");
    assert.ok(texts(findById(tree, "diff-notice")).join("").includes(notice), `texts: ${JSON.stringify(texts(findById(tree, "diff-notice")))}`);
    assert.ok(findById(tree, "diff-back"), "the back button stays");
    assert.equal(walk(tree).some((n) => n.kind === "vlist"), false, "no diff lines");
  });
}

