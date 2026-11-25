// Git tab: every write action on real repos, run through its builder (AC51, AC52). Each test builds a bare origin and
// two clones in a temp folder and proves the action does its work, or fails and keeps the user's work.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// git-actions.js is new: before it exists each test fails on its own, not the whole file.
const actions = await import("../mods/herdsidian/git-actions.js").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});

// No user or system config, no inherited repo, a fixed author. Every inherited GIT_* key is dropped (a git hook's
// GIT_DIR would write into the wrong repo), so GIT_TERMINAL_PROMPT can come only from the builder's own arguments.
const isolated = realpathSync(mkdtempSync(join(tmpdir(), "herdsidian-git-home-")));
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
  SSH_ASKPASS: undefined,
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  HOME: isolated, XDG_CONFIG_HOME: isolated, GIT_ATTR_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test Author", GIT_AUTHOR_EMAIL: "author@example.com",
  GIT_COMMITTER_NAME: "Test Committer", GIT_COMMITTER_EMAIL: "committer@example.com" };
// cwd is the isolated temp folder (outside any repo), so a command that forgets `-C` can never touch the real checkout.
const quiet = { env, cwd: isolated, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 24 };

// Setup and checks: plain git, never a builder.
const git = (dir, ...args) => execFileSync("git", ["-C", dir, ...args], quiet);
const read = (dir, ...args) => git(dir, ...args).trim();

// The git verb is the argument after `-C <root>` (so `stash push` is not a Push).
const verbOf = (command) => command.args[command.args.indexOf("-C") + 2];

// Runs a builder's command exactly as returned: execFileSync(cmd, args), no shell; cwd is the isolated folder. A non-zero exit is a result.
// Every builder names its repo with `-C` (plan: `-C` everywhere); a network command turns the prompt off in its own arguments (AC44).
function run(command) {
  assert.ok(command.args.includes("-C"), JSON.stringify(command));
  if (["fetch", "pull", "push"].includes(verbOf(command))) {
    assert.equal(command.cmd, "env", JSON.stringify(command));
    assert.deepEqual(command.args.slice(0, 2), ["GIT_TERMINAL_PROMPT=0", "git"], JSON.stringify(command));
  }
  const options = command.timeout === undefined ? quiet : { ...quiet, timeout: command.timeout };
  try {
    return { code: 0, stdout: execFileSync(command.cmd, command.args, options), stderr: "" };
  } catch (error) {
    if (typeof error.status !== "number") throw error;
    return { code: error.status, stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? "") };
  }
}

const dirs = [isolated];
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

const put = (dir, name, text) => { mkdirSync(join(dir, name, ".."), { recursive: true }); writeFileSync(join(dir, name), text); };
const commit = (dir, name, text, message) => { put(dir, name, text); git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", message); };

// A bare origin with one commit on main, clone `a` tracking origin/main, and a second clone `b`.
function world() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "herdsidian-git-repo-")));
  dirs.push(dir);
  const origin = join(dir, "origin.git");
  const a = join(dir, "a");
  const b = join(dir, "b");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], quiet);
  mkdirSync(a);
  git(a, "init", "-q", "-b", "main");
  commit(a, "file.txt", "one\ntwo\nthree\n", "base");
  git(a, "remote", "add", "origin", origin);
  git(a, "push", "-q", "-u", "origin", "main");
  execFileSync("git", ["clone", "-q", origin, b], quiet);
  return { origin, a, b };
}

const headOf = (dir) => read(dir, "rev-parse", "HEAD");
const branchOf = (dir) => read(dir, "symbolic-ref", "--short", "HEAD");
const UPSTREAM = { remote: "origin", ref: "refs/heads/main", short: "origin/main" };
const pushMain = { branch: "main", remote: "origin", remoteRef: "refs/heads/main", publish: false };

// Fetch

test("AC51: Fetch shows a commit pushed from the second clone in origin/main, and the local branch does not move", () => {
  const { a, b } = world();
  commit(b, "file.txt", "one\ntwo\nthree\nfour\n", "from b");
  git(b, "push", "-q", "origin", "main");
  const before = headOf(a);

  const result = run(actions.fetchCommand(a));

  assert.equal(result.code, 0, result.stderr);
  assert.equal(read(a, "rev-parse", "refs/remotes/origin/main"), headOf(b));
  assert.equal(headOf(a), before);
  assert.equal(read(a, "rev-parse", "refs/heads/main"), before);
});

// Pull

test("AC51: Pull fast-forwards a clean branch", () => {
  const { a, b } = world();
  commit(b, "file.txt", "one\ntwo\nthree\nfour\n", "from b");
  git(b, "push", "-q", "origin", "main");

  const result = run(actions.pullCommand(a));

  assert.equal(result.code, 0, result.stderr);
  assert.equal(headOf(a), headOf(b));
  assert.equal(readFileSync(join(a, "file.txt"), "utf8"), "one\ntwo\nthree\nfour\n");
  assert.equal(read(a, "rev-list", "--merges", "--all"), "");
});

