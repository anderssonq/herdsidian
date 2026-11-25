// The Git tab's reads on a real temp repo (AC15, AC40, AC43): every builder runs with execFileSync exactly as it returns the
// arguments, and every parser reads what git really prints.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logArgs, parseLog, refsArgs, parseRefs, statusArgs2, parseStatus2, commitFilesArgs, parseCommitFiles, commitPatchArgs }
  from "../mods/herdsidian/git-log.js";
import { parseHunks } from "../mods/herdsidian/changes.js";

const env = { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined,
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "Test Author", GIT_AUTHOR_EMAIL: "author@example.com",
  GIT_COMMITTER_NAME: "Test Committer", GIT_COMMITTER_EMAIL: "committer@example.com" };
const git = (args) => execFileSync("git", args, { env, encoding: "utf8", maxBuffer: 1 << 24 });
const gitIn = (dir, ...args) => git(["-C", dir, ...args]);
const put = (dir, name, text) => { mkdirSync(join(dir, name, ".."), { recursive: true }); writeFileSync(join(dir, name), text); };
const commit = (dir, subject, files = {}) => {
  for (const [name, text] of Object.entries(files)) put(dir, name, text);
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", subject);
  return gitIn(dir, "rev-parse", "HEAD").trim();
};
const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), "herdsidian-gitread-")));
const byPath = (files) => files.map((f) => ({ path: f.path, status: f.status, add: f.add, del: f.del })).sort((a, b) => (a.path < b.path ? -1 : 1));

const folders = [];
let repo, shas, stashSha, notesSha, tagObject;

