// The Changes tab's pure logic (V1, AC-V1.4): git output parsers, rows and count, checked against
// a fixture repo made with real git.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBranch, parseStatus, parseNumstat, mergeRows, statusKind, relevant, summary, statusArgs, diffArgs, topArgs, MAX_ROWS }
  from "../mods/herdsidian/changes.js";

// Never an inherited GIT_DIR (a test run from a git hook would write into the wrong repo), and no user config.
const env = { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined,
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (args) => execFileSync("git", args, { env, encoding: "utf8", maxBuffer: 1 << 24 });
const gitIn = (dir, ...args) => git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-C", dir, ...args]);

const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), "herdsidian-changes-")));
const write = (dir, name, text) => { mkdirSync(join(dir, name, ".."), { recursive: true }); writeFileSync(join(dir, name), text); };

test("parseBranch reads the header of status --branch", () => {
  assert.deepEqual(parseBranch("## main"), { name: "main", head: true });
  assert.deepEqual(parseBranch("## feat/v2...origin/feat/v2 [ahead 2, behind 1]"), { name: "feat/v2", head: true });
  assert.deepEqual(parseBranch("## No commits yet on main"), { name: "main", head: false });
  assert.deepEqual(parseBranch("## Initial commit on trunk"), { name: "trunk", head: false });
  assert.deepEqual(parseBranch("## HEAD (no branch)"), { name: null, head: true });
});

test("statusKind maps the XY pair of a porcelain entry", () => {
  const kinds = { "??": "untracked", " M": "modified", "M ": "modified", "MM": "modified", "A ": "added", " D": "deleted", "D ": "deleted",
    "R ": "renamed", "RM": "renamed", "C ": "renamed", "UU": "conflict", "AA": "conflict", "DD": "conflict", "AU": "conflict", "T ": "modified" };
  for (const [xy, kind] of Object.entries(kinds)) assert.equal(statusKind(xy), kind, xy);
});

test("parseStatus reads entries, a rename's old path and the branch", () => {
  const out = ["## main...origin/main [ahead 1]", " M lib/ui.js", "R  new name.txt", "old name.txt", "?? notes/", "A  a b.txt", ""].join("\0");
  const { branch, entries } = parseStatus(out);
  assert.deepEqual(branch, { name: "main", head: true });
  assert.deepEqual(entries, [
    { path: "lib/ui.js", from: null, kind: "modified" },
    { path: "new name.txt", from: "old name.txt", kind: "renamed" },
    { path: "notes/", from: null, kind: "untracked" },
    { path: "a b.txt", from: null, kind: "added" },
  ]);
});

test("parseStatus of nothing: no branch, no entries", () => {
  assert.deepEqual(parseStatus(""), { branch: null, entries: [] });
});

test("parseNumstat reads counts, binary files and renames", () => {
  const out = ["3\t1\ta.txt", "-\t-\tbin.dat", "5\t0\twith space.md", "0\t0\t", "old.txt", "new.txt", "1\t2\tz.js", ""].join("\0");
  const stats = parseNumstat(out);
  assert.deepEqual(stats.get("a.txt"), { add: 3, del: 1 });
  assert.deepEqual(stats.get("bin.dat"), { add: null, del: null });
  assert.deepEqual(stats.get("with space.md"), { add: 5, del: 0 });
  assert.deepEqual(stats.get("new.txt"), { add: 0, del: 0 });
  assert.equal(stats.has("old.txt"), false);
  assert.deepEqual(stats.get("z.js"), { add: 1, del: 2 });
  assert.equal(parseNumstat("").size, 0);
});

test("mergeRows joins entries with their counts; untracked and binary have none", () => {
  const { entries } = parseStatus(["## main", " M a.txt", "?? u.txt", " M bin.dat", " D gone.txt", ""].join("\0"));
  const stats = parseNumstat(["2\t1\ta.txt", "-\t-\tbin.dat", "0\t4\tgone.txt", ""].join("\0"));
  assert.deepEqual(mergeRows(entries, stats), [
    { path: "a.txt", from: null, status: "modified", add: 2, del: 1 },
    { path: "u.txt", from: null, status: "untracked", add: null, del: null },
    { path: "bin.dat", from: null, status: "modified", add: null, del: null },
    { path: "gone.txt", from: null, status: "deleted", add: 0, del: 4 },
  ]);
});

test("mergeRows shows a bounded number of rows", () => {
  const entries = Array.from({ length: MAX_ROWS + 100 }, (_v, i) => ({ path: `f${i}`, from: null, kind: "modified" }));
  assert.equal(MAX_ROWS, 500);
  assert.equal(mergeRows(entries, new Map()).length, 500);
  assert.equal(mergeRows(entries, new Map(), 3).length, 3);
});

test("relevant ignores batches inside .git/objects and build folders (node_modules, dist, ...)", () => {
  const root = "/work/repo";
  assert.equal(relevant([`${root}/.git/objects/ab/cdef`, `${root}/.git/objects/pack/x.pack`], root), false);
  assert.equal(relevant([`${root}/.git/objects/ab/cdef`, `${root}/src/a.js`], root), true);
  assert.equal(relevant([`${root}/.git/index`], root), true);
  assert.equal(relevant([root], root), true);
  assert.equal(relevant([`${root}/`], root), true);
  assert.equal(relevant([], root), true);
  assert.equal(relevant(undefined, root), true);
});

