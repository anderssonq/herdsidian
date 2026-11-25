// The confirm gate of the Git tab (critical: data): readSnapshot, ActionGate, disabledReason and confirmText, checked
// against a small io of its own that answers the reads from a plain object and records every exec as [cmd, args, opts].
// AC45, AC47 to AC50, AC52 and the plan's Decision 5 with D4.
import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";

// The modules load lazily, so a missing one fails each test, not the file as one load error.
let disabledReason, cardOf, confirmText, readSnapshot, ActionGate;
const loaded = Promise.all([import("../mods/herdsidian/git-actions.js"), import("../mods/herdsidian/git-run.js")]).then(
  ([actions, run]) => { ({ disabledReason, cardOf, confirmText } = actions); ({ readSnapshot, ActionGate } = run); return null; },
  (error) => error);
const test = (name, fn) => nodeTest(name, async (t) => { const error = await loaded; if (error) throw error; return fn(t); });

const H = "1a2b3c4" + "d".repeat(33);
const H2 = "5e6f708" + "9".repeat(33);
const S = "7c8d9e0" + "f".repeat(33);
const S2 = "0a1b2c3" + "4".repeat(33);
const ROOT = "/work/repo";
const HERE = { cwd: ROOT, on: null };
const STALE = "The repo changed since you asked. Check again.";
const BAD_NAME = "Not a valid branch name";
const ACTIONS = ["fetch", "pull", "push", "branch", "stash", "pop"];
const WRITES = ["fetch", "pull", "push", "branch", "stash", "pop"];
const NUL = "\0";

// The middle repo: a branch with an upstream, 2 ahead and 1 behind, 3 changed files, one stash, no operation.
const UP = { remote: "origin", ref: "refs/heads/feat/login", short: "origin/feat/login" };
const BASE = { root: ROOT, head: H, branch: "feat/login", upstream: UP, ahead: 2, behind: 1, remotes: ["origin"], changed: 3,
  unmerged: 0, stash: { hash: S, gs: "On feat/login: wip notes" }, ops: [] };

// The git sub-command: the first word after the leading options (-C and -c take a value).
function subOf(args) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-C" || args[i] === "-c") { i++; continue; }
    if (args[i].startsWith("-")) continue;
    return args[i];
  }
  return null;
}

// The kind of a call: a write ("fetch" "pull" "push" "branch" "stash" "pop") or a read ("dirs" "status" "refs" "remotes"
// "stash-list" "check").
function kindOf(cmd, args) {
  if (cmd === "env") return ["fetch", "pull", "push"].find((k) => args.includes(k)) ?? "env";
  const sub = subOf(args);
  if (sub === "switch") return "branch";
  if (sub === "stash") return { push: "stash", pop: "pop", list: "stash-list" }[args[args.indexOf("stash") + 1]] ?? "stash-other";
  return { "rev-parse": "dirs", status: "status", "for-each-ref": "refs", remote: "remotes", "check-ref-format": "check" }[sub] ?? "other";
}

const done = (stdout = "", stderr = "", code = 0) => ({ stdout, stderr, code });

// `status --porcelain=v2 --branch --show-stash -z`, as P3 prints it.
function status2(s) {
  const records = [`# branch.oid ${s.head ?? "(initial)"}`, `# branch.head ${s.branch ?? "(detached)"}`];
  if (s.branch && s.upstream) records.push(`# branch.upstream ${s.upstream.short}`, `# branch.ab +${s.ahead} -${s.behind}`);
  if (s.stash) records.push("# stash 1");
  for (let i = 1; i <= s.changed; i++) {
    if (i % 3 === 0) records.push(`? notes/new${i}.txt`);
    else records.push(`1 .M N... 100644 100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} src/file${i}.js`);
  }
  for (let i = 1; i <= s.unmerged; i++) {
    records.push(`u UU N... 100644 100644 100644 100644 ${"a".repeat(40)} ${"b".repeat(40)} ${"c".repeat(40)} src/conflict${i}.js`);
  }
  return records.map((r) => r + NUL).join("");
}