test("AC51: Pull with a local edit to a file the pull changes exits 1, keeps the edit byte-equal and HEAD the same", () => {
  const { a, b } = world();
  commit(b, "file.txt", "one\nTWO from b\nthree\n", "from b");
  git(b, "push", "-q", "origin", "main");
  const edit = Buffer.from("one\ntwo, my unsaved work ✓\nthree\n", "utf8");
  writeFileSync(join(a, "file.txt"), edit);
  const before = headOf(a);

  const result = run(actions.pullCommand(a));

  assert.equal(result.code, 1);
  assert.deepEqual(readFileSync(join(a, "file.txt")), edit);
  assert.equal(headOf(a), before);
});

test("AC51, AC50: Pull on diverged branches exits non-zero, keeps HEAD, makes no merge commit, and outcomeOf shows no hint line", () => {
  const { a, b } = world();
  commit(b, "theirs.txt", "theirs\n", "from b");
  git(b, "push", "-q", "origin", "main");
  commit(a, "mine.txt", "mine\n", "from a");
  const before = headOf(a);

  const result = run(actions.pullCommand(a));

  assert.notEqual(result.code, 0);
  assert.equal(headOf(a), before);
  assert.equal(read(a, "rev-list", "--merges", "--all"), "");
  assert.equal(readFileSync(join(a, "mine.txt"), "utf8"), "mine\n");

  const card = { action: "pull", root: a, on: null, head: before, branch: "main", upstream: UPSTREAM, op: null,
    changed: 0, stash: null, publish: false, remote: "origin", remoteRef: "refs/heads/main" };
  const outcome = actions.outcomeOf(card, result);
  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.title, "Pull failed");
  assert.ok(outcome.lines.length >= 1 && outcome.lines.length <= 4, JSON.stringify(outcome.lines));
  assert.equal(outcome.lines.some((l) => l.startsWith("hint:")), false, JSON.stringify(outcome.lines));
});

// Push

test("AC51: Push of a branch ahead updates the remote ref", () => {
  const { origin, a } = world();
  commit(a, "file.txt", "one\ntwo\nthree\nfour\n", "ahead");

  const result = run(actions.pushCommand(a, pushMain));

  assert.equal(result.code, 0, result.stderr);
  assert.equal(read(origin, "rev-parse", "refs/heads/main"), headOf(a));
});

test("AC51: Push of a branch behind exits 1 and the remote ref stays the same", () => {
  const { origin, a, b } = world();
  commit(b, "file.txt", "one\ntwo\nthree\nfour\n", "from b");
  git(b, "push", "-q", "origin", "main");
  git(a, "fetch", "-q", "origin");
  const remoteBefore = read(origin, "rev-parse", "refs/heads/main");
  const before = headOf(a);

  const result = run(actions.pushCommand(a, pushMain));

  assert.equal(result.code, 1);
  assert.equal(read(origin, "rev-parse", "refs/heads/main"), remoteBefore);
  assert.equal(headOf(a), before);
});

test("AC51: Push of a branch with no upstream publishes it and it tracks origin/<branch>", () => {
  const { origin, a } = world();
  git(a, "switch", "-q", "-c", "feat/x");
  commit(a, "feature.txt", "feature\n", "feature");

  const result = run(actions.pushCommand(a, { branch: "feat/x", remote: "origin", remoteRef: null, publish: true }));

  assert.equal(result.code, 0, result.stderr);
  assert.equal(read(origin, "rev-parse", "refs/heads/feat/x"), headOf(a));
  assert.equal(read(a, "for-each-ref", "--format=%(upstream:short)|%(upstream:remotename)|%(upstream:remoteref)", "refs/heads/feat/x"),
    "origin/feat/x|origin|refs/heads/feat/x");
});

// Branch

test("AC51: Branch creates and switches at HEAD, with the edited and untracked files untouched", () => {
  const { a } = world();
  put(a, "file.txt", "one\nedited\nthree\n");
  put(a, "notes/new.txt", "untracked\n");
  const status = git(a, "status", "--porcelain");
  const before = headOf(a);
  assert.match(status, /^ M file\.txt$/m, "fixture: a tracked edit");
  assert.match(status, /^\?\? notes\/$/m, "fixture: an untracked file");

  const result = run(actions.branchCommand(a, "feat/new"));

  assert.equal(result.code, 0, result.stderr);
  assert.equal(branchOf(a), "feat/new");
  assert.equal(headOf(a), before);
  assert.equal(read(a, "rev-parse", "refs/heads/feat/new"), before);
  assert.equal(git(a, "status", "--porcelain"), status);
  assert.equal(readFileSync(join(a, "file.txt"), "utf8"), "one\nedited\nthree\n");
});

test("AC51: Branch with an existing name exits non-zero, both branches keep their commits, still on the first branch", () => {
  const { a } = world();
  commit(a, "file.txt", "one\ntwo\nthree\nfour\n", "second");
  git(a, "branch", "feat/old", "HEAD~1");
  const main = read(a, "rev-parse", "refs/heads/main");
  const old = read(a, "rev-parse", "refs/heads/feat/old");
  assert.notEqual(main, old, "fixture: the two branches are at different commits");

  const result = run(actions.branchCommand(a, "feat/old"));

  assert.notEqual(result.code, 0);
  assert.equal(read(a, "rev-parse", "refs/heads/main"), main);
  assert.equal(read(a, "rev-parse", "refs/heads/feat/old"), old);
  assert.equal(branchOf(a), "main");
});