test("relevant applies the ignore rules only inside the repo: a root under build/dist/node_modules still counts", () => {
  for (const parent of ["build", "dist", "node_modules"]) {
    const root = `/srv/${parent}/repo`;
    assert.equal(relevant([root], root), true, parent);
    assert.equal(relevant([`${root}/`], root), true, parent);
    assert.equal(relevant([`${root}/src/a.js`], root), true, parent);
    assert.equal(relevant([`${root}/dist/a.js`], root), false, parent);
  }
});

test("relevant counts a path outside the repo root as relevant", () => {
  assert.equal(relevant(["/elsewhere/node_modules/x/y.js"], "/work/repo"), true);
});

test("summary says how many files changed on which branch", () => {
  assert.equal(summary(3, "main"), "3 files changed on main");
  assert.equal(summary(1, "main"), "1 file changed on main");
  assert.equal(summary(0, "main"), "No changes on main");
  assert.equal(summary(2, "detached HEAD"), "2 files changed on detached HEAD");
});

test("the git commands read the repo root and write nothing under .git", () => {
  assert.deepEqual(topArgs("/w/x"), ["-C", "/w/x", "rev-parse", "--show-toplevel"]);
  const status = statusArgs("/w/repo"), diff = diffArgs("/w/repo", true), bare = diffArgs("/w/repo", false);
  for (const args of [status, diff, bare]) {
    assert.ok(args.includes("--no-optional-locks"));
    assert.deepEqual(args.slice(args.indexOf("-C"), args.indexOf("-C") + 2), ["-C", "/w/repo"]);
    assert.ok(args.includes("-z"));
  }
  assert.ok(status.includes("status") && status.includes("--porcelain=v1"));
  assert.ok(diff.includes("diff") && diff.includes("HEAD") && diff.includes("--numstat"));
  assert.ok(!bare.includes("HEAD") && bare.includes("--numstat"));
});

test("AC-V1.4: the count equals the porcelain entries of a real repo", () => {
  const dir = scratch();
  try {
    gitIn(dir, "init", "-q", "-b", "main");
    write(dir, "a.txt", "1\n2\n3\n");
    write(dir, "b.txt", "x\ny\n");
    write(dir, "c.txt", "gone\n");
    write(dir, "old name.txt", "same\n");
    writeFileSync(join(dir, "bin.dat"), Buffer.from([0, 1, 2, 0, 3]));
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-q", "-m", "base");
    write(dir, "a.txt", "1\n3\n4\n5\n");
    write(dir, "b.txt", "x\ny\nz\n");
    gitIn(dir, "add", "b.txt");
    rmSync(join(dir, "c.txt"));
    gitIn(dir, "mv", "old name.txt", "new name.txt");
    writeFileSync(join(dir, "bin.dat"), Buffer.from([0, 9, 9, 9, 0, 0]));
    write(dir, "fresh.txt", "new\n");
    write(dir, "newdir/inner.txt", "inside\n");
    write(dir, "ñandú.txt", "unicode\n");

    const { branch, entries } = parseStatus(git(statusArgs(dir)));
    const lines = gitIn(dir, "status", "--porcelain=v1").split("\n").filter(Boolean);
    assert.equal(lines.length, 8);
    assert.equal(entries.length, lines.length);
    assert.deepEqual(branch, { name: "main", head: true });

    const stats = parseNumstat(git(diffArgs(dir, true)));
    const rows = new Map(mergeRows(entries, stats).map((r) => [r.path, r]));
    assert.equal(rows.size, 8);
    assert.deepEqual([rows.get("a.txt").add, rows.get("a.txt").del], [2, 1]);
    assert.deepEqual([rows.get("b.txt").add, rows.get("b.txt").del], [1, 0]);
    assert.deepEqual([rows.get("c.txt").status, rows.get("c.txt").add, rows.get("c.txt").del], ["deleted", 0, 1]);
    assert.deepEqual([rows.get("bin.dat").add, rows.get("bin.dat").del], [null, null]);
    const renamed = rows.get("new name.txt");
    assert.equal(renamed.status, "renamed");
    assert.equal(renamed.from, "old name.txt");
    assert.deepEqual([renamed.add, renamed.del], [0, 0]);
    assert.equal(rows.get("fresh.txt").status, "untracked");
    assert.equal(rows.get("newdir/").status, "untracked");
    assert.equal(rows.get("ñandú.txt").status, "untracked");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a repo with no commit yet reads as headless and still diffs", () => {
  const dir = scratch();
  try {
    gitIn(dir, "init", "-q", "-b", "trunk");
    write(dir, "a.txt", "1\n");
    gitIn(dir, "add", "a.txt");
    write(dir, "b.txt", "2\n");
    const { branch, entries } = parseStatus(git(statusArgs(dir)));
    assert.deepEqual(branch, { name: "trunk", head: false });
    assert.equal(entries.length, gitIn(dir, "status", "--porcelain=v1").split("\n").filter(Boolean).length);
    // Without HEAD, `git diff --numstat` compares the work tree with the index: only b.txt is untracked, so nothing.
    assert.equal(parseNumstat(git(diffArgs(dir, branch.head))).size, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