// The for-each-ref lines of P3: refname, object, peeled, symref, upstream remote, upstream ref, "*" for HEAD.
function refLines(s) {
  const line = (fields) => fields.join(NUL) + "\n";
  if (!s.branch) return line(["refs/heads/main", s.head ?? "", "", "", "", "", " "]);
  const up = s.upstream;
  let out = line([`refs/heads/${s.branch}`, s.head ?? "", "", "", up?.remote ?? "", up?.ref ?? "", "*"]);
  if (up && up.remote !== ".") out += line([`refs/remotes/${up.short}`, s.head ?? "", "", "", "", "", " "]);
  return out;
}

// An io = { exec, readTextFile } that answers from a plain object. In the spec `changed` is the number of 1 and ? entries
// it prints and `unmerged` the number of u entries. spec adds: fail (read kinds that exit 128), reject
// (kinds whose exec rejects), readReject (readTextFile rejects), check (the exit code of check-ref-format), write (a result,
// or a function (cmd, args, opts) that returns one, throws, or returns a promise), hold ({ kind: promise } a read waits on).
function fakeIo(spec = {}) {
  const live = { ...BASE, fail: [], reject: [], readReject: false, check: 0, write: null, hold: {}, ...spec };
  const calls = [], files = [];
  const io = {
    calls, files, live,
    set: (patch) => { Object.assign(live, patch); },
    kinds: () => calls.map(([cmd, args]) => kindOf(cmd, args)),
    writes: () => calls.filter(([cmd, args]) => WRITES.includes(kindOf(cmd, args))),
    clear: () => { calls.length = 0; files.length = 0; },
    exec: async (cmd, args, opts) => {
      calls.push([cmd, args, opts]);
      const kind = kindOf(cmd, args);
      if (live.hold[kind]) await live.hold[kind];
      if (live.reject.includes(kind)) throw new Error(`fake ${kind} rejection`);
      if (WRITES.includes(kind)) {
        const reply = typeof live.write === "function" ? await live.write(cmd, args, opts) : live.write;
        return { stdout: "", stderr: "", code: 0, ...(reply ?? {}) };
      }
      if (live.fail.includes(kind)) return done("", `fatal: fake ${kind} failure\n`, 128);
      switch (kind) {
        case "dirs": return done(`${live.root}\n${live.root}/.git\n`);
        case "status": return done(status2(live));
        case "refs": return done(refLines(live));
        case "remotes": return done(live.remotes.map((r) => `${r}\n`).join(""));
        case "stash-list": return done(live.stash ? `${live.stash.hash}${NUL}${live.stash.gs}\n` : "");
        case "check": return done("", live.check === 0 ? "" : "fatal: not a valid branch name\n", live.check);
        default: return done();
      }
    },
    readTextFile: async (path, opts) => {
      files.push([path, opts]);
      if (live.readReject) throw new Error("fake read rejection");
      return live.ops.some((name) => path.endsWith(`/${name}`)) ? "1\n" : null;
    },
  };
  return io;
}

// A promise the test resolves later.
function deferred() {
  const hold = {};
  hold.promise = new Promise((resolve, reject) => { hold.resolve = resolve; hold.reject = reject; });
  return hold;
}

