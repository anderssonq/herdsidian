// The Git tab, commit detail, commit diff and the end of an action: AC39 to AC43, AC46 and AC53.
// Written from the spec and the plan's contracts, with the kit's fake repo. Import the kit before anything else (R6).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mountGit, fakeRepo, fakeOps, commitsOf, deferred, reset, state, findById, walk, rowsOf, texts, has, settle } from "./support/git-kit.js";

const ROOT = "/work/repo";
const MINUS = "−";
const THEME = { foreground: "#eeeeee", background: "#111111", chrome: "#222222", canvas: "#333333", raised: "#2a2a2a", accent: "#ff00aa",
  muted: "#999999", dim: "#555555", hover: "#444444", blocked: "#ffaa00", ansi1: "#ff0001", ansi2: "#00ff02",
  ansi3: "#aa0003", ansi4: "#0aa004", ansi5: "#0005aa", ansi6: "#a0a006" };
const QUIET = ["--no-optional-locks", "-c", "core.fsmonitor=false"];

const hex = (letter) => letter.repeat(40);
const short = (hash) => hash.slice(0, 7);
// c4 is HEAD; c3 merges c2 and c1; c0 is the root.
const H = { c0: hex("1"), c1: hex("2"), c2: hex("3"), c3: hex("4"), c4: hex("5") };
const SUBJECT = "Add the parser for the long subject line that has to wrap in the detail panel";
const AGE_MS = (3 * 3600 + 120) * 1000;

const COMMITS = commitsOf(`
${H.c4} <- ${H.c3} | ${SUBJECT} | Ada Lovelace <ada@example.com>
${H.c3} <- ${H.c2} ${H.c1} | Merge branch feature | Grace Hopper <grace@example.com>
${H.c2} <- ${H.c0} | Rename the note | Ada Lovelace <ada@example.com>
${H.c1} <- ${H.c0} | Add a picture | Linus Torvalds <linus@example.com>
${H.c0} <- | Initial commit | Ada Lovelace <ada@example.com>
`).map((c) => ({ ...c, at: Date.now() - AGE_MS }));