before(() => {
  repo = scratch();
  folders.push(repo);
  gitIn(repo, "init", "-q", "-b", "main");
  const root = commit(repo, "root", { "notes.md": "one\ntwo\nthree\n", "my file.txt": "alpha\nbeta\n" });
  gitIn(repo, "tag", "v1");
  gitIn(repo, "switch", "-q", "-c", "feature");
  const f1 = commit(repo, "feat one", { "feature.txt": "feat\n" });
  const f2 = commit(repo, "feat two", { "feature.txt": "feat\nmore\n" });
  gitIn(repo, "switch", "-q", "main");
  const second = commit(repo, "second", { "notes.md": "one\nTWO\nthree\n", "a*.txt": "star\n", "ab.txt": "plain\nline2\nline3\nline4\n",
    "my file.txt": "alpha\nbeta\ngamma\n" });
  gitIn(repo, "mv", "ab.txt", "ab-renamed.txt");
  put(repo, "ab-renamed.txt", "plain\nline2\nline3\nline4\nextra\n");
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-q", "-m", "rename");
  const rename = gitIn(repo, "rev-parse", "HEAD").trim();
  gitIn(repo, "tag", "-a", "v2", "-m", "annotated");
  tagObject = gitIn(repo, "rev-parse", "refs/tags/v2").trim();
  gitIn(repo, "merge", "-q", "--no-ff", "-m", "merge feature", "feature");
  const merge = gitIn(repo, "rev-parse", "HEAD").trim();
  shas = { root, f1, f2, second, rename, merge };
  gitIn(repo, "remote", "add", "origin", join(repo, "..", "no-such-remote.git"));
  gitIn(repo, "update-ref", "refs/remotes/origin/main", second);
  gitIn(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  gitIn(repo, "config", "branch.main.remote", "origin");
  gitIn(repo, "config", "branch.main.merge", "refs/heads/main");
  put(repo, "notes.md", "one\nTWO\nthree\nlocal edit\n");
  gitIn(repo, "stash", "push", "-q");
  gitIn(repo, "notes", "add", "-m", "a note", rename);
  stashSha = gitIn(repo, "rev-parse", "refs/stash").trim();
  notesSha = gitIn(repo, "rev-parse", "refs/notes/commits").trim();
});

after(() => { for (const dir of folders) rmSync(dir, { recursive: true, force: true }); });

const history = () => parseLog(git(logArgs(repo)));
const commitOf = (subject) => history().find((c) => c.subject === subject);

test("AC13: the log gives every child before its parents, with no stash or note commit", () => {
  const commits = history();
  assert.deepEqual(commits.map((c) => c.hash).sort(), Object.values(shas).sort());
  assert.ok(!commits.some((c) => c.hash === stashSha || c.hash === notesSha));
  const at = new Map(commits.map((c, i) => [c.hash, i]));
  for (const c of commits) for (const parent of c.parents) assert.ok(at.get(parent) > at.get(c.hash), `${c.subject} is before its parent`);
  const merge = commits.find((c) => c.subject === "merge feature");
  assert.deepEqual(merge.parents, [shas.rename, shas.f2]);
  assert.equal(merge.author, "Test Author");
  assert.equal(merge.email, "author@example.com");
  assert.equal(typeof merge.at, "number");
  assert.deepEqual(commits.find((c) => c.subject === "root").parents, []);
});

test("AC15: the refs are classed and the annotated tag gives its commit", () => {
  const { refs, upstream } = parseRefs(git(refsArgs(repo)));
  const sha = (full) => refs.find((r) => r.full === full)?.sha;
  assert.deepEqual(refs.map((r) => [r.full, r.kind, r.name]).sort(), [
    ["refs/heads/feature", "local", "feature"],
    ["refs/heads/main", "local", "main"],
    ["refs/remotes/origin/main", "remote", "origin/main"],
    ["refs/tags/v1", "tag", "v1"],
    ["refs/tags/v2", "tag", "v2"],
  ]);
  assert.equal(sha("refs/tags/v1"), shas.root);
  assert.equal(sha("refs/tags/v2"), shas.rename);
  assert.notEqual(sha("refs/tags/v2"), tagObject);
  assert.equal(sha("refs/heads/main"), shas.merge);
  assert.equal(sha("refs/remotes/origin/main"), shas.second);
  assert.deepEqual(refs.filter((r) => r.current).map((r) => r.full), ["refs/heads/main"]);
  assert.deepEqual(upstream, { remote: "origin", ref: "refs/heads/main" });
});

test("AC40: the files of a normal commit", () => {
  const commit2 = commitOf("second");
  const { files, count, total } = parseCommitFiles(git(commitFilesArgs(repo, commit2)));
  assert.deepEqual(byPath(files), [
    { path: "a*.txt", status: "added", add: 1, del: 0 },
    { path: "ab.txt", status: "added", add: 4, del: 0 },
    { path: "my file.txt", status: "modified", add: 1, del: 0 },
    { path: "notes.md", status: "modified", add: 1, del: 1 },
  ]);
  assert.equal(count, 4);
  assert.deepEqual(total, { add: 7, del: 1 });
});

test("AC40: the files of a rename with an edit", () => {
  const { files } = parseCommitFiles(git(commitFilesArgs(repo, commitOf("rename"))));
  assert.equal(files.length, 1);
  assert.equal(files[0].status, "renamed");
  assert.equal(files[0].path, "ab-renamed.txt");
  assert.equal(files[0].from, "ab.txt");
  assert.equal(files[0].add, 1);
  assert.equal(files[0].del, 0);
});

test("AC40: the files of a merge are compared with the first parent", () => {
  const { files, count } = parseCommitFiles(git(commitFilesArgs(repo, commitOf("merge feature"))));
  assert.deepEqual(byPath(files), [{ path: "feature.txt", status: "added", add: 2, del: 0 }]);
  assert.equal(count, 1);
});

test("AC40: the files of the root commit", () => {
  const { files, total } = parseCommitFiles(git(commitFilesArgs(repo, commitOf("root"))));
  assert.deepEqual(byPath(files), [
    { path: "my file.txt", status: "added", add: 2, del: 0 },
    { path: "notes.md", status: "added", add: 3, del: 0 },
  ]);
  assert.deepEqual(total, { add: 5, del: 0 });
});

const patchOf = (subject, file) => git(commitPatchArgs(repo, commitOf(subject), file));
const added = (hunk) => hunk.lines.filter((l) => l.kind === "add").map((l) => l.text);

test("AC43: the patch of a changed file", () => {
  const patch = patchOf("second", { path: "notes.md", from: null });
  assert.equal((patch.match(/^diff --git /gm) ?? []).length, 1);
  const hunks = parseHunks(patch);
  assert.equal(hunks.length, 1);
  assert.deepEqual(added(hunks[0]), ["TWO"]);
  assert.deepEqual(hunks[0].lines.filter((l) => l.kind === "del").map((l) => l.text), ["two"]);
});

test("AC43: the patch of a renamed file with an edit", () => {
  const patch = patchOf("rename", { path: "ab-renamed.txt", from: "ab.txt" });
  assert.match(patch, /rename from ab\.txt/);
  const hunks = parseHunks(patch);
  assert.equal(hunks.length, 1);
  assert.deepEqual(added(hunks[0]), ["extra"]);
});

test("AC43: the patch of a path with a space", () => {
  const hunks = parseHunks(patchOf("second", { path: "my file.txt", from: null }));
  assert.equal(hunks.length, 1);
  assert.deepEqual(added(hunks[0]), ["gamma"]);
});

test("AC43: the path a*.txt gives its own section, not ab.txt", () => {
  const patch = patchOf("second", { path: "a*.txt", from: null });
  assert.equal((patch.match(/^diff --git /gm) ?? []).length, 1);
  assert.ok(!patch.includes("ab.txt"));
  const hunks = parseHunks(patch);
  assert.equal(hunks.length, 1);
  assert.deepEqual(added(hunks[0]), ["star"]);
});

test("AC43: the patch of a file in the root commit", () => {
  const hunks = parseHunks(patchOf("root", { path: "notes.md", from: null }));
  assert.equal(hunks.length, 1);
  assert.deepEqual(added(hunks[0]), ["one", "two", "three"]);
});

test("parseStatus2 sees unmerged entries during a conflicted merge", () => {
  const dir = scratch();
  folders.push(dir);
  gitIn(dir, "init", "-q", "-b", "main");
  commit(dir, "base", { "f.txt": "one\n" });
  gitIn(dir, "switch", "-q", "-c", "other");
  commit(dir, "other side", { "f.txt": "two\n" });
  gitIn(dir, "switch", "-q", "main");
  const head = commit(dir, "main side", { "f.txt": "three\n" });
  assert.throws(() => gitIn(dir, "merge", "other"));
  const status = parseStatus2(git(statusArgs2(dir)));
  assert.ok(status.unmerged > 0);
  assert.equal(status.branch, "main");
  assert.equal(status.head, head);
});