// Lets started tasks move until `ready()` holds (no real wait: one event-loop turn per try).
async function until(ready) {
  for (let i = 0; i < 500; i++) {
    if (ready()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("the condition never held");
}

// A few event-loop turns, so a task a method started could reach exec before the log is checked.
async function turns(count = 5) {
  for (let i = 0; i < count; i++) await new Promise((resolve) => setImmediate(resolve));
  // A later 1 ms timer fires after any 0/1 ms timer a method set, so a deferred exec is caught too.
  await new Promise((resolve) => setTimeout(resolve, 1));
}

// A gate with an open card for `action`, made from a snapshot read through the same io; the log starts empty.
async function cardFor(action, spec = {}, where = HERE) {
  const io = fakeIo(spec);
  const snap = await readSnapshot(io, where);
  io.clear();
  const gate = new ActionGate(io);
  assert.equal(gate.press(action, snap, where), "card");
  return { io, gate, snap };
}

const panel = (outcome) => [outcome.title, ...outcome.lines];
const env = (...rest) => ["GIT_TERMINAL_PROMPT=0", "git", "-C", ROOT, ...rest];

// ---------- readSnapshot ----------

test("readSnapshot reads a normal repo from a subfolder", async () => {
  const io = fakeIo();
  const snap = await readSnapshot(io, { cwd: `${ROOT}/src`, on: null });
  assert.equal(snap.error, undefined);
  assert.equal(snap.root, ROOT);
  assert.equal(snap.gitDir, `${ROOT}/.git`);
  assert.equal(snap.on, null);
  assert.equal(snap.head, H);
  assert.equal(snap.branch, "feat/login");
  assert.deepEqual(snap.upstream, UP);
  assert.equal(snap.ahead, 2);
  assert.equal(snap.behind, 1);
  assert.deepEqual(snap.remotes, ["origin"]);
  assert.equal(snap.changed, 3);
  assert.equal(snap.unmerged, 0);
  assert.equal(snap.op, null);
  assert.equal(snap.stash.hash, S);
  assert.equal(snap.stash.message, "On feat/login: wip notes");
  assert.deepEqual(snap.refs.map(({ full, kind, sha, current }) => ({ full, kind, sha, current })), [
    { full: "refs/heads/feat/login", kind: "local", sha: H, current: true },
    { full: "refs/remotes/origin/feat/login", kind: "remote", sha: H, current: false },
  ]);
  // S1 runs in the folder asked for; every other read runs in the root.
  const [first, ...rest] = io.calls;
  assert.equal(kindOf(first[0], first[1]), "dirs");
  assert.equal(first[1][first[1].indexOf("-C") + 1], `${ROOT}/src`);
  for (const [, args] of rest) assert.equal(args[args.indexOf("-C") + 1], ROOT, args.join(" "));
  assert.deepEqual(io.writes(), []);
});

// R8: changed counts every porcelain v2 entry (1, 2, u, ?); unmerged counts the u entries only.
test("readSnapshot counts an unmerged entry in changed and in unmerged", async () => {
  const snap = await readSnapshot(fakeIo({ changed: 3, unmerged: 1 }), HERE);
  assert.equal(snap.changed, 4);
  assert.equal(snap.unmerged, 1);
});

test("readSnapshot finds an operation in progress from a file in the git dir", async () => {
  const io = fakeIo({ ops: ["MERGE_HEAD"] });
  const snap = await readSnapshot(io, HERE);
  assert.equal(snap.op, "merge");
  assert.ok(io.files.some(([path]) => path === `${ROOT}/.git/MERGE_HEAD`));
});

test("readSnapshot passes { on } to every exec and file read, and never uses cwd", async () => {
  const io = fakeIo();
  const snap = await readSnapshot(io, { cwd: ROOT, on: "devbox" });
  assert.equal(snap.on, "devbox");
  assert.ok(io.calls.length >= 5);
  for (const [cmd, args, opts] of io.calls) {
    assert.equal(opts?.on, "devbox", `${cmd} ${args.join(" ")}`);
    assert.ok(!("cwd" in opts), `${cmd} ${args.join(" ")}`);
    assert.ok(args.includes("-C"), `${cmd} ${args.join(" ")}`);
  }
  assert.ok(io.files.length > 0);
  for (const [path, opts] of io.files) assert.equal(opts?.on, "devbox", path);
});

for (const [name, spec] of [
  ["a rejected exec", { reject: ["refs"] }],
  ["a non-zero status", { fail: ["status"] }],
  ["a non-zero rev-parse", { fail: ["dirs"] }],
  ["a rejected file read", { readReject: true }],
]) {
  test(`readSnapshot gives { error } for ${name}`, async () => {
    const snap = await readSnapshot(fakeIo(spec), HERE);
    assert.ok(snap && snap.error, JSON.stringify(snap));
    assert.equal(snap.root, undefined);
  });
}

// ---------- AC45: a click opens a card and runs nothing ----------

for (const action of ["pull", "push", "branch", "stash", "pop"]) {
  test(`AC45: press(${action}) opens a card and runs no command; cancel and drop run nothing`, async () => {
    const { io, gate } = await cardFor(action);
    assert.equal(gate.card?.action, action);
    assert.equal(gate.card.root, ROOT);
    await turns();
    assert.deepEqual(io.calls, []);
    gate.cancel();
    assert.equal(gate.card, null);
    await turns();
    assert.deepEqual(io.calls, []);
    const io2 = fakeIo();
    const snap = await readSnapshot(io2, HERE);
    io2.clear();
    const gate2 = new ActionGate(io2);
    assert.equal(gate2.press(action, snap, HERE), "card");
    gate2.drop();
    assert.equal(gate2.card, null);
    await turns();
    assert.deepEqual(io2.calls, []);
  });
}

test("AC45: a new click replaces an open card and still runs nothing", async () => {
  const { io, gate, snap } = await cardFor("pull");
  assert.equal(gate.press("stash", snap, HERE), "card");
  assert.equal(gate.card.action, "stash");
  await turns();
  assert.deepEqual(io.calls, []);
});

test("AC45: Fetch answers run with no card, and run() makes exactly the Fetch call", async () => {
  const io = fakeIo();
  const snap = await readSnapshot(io, HERE);
  io.clear();
  const gate = new ActionGate(io);
  assert.equal(gate.press("fetch", snap, HERE), "run");
  assert.equal(gate.card, null);
  await turns();
  assert.deepEqual(io.calls, []);
  const outcome = await gate.run();
  // One write, the Fetch, and it is the first call; a read of the top stash after it is allowed (R7).
  assert.equal(io.writes().length, 1);
  assert.equal(io.calls[0][0], "env");
  assert.deepEqual(io.calls[0][1], env("fetch", "--all"));
  assert.equal(outcome.kind, "done");
});

test("AC48: press on a disabled action answers null, opens no card and runs nothing", async () => {
  const io = fakeIo({ stash: null });
  const snap = await readSnapshot(io, HERE);
  io.clear();
  const gate = new ActionGate(io);
  assert.equal(gate.press("pop", snap, HERE), null);
  assert.equal(gate.card, null);
  await turns();
  assert.deepEqual(io.calls, []);
});

// ---------- the control: an unchanged repo runs exactly the builder's command ----------

for (const [action, input, cmd, args] of [
  ["pull", undefined, "env", env("pull", "--ff-only", "--no-rebase", "--no-autostash")],
  ["push", undefined, "env", env("push", "origin", "refs/heads/feat/login:refs/heads/feat/login")],
  ["branch", "  feat/new  ", "git", ["-C", ROOT, "switch", "-c", "feat/new"]],
  ["stash", "", "git", ["-C", ROOT, "stash", "push", "--include-untracked"]],
  ["stash", "  wip notes ", "git", ["-C", ROOT, "stash", "push", "--include-untracked", "-m", "wip notes"]],
  ["pop", undefined, "git", ["-C", ROOT, "stash", "pop"]],
]) {
  test(`AC45 control: confirm(${action}${input ? `, "${input}"` : ""}) on the same repo runs one write`, async () => {
    const { io, gate } = await cardFor(action);
    const outcome = await gate.confirm(HERE, input);
    const writes = io.writes();
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0], cmd);
    assert.deepEqual(writes[0][1], args);
    assert.equal(outcome.kind, "done");
    assert.equal(gate.result.kind, "done");
    assert.equal(gate.card, null);
  });
}