const patch = (path, ...body) => [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`, ...body, ""].join("\n");
const A_PATCH = patch("src/a.js", "@@ -1,4 +1,4 @@ function main() {", " keep", "-old line", "+new line", " tail", " more");
const B_PATCH = patch("b.txt", "@@ -1,3 +1,2 @@", " one", "-two", "-three", "+TWO");

const FILES = {
  [H.c4]: [{ path: "src/a.js", status: "modified", add: 10, del: 2 }, { path: "b.txt", status: "added", add: 2, del: 0 },
    { path: "old/c.txt", status: "deleted", add: 0, del: 2 }],
  [H.c3]: [{ path: "feature.txt", status: "added", add: 1, del: 0 }],
  [H.c2]: [{ path: "new name.txt", from: "old name.txt", status: "renamed", add: 1, del: 0 }],
  [H.c1]: [{ path: "img.png", status: "modified", add: null, del: null }],
  [H.c0]: [{ path: "README.md", status: "added", add: 1, del: 0 }],
};
const RENAME_PATCH = patch("new name.txt", "@@ -1 +1,2 @@", " same", "+more");
const PATCHES = {
  [`${H.c4}:src/a.js`]: A_PATCH,
  [`${H.c4}:b.txt`]: B_PATCH,
  [`${H.c4}:old/c.txt`]: patch("old/c.txt", "@@ -1,2 +0,0 @@", "-x", "-y"),
  [`${H.c3}:feature.txt`]: patch("feature.txt", "@@ -0,0 +1 @@", "+f"),
  [`${H.c2}:new name.txt`]: RENAME_PATCH,
  [`${H.c2}:old name.txt`]: RENAME_PATCH,
  [`${H.c0}:README.md`]: patch("README.md", "@@ -0,0 +1 @@", "+hello"),
};
const REFS = [{ kind: "local", name: "main", sha: H.c4 }, { kind: "remote", name: "origin/main", sha: H.c4 },
  { kind: "tag", name: "v1.0", sha: H.c4 }, { kind: "local", name: "feature", sha: H.c1 }];
const UPSTREAM = { remote: "origin", ref: "refs/heads/main", short: "origin/main" };

beforeEach(() => { reset(); state.toasts = []; });

async function until(fn, what) {
  for (let i = 0; i < 50; i++) {
    const value = fn();
    if (value) return value;
    await settle();
  }
  return assert.fail(`timed out waiting for ${what}`);
}

// A mounted Git tab on the fixture repo, drawn until the HEAD commit's files and the action buttons are there.
async function setup({ repo = {}, wait = true } = {}) {
  const fake = fakeRepo({ commits: COMMITS, files: FILES, patches: PATCHES, branch: "main", upstream: UPSTREAM, ahead: 2, behind: 1,
    remotes: ["origin"], refs: REFS, changed: 3, stash: { hash: hex("9"), message: "On main: my work" }, ...repo });
  fakeOps();
  const m = mountGit({ theme: THEME });
  m.render();
  if (!wait) return { m, repo: fake, tree: m.render() };
  const tree = await until(() => { const t = m.render(); return findById(t, "git-rows") && walk(t).some((n) => /^git-file-/.test(n.nodeId ?? "")) && findById(t, "git-act-fetch")?.onClick && t; }, "the graph and the detail");
  return { m, repo: fake, tree };
}

const patchCalls = (s) => s.repo.log.reads().filter(([cmd, args]) => cmd === "git" && args.includes("-U3"));
const fileCalls = (s) => s.repo.log.reads().filter(([cmd, args]) => cmd === "git" && args.includes("diff-tree") && !args.includes("-U3"));
const scrolls = (s) => s.m.scrolls.reduce((n, h) => n + h.scrolls.length, 0);
const pathOf = (tree) => texts(findById(tree, "diff-path"));
const vlist = (tree) => walk(tree).find((n) => n.kind === "vlist");
const hasCall = (node, name) => node.calls.some(([n]) => n === name);
const holderOf = (node, str) => walk(node).find((n) => n.kids.includes(str));

// The nodes from `node` down to the first one that holds `str` as a child; the nearest text_color wins.
function chain(node, str, path = []) {
  const here = [...path, node];
  if (node.kids.includes(str)) return here;
  for (const kid of node.kids) {
    if (kid && typeof kid === "object") {
      const found = chain(kid, str, here);
      if (found) return found;
    }
  }
  return null;
}
const colorOf = (nodes) => {
  for (const n of [...nodes].reverse()) {
    const call = n.calls.filter(([k]) => k === "text_color").at(-1);
    if (call) return call[1][0];
  }
  return null;
};

// The input model behind an id: the id may sit on the input or on a box around it.
function inputOf(tree, id) {
  const node = findById(tree, id);
  assert.ok(node, `${id} is drawn`);
  const input = node.kind === "input" ? node : walk(node).find((n) => n.kind === "input");
  assert.ok(input, `${id} holds an input`);
  return input.arg;
}

// Selects a commit by its row key and waits for the detail of it (its subject on show).
async function select(s, hash, subject) {
  s.m.itemClick(s.m.render(), hash);
  return until(() => { const t = s.m.render(); return texts(findById(t, "git-detail-subject") ?? { kids: [], calls: [] }).includes(subject) && t; }, `the detail of ${short(hash)}`);
}

async function openFile(s, path) {
  s.m.click(findById(s.m.render(), `git-file-${path}`));
  return until(() => {
    const t = s.m.render();
    return (findById(t, "diff-code") || findById(t, "diff-notice")) && !texts(t).includes("Loading diff…") && t;
  }, `the diff of ${path}`);
}

// AC39
test("AC39 the detail shows the full subject unwrapped by a cut, and the author with initials and name", async () => {
  const s = await setup();
  const subject = findById(s.tree, "git-detail-subject");
  assert.deepEqual(texts(subject), [SUBJECT]);
  assert.equal(walk(subject).some((n) => hasCall(n, "truncate")), false, "the subject wraps, it is not cut");
  const author = texts(findById(s.tree, "git-detail-author"));
  assert.ok(author.includes("Ada Lovelace"));
  assert.ok(author.includes("AL"), "the avatar initials");
});

test("AC39 the detail shows the relative time and the 7-character hash", async () => {
  const s = await setup();
  assert.deepEqual(texts(findById(s.tree, "git-detail-time")), ["3 h ago"]);
  assert.deepEqual(texts(findById(s.tree, "git-detail-hash")), [short(H.c4)]);
});

test("AC39 the parents are listed as 7-character hashes, two for a merge", async () => {
  const s = await setup();
  assert.ok(texts(findById(s.tree, "git-detail-parents")).includes(short(H.c3)));
  const tree = await select(s, H.c3, "Merge branch feature");
  const parents = texts(findById(tree, "git-detail-parents"));
  assert.ok(parents.includes(short(H.c2)) && parents.includes(short(H.c1)), "both parents");
});

test("AC39 every ref of the commit is a pill of the detail, and refs of other commits are not", async () => {
  const s = await setup();
  const refs = texts(findById(s.tree, "git-detail-refs"));
  for (const name of ["main", "origin/main", "v1.0"]) assert.ok(refs.includes(name), `${name} is shown`);
  assert.equal(refs.includes("feature"), false, "a ref of another commit is not shown");
});

test("AC39 the stats show the file count and the +A -D total, with no zero part dropped from the total", async () => {
  const s = await setup();
  const stats = texts(findById(s.tree, "git-detail-stats"));
  assert.ok(stats.includes("3 files"), "N files");
  assert.ok(stats.includes("+12"), "added total");
  assert.ok(stats.includes(`${MINUS}4`), "deleted total");
});

test("AC39 with no selection git-detail has no child and no detail read runs", async () => {
  const s = await setup({ repo: { head: hex("9") }, wait: false });
  await until(() => findById(s.m.render(), "git-rows"), "the graph");
  await settle();
  const tree = s.m.render();
  const detail = findById(tree, "git-detail");
  assert.ok(detail, "git-detail is drawn");
  assert.equal(detail.kids.length, 0);
  assert.equal(s.repo.log.count("files"), 0, "no diff-tree call");
});

// AC40
test("AC40 a file row has the status letter, the folder in t.muted, the name and its +N and -N", async () => {
  const s = await setup();
  const row = findById(s.tree, "git-file-src/a.js");
  const cells = texts(row);
  assert.ok(cells.includes("M"), "status letter");
  assert.ok(cells.includes("a.js"), "name");
  assert.ok(cells.includes("+10") && cells.includes(`${MINUS}2`), "counts");
  const folder = cells.find((x) => x.startsWith("src"));
  assert.ok(folder, "a folder part");
  assert.equal(colorOf(chain(row, folder)), THEME.muted);
  assert.equal(typeof row.onClick, "function", "a plain row with on_click");
});

test("AC40 a zero part is not drawn, and the rows keep the order of the commit's files", async () => {
  const s = await setup();
  const ids = walk(s.tree).map((n) => n.nodeId).filter((id) => /^git-file-/.test(id ?? ""));
  assert.deepEqual(ids, ["git-file-src/a.js", "git-file-b.txt", "git-file-old/c.txt"]);
  const added = texts(findById(s.tree, "git-file-b.txt"));
  assert.ok(added.includes("A") && added.includes("+2"));
  assert.equal(added.some((x) => x.startsWith(MINUS)), false, "no -0");
  const deleted = texts(findById(s.tree, "git-file-old/c.txt"));
  assert.ok(deleted.includes("D") && deleted.includes(`${MINUS}2`));
  assert.equal(deleted.some((x) => x.startsWith("+")), false, "no +0");
});

test("AC40 a binary file shows bin and no counts", async () => {
  const s = await setup();
  const tree = await select(s, H.c1, "Add a picture");
  const row = await until(() => findById(s.m.render(), "git-file-img.png"), "the binary row");
  const cells = texts(row);
  assert.ok(cells.includes("bin"));
  assert.equal(cells.some((x) => x.startsWith("+") || x.startsWith(MINUS)), false);
  assert.ok(tree);
});

test("AC40 the file list is read with diff-tree --raw --numstat against the first parent, once per commit", async () => {
  const s = await setup();
  const calls = fileCalls(s);
  assert.equal(calls.length, 1);
  const args = calls[0][1];
  assert.deepEqual(args.slice(0, 4), [...QUIET, "-C"]);
  assert.equal(args[4], ROOT);
  assert.deepEqual(args.slice(5), ["diff-tree", "-r", "-z", "--raw", "--numstat", "-M", "--no-commit-id", H.c3, H.c4]);
  s.m.render();
  await settle();
  assert.equal(fileCalls(s).length, 1, "a re-render reads nothing");
});

test("AC40 a root commit passes --root in place of the two hashes", async () => {
  const s = await setup();
  await select(s, H.c0, "Initial commit");
  await until(() => findById(s.m.render(), "git-file-README.md"), "the root file");
  const args = fileCalls(s).at(-1)[1];
  assert.deepEqual(args.slice(-3), ["--no-commit-id", "--root", H.c0]);
});

test("AC40 more than 500 files give 500 rows, the note with the rest, and the full count and total", async () => {
  const many = Array.from({ length: 503 }, (_, i) => ({ path: `dir/f${i}.txt`, status: "modified", add: 1, del: 0 }));
  const s = await setup({ repo: { files: { ...FILES, [H.c4]: many } }, wait: false });
  const tree = await until(() => { const t = s.m.render(); return findById(t, "git-file-dir/f0.txt") && t; }, "the rows");
  const rows = walk(tree).filter((n) => /^git-file-/.test(n.nodeId ?? ""));
  assert.equal(rows.length, 500);
  assert.equal(texts(findById(tree, "git-files-more")).join(""), "3 more files not shown");
  const stats = texts(findById(tree, "git-detail-stats"));
  assert.ok(stats.includes("503 files") && stats.includes("+503"));
});

test("AC40 exactly 500 files show no note", async () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ path: `dir/f${i}.txt`, status: "modified", add: 1, del: 0 }));
  const s = await setup({ repo: { files: { ...FILES, [H.c4]: many } }, wait: false });
  const tree = await until(() => { const t = s.m.render(); return findById(t, "git-file-dir/f0.txt") && t; }, "the rows");
  assert.equal(findById(tree, "git-files-more"), null);
});

test("AC40 a merge shows the note with the first parent and compares against it; a normal commit has no note", async () => {
  const s = await setup();
  assert.equal(findById(s.tree, "git-merge-note"), null, "HEAD is not a merge");
  const tree = await select(s, H.c3, "Merge branch feature");
  const note = await until(() => findById(s.m.render(), "git-merge-note"), "the merge note");
  assert.equal(texts(note).join(""), `Merge: compared with the first parent ${short(H.c2)}`);
  assert.ok(tree);
  const args = fileCalls(s).at(-1)[1];
  assert.deepEqual(args.slice(-2), [H.c2, H.c3]);
  await until(() => findById(s.m.render(), "git-file-feature.txt"), "the merge's files");
});

// AC41
test("AC41 Copy hash writes the full hash to the clipboard and shows the notice Hash copied", async () => {
  const s = await setup();
  const button = findById(s.tree, "git-copy-hash");
  assert.ok(texts(button).includes("Copy hash"));
  s.m.click(button);
  assert.equal(s.m.cx.clipboard.at(-1), H.c4);
  assert.equal(s.m.cx.clipboard.length, 1);
  assert.equal(state.toasts.length, 1);
  assert.equal(state.toasts[0].title, "Hash copied");
});

test("AC41 Copy hash of another selected commit copies that commit's hash", async () => {
  const s = await setup();
  await select(s, H.c2, "Rename the note");
  s.m.click(findById(s.m.render(), "git-copy-hash"));
  assert.equal(s.m.cx.clipboard.at(-1), H.c2);
});

// AC42
test("AC42 a file click shows diff-view inside tab-git in place of the graph, with no Open in Files and the commit tabs", async () => {
  const s = await setup();
  const tree = await openFile(s, "src/a.js");
  const root = findById(tree, "tab-git");
  const view = findById(tree, "diff-view");
  assert.ok(root && view, "tab-git and diff-view");
  assert.ok(walk(root).includes(view), "diff-view is inside tab-git");
  assert.equal(findById(tree, "git-rows"), null, "the graph is not drawn");
  assert.equal(findById(tree, "diff-open-files"), null, "Open in Files is not drawn");
  const tabs = walk(findById(tree, "diff-tabs")).map((n) => n.nodeId).filter((id) => /^diff-tab-/.test(id ?? ""));
  assert.deepEqual(tabs, ["diff-tab-src/a.js", "diff-tab-b.txt", "diff-tab-old/c.txt"]);
  assert.ok(has(findById(tree, "diff-back"), "tooltip", "Back to the commit"));
});

test("AC42 the keys ] [ s and escape act and stop; another key does neither", async () => {
  const s = await setup();
  let tree = await openFile(s, "b.txt");
  s.m.resize(tree, 800);
  tree = s.m.render();
  assert.equal(s.m.key(tree, "]"), true);
  tree = await until(() => { const t = s.m.render(); return pathOf(t).includes("old/c.txt") && t; }, "the next file");
  assert.equal(s.m.key(tree, "["), true);
  tree = await until(() => { const t = s.m.render(); return pathOf(t).includes("b.txt") && t; }, "the previous file");
  const count = vlist(tree).arg.count;
  assert.equal(s.m.key(tree, "s"), true);
  assert.notEqual(vlist(s.m.render()).arg.count, count, "s switches the mode");
  const stops = s.m.stops.count;
  assert.equal(s.m.key(s.m.render(), "a"), false);
  assert.equal(s.m.stops.count, stops, "a is left alone");
  assert.equal(s.m.key(s.m.render(), "escape"), true);
  assert.equal(findById(s.m.render(), "diff-view"), null, "escape closes the diff");
  assert.ok(findById(s.m.render(), "git-rows"), "and the graph is back");
});

test("AC42 below 520 px the diff is unified with the note; from 520 px it is split", async () => {
  const s = await setup();
  let tree = await openFile(s, "b.txt");
  s.m.resize(tree, 519);
  tree = s.m.render();
  assert.equal(vlist(tree).arg.count, 5, "unified rows");
  assert.ok(findById(tree, "diff-note"), "the note says split needs more room");
  s.m.resize(tree, 520);
  tree = s.m.render();
  assert.equal(vlist(tree).arg.count, 4, "split rows");
  assert.equal(findById(tree, "diff-note"), null);
});

test("AC42 Back returns to the graph with the same commit selected and one scroll_to_item call", async () => {
  const s = await setup();
  await select(s, H.c3, "Merge branch feature");
  await until(() => findById(s.m.render(), "git-file-feature.txt"), "the merge's files");
  s.m.render();
  const before = scrolls(s);
  await openFile(s, "feature.txt");
  s.m.click(findById(s.m.render(), "diff-back"));
  const tree = s.m.render();
  assert.ok(findById(tree, "git-rows"), "the graph is back");
  assert.deepEqual(texts(findById(tree, "git-detail-subject")), ["Merge branch feature"], "the same commit");
  assert.equal(scrolls(s) - before, 1, "one scroll_to_item call");
  s.m.render();
  assert.equal(scrolls(s) - before, 1, "a re-render scrolls no more");
});

test("AC42 Escape returns to the graph with the same commit selected and one scroll_to_item call", async () => {
  const s = await setup();
  await select(s, H.c3, "Merge branch feature");
  await until(() => findById(s.m.render(), "git-file-feature.txt"), "the merge's files");
  s.m.render();
  const before = scrolls(s);
  await openFile(s, "feature.txt");
  assert.equal(s.m.key(s.m.render(), "escape"), true);
  const tree = s.m.render();
  assert.deepEqual(texts(findById(tree, "git-detail-subject")), ["Merge branch feature"]);
  assert.equal(scrolls(s) - before, 1);
});

// AC43
test("AC43 opening a file runs one patch exec with the exact arguments", async () => {
  const s = await setup();
  assert.equal(patchCalls(s).length, 0, "no patch read before a file is opened");
  await openFile(s, "src/a.js");
  const calls = patchCalls(s);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], [...QUIET, "--literal-pathspecs", "-C", ROOT, "diff-tree", "--no-commit-id", "-p", "-U3", "--no-color",
    "--no-ext-diff", "-M", H.c3, H.c4, "--", "src/a.js"]);
  s.m.render();
  await settle();
  assert.equal(patchCalls(s).length, 1, "a re-render starts nothing");
});

test("AC43 the next file runs one more patch exec, for that file", async () => {
  const s = await setup();
  await openFile(s, "src/a.js");
  assert.equal(s.m.key(s.m.render(), "]"), true);
  await until(() => pathOf(s.m.render()).includes("b.txt") && !texts(s.m.render()).includes("Loading diff…"), "the next file");
  const calls = patchCalls(s);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1][1].slice(-2), ["--", "b.txt"]);
});

test("AC43 a renamed file passes the old and the new path after --", async () => {
  const s = await setup();
  await select(s, H.c2, "Rename the note");
  await until(() => findById(s.m.render(), "git-file-new name.txt"), "the renamed row");
  await openFile(s, "new name.txt");
  const args = patchCalls(s).at(-1)[1];
  const cut = args.indexOf("--");
  assert.ok(cut > 0, "a -- separator");
  assert.deepEqual(args.slice(cut + 1).sort(), ["new name.txt", "old name.txt"]);
  assert.deepEqual(args.slice(cut - 3, cut), ["-M", H.c0, H.c2]);
});

test("AC43 a root commit passes --root in place of the two hashes", async () => {
  const s = await setup();
  await select(s, H.c0, "Initial commit");
  await until(() => findById(s.m.render(), "git-file-README.md"), "the root file");
  await openFile(s, "README.md");
  const args = patchCalls(s).at(-1)[1];
  assert.deepEqual(args.slice(-5), ["-M", "--root", H.c0, "--", "README.md"]);
});

test("AC43 a binary file shows Binary file, no preview and runs no patch exec", async () => {
  const s = await setup();
  await select(s, H.c1, "Add a picture");
  await until(() => findById(s.m.render(), "git-file-img.png"), "the binary row");
  const tree = await openFile(s, "img.png");
  assert.deepEqual(texts(findById(tree, "diff-notice")), ["Binary file, no preview"]);
  assert.ok(findById(tree, "diff-back"), "back stays");
  assert.equal(patchCalls(s).length, 0);
});

test("AC43 a diff over 2000 lines is capped as in Changes, with the last note", async () => {
  const lines = Array.from({ length: 2500 }, (_, i) => `+line ${i + 1}`);
  const big = patch("big.txt", "@@ -0,0 +1,2500 @@", ...lines);
  const s = await setup({ repo: { files: { ...FILES, [H.c4]: [{ path: "big.txt", status: "added", add: 2500, del: 0 }] },
    patches: { [`${H.c4}:big.txt`]: big } } });
  const tree = await openFile(s, "big.txt");
  assert.equal(vlist(tree).arg.count, 2002, "one hunk row, 2000 lines, the note");
  assert.deepEqual(texts(rowsOf(tree, [2001, 2002])[0]), ["Showing the first 2000 of 2500 lines."]);
});

// AC46
const cardText = async (s, action) => {
  s.m.click(findById(s.m.render(), `git-act-${action}`));
  const tree = s.m.render();
  const text = findById(tree, "git-confirm-text");
  assert.ok(text, `a card for ${action}`);
  return { tree, text: texts(text).join("") };
};

test("AC46 the Pull card names the upstream and the branch", async () => {
  const s = await setup();
  const { text } = await cardText(s, "pull");
  assert.equal(text, "Pull origin/main into main? Fast-forward only: no merge commit, no rebase. Your uncommitted changes stay; git stops if an incoming change touches a file you changed.");
});

test("AC46 the Push card names the branch and the remote", async () => {
  const s = await setup();
  const { text } = await cardText(s, "push");
  assert.equal(text, "Push main to origin/main? No force: git refuses if the remote has commits you do not have.");
});

test("AC46 the Push card of a branch with no upstream says Publish and track", async () => {
  const s = await setup({ repo: { upstream: null } });
  const { text } = await cardText(s, "push");
  assert.equal(text, "Publish main to origin/main and track it?");
});

test("AC46 the Branch card follows the typed name, trimmed, and shows the short hash of HEAD", async () => {
  const s = await setup();
  let { tree } = await cardText(s, "branch");
  s.m.type(inputOf(tree, "git-confirm-input"), "feat/x");
  tree = s.m.render();
  assert.equal(texts(findById(tree, "git-confirm-text")).join(""), `Create feat/x at ${short(H.c4)} and switch to it? Your files do not change.`);
  s.m.type(inputOf(tree, "git-confirm-input"), "  feat/y  ");
  tree = s.m.render();
  assert.equal(texts(findById(tree, "git-confirm-text")).join(""), `Create feat/y at ${short(H.c4)} and switch to it? Your files do not change.`);
});

test("AC46 the Stash card names the number of changed files", async () => {
  const s = await setup();
  const { text } = await cardText(s, "stash");
  assert.equal(text, "Stash 3 changed files, untracked files included? They leave the working tree; Pop brings them back.");
});

test("AC46 the Pop card names the stash and its message", async () => {
  const s = await setup();
  const { text } = await cardText(s, "pop");
  assert.equal(text, "Apply and drop stash@{0} (On main: my work)? If it conflicts, git keeps the stash.");
});

// AC53
test("AC53 after a success exactly one new snapshot and one new log run, and the header shows the new state", async () => {
  let fake = null;
  const s = await setup({ repo: { write: () => { fake.set({ ahead: 5 }); return "From origin\n"; } } });
  fake = s.repo;
  assert.deepEqual(texts(findById(s.tree, "git-ahead")), ["↑2"]);
  const snaps = s.repo.log.count("status2"), logs = s.repo.log.count("log");
  s.m.click(findById(s.m.render(), "git-act-fetch"));
  const tree = await until(() => { const t = s.m.render(); return findById(t, "git-result") && texts(findById(t, "git-ahead") ?? { kids: [], calls: [] }).includes("↑5") && t; }, "the result and the reload");
  assert.deepEqual(texts(findById(tree, "git-result-title")), ["Fetch done"]);
  assert.ok(texts(findById(tree, "git-result-lines")).includes("From origin"));
  await settle();
  await settle();
  s.m.render();
  assert.equal(s.repo.log.count("status2") - snaps, 1, "one new snapshot");
  assert.equal(s.repo.log.count("log") - logs, 1, "one new log");
});

test("AC53 the result shows the first output line that does not start with hint:", async () => {
  const s = await setup({ repo: { write: () => ({ stdout: "hint: a tip\nFrom origin\nsecond line\n" }) } });
  s.m.click(findById(s.m.render(), "git-act-fetch"));
  const tree = await until(() => findById(s.m.render(), "git-result") && s.m.render(), "the result");
  const lines = texts(findById(tree, "git-result-lines"));
  assert.ok(lines.includes("From origin"));
  assert.equal(lines.some((x) => x.startsWith("hint:")), false);
  assert.equal(lines.includes("second line"), false, "only the first line");
});

test("AC53 the result stays until it is closed", async () => {
  const s = await setup();
  s.m.click(findById(s.m.render(), "git-act-fetch"));
  await until(() => findById(s.m.render(), "git-result"), "the result");
  await settle();
  s.m.render();
  assert.ok(findById(s.m.render(), "git-result"), "it stays after the reload");
  s.m.click(findById(s.m.render(), "git-result-close"));
  assert.equal(findById(s.m.render(), "git-result"), null);
});

test("AC53 after a failure exactly one new snapshot and one new log run, and the header shows the new state", async () => {
  let fake = null;
  const s = await setup({ repo: { write: () => { fake.set({ ahead: 7 }); return { code: 1, stderr: "fatal: unable to access the remote\n" }; } } });
  fake = s.repo;
  const snaps = s.repo.log.count("status2"), logs = s.repo.log.count("log");
  s.m.click(findById(s.m.render(), "git-act-fetch"));
  const tree = await until(() => { const t = s.m.render(); return findById(t, "git-result") && texts(findById(t, "git-ahead") ?? { kids: [], calls: [] }).includes("↑7") && t; }, "the result and the reload");
  assert.deepEqual(texts(findById(tree, "git-result-title")), ["Fetch failed"]);
  await settle();
  await settle();
  s.m.render();
  assert.equal(s.repo.log.count("status2") - snaps, 1, "one new snapshot");
  assert.equal(s.repo.log.count("log") - logs, 1, "one new log");
});

// D3
test("AC53 an action that ends while another tab shows still notifies, and the reload waits until Git shows", async () => {
  const hold = deferred();
  const s = await setup({ repo: { write: () => hold.promise } });
  s.m.click(findById(s.m.render(), "git-act-fetch"));
  await settle();
  s.m.leave();
  state.shared["herdsidian.sidebar"] = { tab: "changes" };
  const snaps = s.repo.log.count("status2"), logs = s.repo.log.count("log");
  hold.resolve("From origin\n");
  await until(() => state.toasts.length > 0, "the notice");
  assert.equal(state.toasts[0].title, "repo: Fetch done");
  await settle();
  await settle();
  assert.equal(s.repo.log.count("status2"), snaps, "no snapshot while Git is hidden");
  assert.equal(s.repo.log.count("log"), logs, "no log while Git is hidden");
  state.shared["herdsidian.sidebar"] = { tab: "git" };
  await until(() => { s.m.render(); return s.repo.log.count("status2") > snaps && s.repo.log.count("log") > logs; }, "the reload on show");
});