// Stash

test("AC51: Stash takes a tracked edit and an untracked file out of the tree, and stash@{0} holds both", () => {
  const { a } = world();
  put(a, "file.txt", "one\nedited\nthree\n");
  put(a, "new.txt", "untracked\n");

  const result = run(actions.stashCommand(a, ""));

  assert.equal(result.code, 0, result.stderr);
  assert.equal(git(a, "status", "--porcelain"), "");
  assert.equal(readFileSync(join(a, "file.txt"), "utf8"), "one\ntwo\nthree\n");
  assert.equal(existsSync(join(a, "new.txt")), false);
  assert.equal(git(a, "show", "stash@{0}:file.txt"), "one\nedited\nthree\n");
  assert.equal(git(a, "show", "stash@{0}^3:new.txt"), "untracked\n");
});

test("AC51: Stash with a message shows it in stash list", () => {
  const { a } = world();
  put(a, "file.txt", "one\nedited\nthree\n");

  const result = run(actions.stashCommand(a, "wip notes"));

  assert.equal(result.code, 0, result.stderr);
  assert.equal(read(a, "stash", "list", "--format=%gs"), "On main: wip notes");
});

test("AC51: Stash with a message that starts with - stores it as typed", () => {
  const { a } = world();
  put(a, "new.txt", "untracked\n");

  const result = run(actions.stashCommand(a, "-wip notes"));

  assert.equal(result.code, 0, result.stderr);
  assert.equal(read(a, "stash", "list", "--format=%gs"), "On main: -wip notes");
  assert.equal(existsSync(join(a, "new.txt")), false);
});

// Pop

test("AC51: Pop brings back the tracked edit and the untracked file, and drops the entry", () => {
  const { a } = world();
  put(a, "file.txt", "one\nedited\nthree\n");
  put(a, "new.txt", "untracked\n");
  assert.equal(run(actions.stashCommand(a, "")).code, 0, "fixture: the stash ran");

  const result = run(actions.popCommand(a));

  assert.equal(result.code, 0, result.stderr);
  assert.equal(readFileSync(join(a, "file.txt"), "utf8"), "one\nedited\nthree\n");
  assert.equal(readFileSync(join(a, "new.txt"), "utf8"), "untracked\n");
  assert.equal(read(a, "stash", "list"), "");
});

test("AC51: a conflicting Pop exits 1, the stash entry is kept, and HEAD is the same", () => {
  const { a } = world();
  put(a, "file.txt", "one\nmine\nthree\n");
  assert.equal(run(actions.stashCommand(a, "mine")).code, 0, "fixture: the stash ran");
  commit(a, "file.txt", "one\ncommitted\nthree\n", "conflicting");
  const stash = read(a, "rev-parse", "stash@{0}");
  const before = headOf(a);

  const result = run(actions.popCommand(a));

  assert.equal(result.code, 1);
  assert.equal(read(a, "rev-parse", "stash@{0}"), stash);
  assert.equal(read(a, "stash", "list", "--format=%gs"), "On main: mine");
  assert.equal(headOf(a), before);

  // R7–R9: extra is the top stash read again after the action.
  const card = { action: "pop", root: a, on: null, head: before, branch: "main", upstream: UPSTREAM, op: null,
    changed: 0, stash: { hash: stash, message: "On main: mine" }, publish: false, remote: "origin", remoteRef: "refs/heads/main" };
  const outcome = actions.outcomeOf(card, result, { stash: { hash: read(a, "rev-parse", "stash@{0}"), message: "On main: mine" } });
  assert.equal(outcome.kind, "failed");
  assert.ok(outcome.lines.includes("The stash was kept (stash@{0})."), JSON.stringify(outcome.lines));
});

// Branch names (AC52)

test("AC52: checkNameCommand exits 0 for feat/ok and non-zero for \"a b\" and \"x..y\"", () => {
  const { a } = world();
  assert.equal(run(actions.checkNameCommand(a, "feat/ok")).code, 0);
  assert.notEqual(run(actions.checkNameCommand(a, "a b")).code, 0);
  assert.notEqual(run(actions.checkNameCommand(a, "x..y")).code, 0);
});

test("AC52: branchCommand with a name that passes the pure check but not git (\"a b\") exits non-zero and creates nothing", () => {
  const { a } = world();
  assert.equal(actions.branchNameError("a b"), null, "fixture: the pure check lets it through");
  const refs = read(a, "for-each-ref", "--format=%(refname) %(objectname)");
  const before = headOf(a);

  const result = run(actions.branchCommand(a, "a b"));

  assert.notEqual(result.code, 0);
  assert.equal(read(a, "for-each-ref", "--format=%(refname) %(objectname)"), refs);
  assert.equal(branchOf(a), "main");
  assert.equal(headOf(a), before);
});