// ---------- AC47 and D4: the re-check at confirm ----------

for (const c of [
  { name: "another machine", action: "pull", cardWhere: { cwd: ROOT, on: "devbox" }, where: { cwd: ROOT, on: "other" }, change: {} },
  { name: "another root", action: "pull", where: { cwd: "/work/other", on: null }, change: { root: "/work/other" } },
  { name: "another branch", action: "pull", change: { branch: "feat/signup" } },
  { name: "detached now", action: "stash", change: { branch: null, upstream: null } },
  { name: "another upstream", action: "pull", change: { upstream: { remote: "origin", ref: "refs/heads/main", short: "origin/main" } } },
  { name: "an operation started", action: "push", change: { ops: ["MERGE_HEAD"] } },
  { name: "another head for Branch", action: "branch", input: "feat/new", change: { head: H2 } },
  { name: "another changed count for Stash", action: "stash", input: "", change: { changed: 4 } },
  { name: "another top stash for Pop", action: "pop", change: { stash: { hash: S2, gs: "On feat/login: wip notes" } } },
  { name: "no snapshot", action: "pull", change: { fail: ["status"] } },
  // D4: every compared field is the same, but Push is now disabled ("Nothing to push").
  { name: "D4: Push with nothing ahead now", action: "push", change: { ahead: 0 } },
]) {
  test(`AC47: ${c.name} runs no write and says the repo changed`, async () => {
    const { io, gate } = await cardFor(c.action, {}, c.cardWhere ?? HERE);
    io.set(c.change);
    const outcome = await gate.confirm(c.where ?? HERE, c.input);
    assert.deepEqual(io.writes(), []);
    assert.equal(gate.result?.kind, "stale");
    assert.ok(panel(gate.result).includes(STALE), JSON.stringify(gate.result));
    assert.equal(outcome?.kind, "stale");
    assert.equal(gate.card, null);
    assert.equal(gate.running, null);
  });
}

test("AC47: a card dropped while the re-check is in flight runs nothing", async () => {
  const { io, gate } = await cardFor("pull");
  const hold = deferred();
  io.set({ hold: { dirs: hold.promise } });
  const pending = gate.confirm(HERE);
  await until(() => io.kinds().includes("dirs"));
  gate.drop();
  hold.resolve();
  await pending;
  assert.deepEqual(io.writes(), []);
  assert.equal(gate.card, null);
  assert.equal(gate.running, null);
});

test("AC47: a second confirm during the first answers null and adds no call", async () => {
  const { io, gate } = await cardFor("pull");
  const hold = deferred();
  io.set({ hold: { dirs: hold.promise } });
  const first = gate.confirm(HERE);
  await until(() => io.kinds().includes("dirs"));
  const before = io.calls.length;
  assert.equal(await gate.confirm(HERE), null);
  assert.equal(io.calls.length, before);
  hold.resolve();
  await first;
  assert.equal(io.writes().length, 1);
});

// ---------- AC48: disabledReason, one cause at a time ----------

// A hand-made snapshot of the middle repo, every action enabled.
const SNAP = { root: ROOT, gitDir: `${ROOT}/.git`, on: null, head: H, branch: "feat/login", upstream: UP, ahead: 2, behind: 1,
  remotes: ["origin"], changed: 3, unmerged: 0, op: null, stash: { hash: S, message: "On feat/login: wip notes" }, refs: [] };
const snapWith = (patch) => ({ ...SNAP, ...patch });

test("AC48: the middle repo enables all six actions", () => {
  for (const action of ACTIONS) assert.equal(disabledReason(action, SNAP, null), null, action);
});

test("AC48: a running action disables all six with its label", () => {
  for (const action of ACTIONS) {
    assert.equal(disabledReason(action, SNAP, { action: "push", root: ROOT, on: null }), "Push is running", action);
  }
});

test("AC48: no snapshot disables all six", () => {
  for (const action of ACTIONS) {
    assert.equal(disabledReason(action, null, null), "Cannot read the repo state", action);
    assert.equal(disabledReason(action, { error: "fatal: fake" }, null), "Cannot read the repo state", action);
  }
});

const cases = [
  { cause: "no commits yet", patch: { head: null }, reasons: { fetch: null, pull: "No commits yet", push: "No commits yet",
    branch: "No commits yet", stash: "No commits yet", pop: "No commits yet" } },
  { cause: "no remote", patch: { remotes: [] }, reasons: { fetch: "No remote", pull: "No remote", push: "No remote",
    branch: null, stash: null, pop: null } },
  { cause: "detached HEAD", patch: { branch: null, upstream: null, ahead: null, behind: null }, reasons: { fetch: null,
    pull: "Detached HEAD", push: "Detached HEAD", branch: null, stash: null, pop: null } },
  { cause: "a merge in progress", patch: { op: "merge" }, reasons: { fetch: null, pull: "Finish the merge first", push: null,
    branch: "Finish the merge first", stash: "Finish the merge first", pop: "Finish the merge first" } },
  { cause: "a rebase in progress", patch: { op: "rebase" }, reasons: { fetch: null, pull: "Finish the rebase first", push: null,
    branch: "Finish the rebase first", stash: "Finish the rebase first", pop: "Finish the rebase first" } },
  { cause: "unmerged paths with no operation", patch: { unmerged: 1 }, reasons: { fetch: null, pull: "Resolve the conflicts first",
    push: null, branch: "Resolve the conflicts first", stash: "Resolve the conflicts first", pop: "Resolve the conflicts first" } },
  { cause: "no upstream, one remote (Push publishes)", patch: { upstream: null, ahead: null, behind: null }, reasons: { fetch: null,
    pull: "No upstream branch", push: null, branch: null, stash: null, pop: null } },
  { cause: "an upstream on the local repo", patch: { upstream: { remote: ".", ref: "refs/heads/main", short: "main" } },
    reasons: { fetch: null, pull: null, push: "Upstream is a local branch", branch: null, stash: null, pop: null } },
  { cause: "nothing ahead", patch: { ahead: 0 }, reasons: { fetch: null, pull: null, push: "Nothing to push", branch: null,
    stash: null, pop: null } },
  { cause: "no upstream and two remotes without origin", patch: { upstream: null, ahead: null, behind: null, remotes: ["fork", "mirror"] },
    reasons: { fetch: null, pull: "No upstream branch", push: "Several remotes: push from a terminal", branch: null, stash: null, pop: null } },
  { cause: "no upstream and two remotes with origin", patch: { upstream: null, ahead: null, behind: null, remotes: ["fork", "origin"] },
    reasons: { fetch: null, pull: "No upstream branch", push: null, branch: null, stash: null, pop: null } },
  { cause: "nothing changed", patch: { changed: 0 }, reasons: { fetch: null, pull: null, push: null, branch: null,
    stash: "Nothing to stash", pop: null } },
  { cause: "no stash", patch: { stash: null }, reasons: { fetch: null, pull: null, push: null, branch: null, stash: null,
    pop: "No stash" } },
];
for (const { cause, patch, reasons } of cases) {
  test(`AC48: disabledReason with ${cause}`, () => {
    for (const action of ACTIONS) assert.equal(disabledReason(action, snapWith(patch), null), reasons[action], action);
  });
}

// ---------- AC49: one action at a time ----------

test("AC49: while a write runs every press answers null, drop keeps it running, and the result still arrives", async () => {
  const hold = deferred();
  const { io, gate, snap } = await cardFor("pull", { write: () => hold.promise });
  const pending = gate.confirm(HERE);
  await until(() => io.writes().length === 1);
  assert.equal(gate.running?.action, "pull");
  assert.equal(gate.running.root, ROOT);
  const before = io.calls.length;
  for (const action of ACTIONS) assert.equal(gate.press(action, snap, HERE), null, action);
  assert.equal(gate.card, null);
  assert.equal(disabledReason("fetch", snap, gate.running), "Pull is running");
  gate.drop();
  assert.equal(gate.running?.action, "pull");
  assert.equal(io.calls.length, before);
  hold.resolve({ code: 0, stdout: "Updating 1a2b3c4..5e6f708\nFast-forward\n", stderr: "" });
  const outcome = await pending;
  assert.equal(outcome.kind, "done");
  assert.equal(gate.result?.kind, "done");
  assert.equal(gate.running, null);
  assert.equal(io.writes().length, 1);
});

// ---------- AC50 and AC53: the outcome ----------

test("AC50: a non-zero exit fails with at most 4 non-hint stderr lines and the full output", async () => {
  const stderr = "hint: one\nerror: a\nhint: two\nfatal: b\nline c\nline d\nline e\n";
  const stdout = "From origin\n";
  const { gate } = await cardFor("pull", { write: { code: 1, stdout, stderr } });
  const outcome = await gate.confirm(HERE);
  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.title, "Pull failed");
  assert.equal(outcome.lines.length, 4, JSON.stringify(outcome.lines));
  assert.equal(new Set(outcome.lines).size, 4, JSON.stringify(outcome.lines));
  const allowed = ["error: a", "fatal: b", "line c", "line d", "line e"];
  for (const line of outcome.lines) {
    assert.ok(!line.startsWith("hint:"), line);
    assert.ok(allowed.includes(line), line);
  }
  assert.ok(outcome.full.includes(stderr), outcome.full);
  assert.ok(outcome.full.includes(stdout), outcome.full);
  assert.equal(gate.result.kind, "failed");
});

test("AC50: a short failure shows its non-hint stderr lines exactly", async () => {
  const { gate } = await cardFor("pull", { write: { code: 128, stdout: "", stderr: "hint: Diverging branches\nfatal: Not possible to fast-forward, aborting.\n" } });
  const outcome = await gate.confirm(HERE);
  assert.equal(outcome.kind, "failed");
  assert.deepEqual(outcome.lines, ["fatal: Not possible to fast-forward, aborting."]);
});

test("AC50: a failure with an empty stderr shows the stdout lines", async () => {
  const { gate } = await cardFor("push", { write: { code: 1, stdout: "error: failed to push\nhint: pull first\nrejected\n", stderr: "" } });
  const outcome = await gate.confirm(HERE);
  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.title, "Push failed");
  assert.deepEqual(outcome.lines, ["error: failed to push", "rejected"]);
});

for (const [action, input, seconds] of [["pull", undefined, 120], ["stash", "", 30]]) {
  test(`AC50: a rejected exec for ${action} says git did not answer in ${seconds} s`, async () => {
    const message = "`herdr.exec`: git took longer than it may and was stopped";
    const { gate } = await cardFor(action, { write: () => { throw new Error(message); } });
    const outcome = await gate.confirm(HERE, input);
    assert.equal(outcome.kind, "no-answer");
    assert.equal(outcome.title, `${action === "pull" ? "Pull" : "Stash"} failed`);
    assert.deepEqual(outcome.lines, [`Git did not answer in ${seconds} s. Check the repo in a terminal before you try again.`]);
    assert.ok(outcome.full.includes(message), outcome.full);
    assert.equal(gate.result.kind, "no-answer");
    assert.equal(gate.running, null);
  });
}

test("AC53: an exit 0 is done with the first non-hint line, stdout first", async () => {
  const { gate } = await cardFor("pull", { write: { code: 0, stdout: "hint: quiet\nUpdating 1a2b3c4..5e6f708\nFast-forward\n", stderr: "From origin\n" } });
  const outcome = await gate.confirm(HERE);
  assert.equal(outcome.kind, "done");
  assert.equal(outcome.title, "Pull done");
  assert.deepEqual(outcome.lines, ["Updating 1a2b3c4..5e6f708"]);
});

test("AC53: an exit 0 with only stderr output takes its first non-hint line", async () => {
  const io = fakeIo({ write: { code: 0, stdout: "", stderr: "hint: quiet\nFrom origin\n * branch main\n" } });
  const snap = await readSnapshot(io, HERE);
  const gate = new ActionGate(io);
  assert.equal(gate.press("fetch", snap, HERE), "run");
  const outcome = await gate.run();
  assert.equal(outcome.title, "Fetch done");
  assert.deepEqual(outcome.lines, ["From origin"]);
});

test("Pop: a failed Pop with the card's stash still on top says the stash was kept", async () => {
  const { gate } = await cardFor("pop", { write: { code: 1, stdout: "", stderr: "error: conflict in src/file1.js\n" } });
  const outcome = await gate.confirm(HERE);
  assert.equal(outcome.kind, "failed");
  assert.ok(outcome.lines.includes("The stash was kept (stash@{0})."), JSON.stringify(outcome.lines));
});

test("Pop: a failed Pop with another stash on top does not say the stash was kept", async () => {
  const { io, gate } = await cardFor("pop");
  io.set({ write: () => { io.set({ stash: { hash: S2, gs: "On feat/login: other" } }); return { code: 1, stderr: "error: conflict in src/file1.js\n" }; } });
  const outcome = await gate.confirm(HERE);
  assert.equal(outcome.kind, "failed");
  assert.ok(!panel(outcome).includes("The stash was kept (stash@{0})."), JSON.stringify(outcome.lines));
});

// ---------- AC52: the branch name ----------

for (const name of ["", "  ", "-x", "@{-1}"]) {
  test(`AC52: confirm on a Branch card with ${JSON.stringify(name)} shows the name error and runs nothing`, async () => {
    const { io, gate } = await cardFor("branch");
    assert.equal(await gate.confirm(HERE, name), null);
    assert.equal(gate.nameError, BAD_NAME);
    assert.equal(gate.card?.action, "branch");
    await turns();
    assert.deepEqual(io.calls, []);
  });
}

test("AC52: a name check-ref-format refuses shows the name error and runs no switch", async () => {
  const { io, gate } = await cardFor("branch", { check: 1 });
  await gate.confirm(HERE, "a b");
  assert.equal(gate.nameError, BAD_NAME);
  assert.equal(gate.card?.action, "branch");
  assert.ok(io.kinds().includes("check"));
  assert.ok(!io.kinds().includes("branch"));
  assert.deepEqual(io.writes(), []);
});

test("AC52: a valid name runs check-ref-format, then the reads, then switch -c with the trimmed name", async () => {
  const { io, gate } = await cardFor("branch");
  await gate.confirm(HERE, "  feat/new  ");
  const kinds = io.kinds();
  assert.equal(kinds[0], "check");
  assert.deepEqual(io.calls[0][0], "git");
  assert.deepEqual(io.calls[0][1], ["-C", ROOT, "check-ref-format", "--branch", "feat/new"]);
  // The switch need not be the last call (a gate may read the top stash after a write, R7), but no write follows it.
  const at = kinds.lastIndexOf("branch");
  assert.ok(at > 0, kinds.join(" "));
  assert.deepEqual(io.calls[at][1], ["-C", ROOT, "switch", "-c", "feat/new"]);
  const between = kinds.slice(1, at);
  assert.ok(between.includes("dirs") && between.includes("status"), kinds.join(" "));
  assert.ok(between.every((k) => !WRITES.includes(k)), kinds.join(" "));
  assert.ok(kinds.slice(at + 1).every((k) => !WRITES.includes(k)), kinds.join(" "));
  assert.equal(io.writes().length, 1);
  assert.equal(gate.nameError, null);
});

// ---------- AC46: confirmText ----------

test("AC46: confirmText gives the five texts and the publish variant with the real names", () => {
  assert.equal(confirmText(cardOf("pull", SNAP), ""),
    "Pull origin/feat/login into feat/login? Fast-forward only: no merge commit, no rebase. Your uncommitted changes stay; git stops if an incoming change touches a file you changed.");
  assert.equal(confirmText(cardOf("push", SNAP), ""),
    "Push feat/login to origin/feat/login? No force: git refuses if the remote has commits you do not have.");
  const publish = cardOf("push", snapWith({ upstream: null, ahead: null, behind: null, remotes: ["fork", "origin"] }));
  assert.equal(publish.publish, true);
  assert.equal(confirmText(publish, ""), "Publish feat/login to origin/feat/login and track it?");
  assert.equal(confirmText(cardOf("branch", SNAP), "  feat/new  "),
    "Create feat/new at 1a2b3c4 and switch to it? Your files do not change.");
  assert.equal(confirmText(cardOf("stash", SNAP), ""),
    "Stash 3 changed files, untracked files included? They leave the working tree; Pop brings them back.");
  assert.equal(confirmText(cardOf("pop", SNAP), ""),
    "Apply and drop stash@{0} (On feat/login: wip notes)? If it conflicts, git keeps the stash.");
});

// ---------- timeouts ----------

test("Fetch, Pull and Push pass timeout 120000; Branch, Stash and Pop pass no timeout", async () => {
  const where = { cwd: ROOT, on: "devbox" };
  const io = fakeIo();
  const snap = await readSnapshot(io, where);
  const fetchGate = new ActionGate(io);
  assert.equal(fetchGate.press("fetch", snap, where), "run");
  io.clear();
  await fetchGate.run();
  assert.deepEqual(io.writes()[0][2], { on: "devbox", timeout: 120000 });
  for (const [action, input] of [["pull"], ["push"], ["branch", "feat/new"], ["stash", ""], ["pop"]]) {
    const { io: one, gate } = await cardFor(action, {}, where);
    await gate.confirm(where, input);
    const [write] = one.writes();
    assert.ok(write, action);
    assert.equal(write[2].on, "devbox", action);
    if (["pull", "push"].includes(action)) assert.equal(write[2].timeout, 120000, action);
    else assert.ok(!("timeout" in write[2]), action);
  }
});
