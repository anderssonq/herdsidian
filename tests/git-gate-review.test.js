// The confirm gate's fixes after the group B review (critical: data, ruling R14): run() and confirm() never overlap, a card
// clears a pending Fetch, drop() compares root and machine, a check-ref-format that does not answer, a remote named like a flag.
// Same pattern as git-gate.test.js: a small io of its own that answers the reads from a plain object and records every exec.
import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";

// The modules load lazily, so a missing one fails each test, not the file as one load error.
let disabledReason, readSnapshot, ActionGate;
const loaded = Promise.all([import("../mods/herdsidian/git-actions.js"), import("../mods/herdsidian/git-run.js")]).then(
  ([actions, run]) => { ({ disabledReason } = actions); ({ readSnapshot, ActionGate } = run); return null; },
  (error) => error);
const test = (name, fn) => nodeTest(name, async (t) => { const error = await loaded; if (error) throw error; return fn(t); });

const H = "1a2b3c4" + "d".repeat(33);
const S = "7c8d9e0" + "f".repeat(33);
const ROOT = "/work/repo";
const HERE = { cwd: ROOT, on: null };
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

// The kind of a call: a write ("fetch" "pull" "push" "branch" "stash" "pop") or a read.
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
  return records.map((r) => r + NUL).join("");
}

// The for-each-ref lines of P3: refname, object, peeled, symref, upstream remote, upstream ref, "*" for HEAD.
function refLines(s) {
  const line = (fields) => fields.join(NUL) + "\n";
  const up = s.upstream;
  let out = line([`refs/heads/${s.branch}`, s.head ?? "", "", "", up?.remote ?? "", up?.ref ?? "", "*"]);
  if (up) out += line([`refs/remotes/${up.short}`, s.head ?? "", "", "", "", "", " "]);
  return out;
}

// An io = { exec, readTextFile } that answers from a plain object. spec adds: reject (kinds whose exec rejects), write (a
// function (cmd, args, opts) that returns a result or a promise), hold ({ kind: promise } a call waits on). It counts the
// writes in flight at once (`most`).
function fakeIo(spec = {}) {
  const live = { ...BASE, reject: [], write: null, hold: {}, ...spec };
  const calls = [];
  let inFlight = 0;
  const io = {
    calls, live, most: 0,
    set: (patch) => { Object.assign(live, patch); },
    kinds: () => calls.map(([cmd, args]) => kindOf(cmd, args)),
    writes: () => calls.filter(([cmd, args]) => WRITES.includes(kindOf(cmd, args))),
    clear: () => { calls.length = 0; },
    exec: async (cmd, args, opts) => {
      calls.push([cmd, args, opts]);
      const kind = kindOf(cmd, args);
      if (live.hold[kind]) await live.hold[kind];
      if (live.reject.includes(kind)) throw new Error(`fake ${kind} rejection`);
      if (WRITES.includes(kind)) {
        inFlight++;
        io.most = Math.max(io.most, inFlight);
        try {
          const reply = typeof live.write === "function" ? await live.write(cmd, args, opts) : live.write;
          return { stdout: "", stderr: "", code: 0, ...(reply ?? {}) };
        } finally {
          inFlight--;
        }
      }
      switch (kind) {
        case "dirs": return done(`${live.root}\n${live.root}/.git\n`);
        case "status": return done(status2(live));
        case "refs": return done(refLines(live));
        case "remotes": return done(live.remotes.map((r) => `${r}\n`).join(""));
        case "stash-list": return done(live.stash ? `${live.stash.hash}${NUL}${live.stash.gs}\n` : "");
        case "check": return done();
        default: return done();
      }
    },
    readTextFile: async () => null,
  };
  return io;
}

// A promise the test resolves later.
function deferred() {
  const hold = {};
  hold.promise = new Promise((resolve, reject) => { hold.resolve = resolve; hold.reject = reject; });
  return hold;
}

// A few event-loop turns and one 1 ms timer, so a task a method started could reach exec before the log is checked.
async function turns(count = 5) {
  for (let i = 0; i < count; i++) await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 1));
}

// Lets started tasks move until `ready()` holds.
async function until(ready) {
  for (let i = 0; i < 500; i++) {
    if (ready()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("the condition never held");
}

// A gate over a snapshot read through the same io; the log starts empty.
async function gateOn(spec = {}, where = HERE) {
  const io = fakeIo(spec);
  const snap = await readSnapshot(io, where);
  io.clear();
  return { io, snap, gate: new ActionGate(io) };
}

// run() answers a promise or null; this gives what it settles to.
const settled = async (value) => (value === null || value === undefined ? null : await value);

test("R14: a pending Fetch and a confirm racing: one write ever runs, never two at once", async () => {
  const { io, snap, gate } = await gateOn({ write: async () => { await turns(2); return { code: 0 }; } });
  assert.equal(gate.press("fetch", snap, HERE), "run");
  assert.equal(gate.press("pull", snap, HERE), "card");
  const hold = deferred();
  io.set({ hold: { dirs: hold.promise } });
  const confirming = gate.confirm(HERE);
  await until(() => io.kinds().includes("dirs"));
  const running = settled(gate.run());
  await turns();
  hold.resolve();
  const results = await Promise.all([running, confirming]);
  await turns();
  assert.equal(io.writes().length, 1, io.kinds().join(" "));
  assert.ok(io.most <= 1, `writes in flight at once: ${io.most}`);
  assert.equal(results.filter((r) => r === null).length, 1, JSON.stringify(results.map((r) => r?.kind ?? null)));
});

test("R14: run() while a confirm re-checks answers null and adds no call", async () => {
  const { io, snap, gate } = await gateOn();
  assert.equal(gate.press("fetch", snap, HERE), "run");
  assert.equal(gate.press("pull", snap, HERE), "card");
  const hold = deferred();
  io.set({ hold: { dirs: hold.promise } });
  const confirming = gate.confirm(HERE);
  await until(() => io.kinds().includes("dirs"));
  const before = io.calls.length;
  assert.equal(await settled(gate.run()), null);
  await turns();
  assert.equal(io.calls.length, before);
  hold.resolve();
  await confirming;
  await turns();
  assert.deepEqual(io.writes().map(([cmd, args]) => kindOf(cmd, args)), ["pull"]);
});

test("R14: a Fetch pressed and run after a Pull card is opened: confirm during the Fetch answers null and adds no write", async () => {
  const fetchHold = deferred();
  const { io, snap, gate } = await gateOn({ write: () => fetchHold.promise });
  assert.equal(gate.press("pull", snap, HERE), "card");
  assert.equal(gate.press("fetch", snap, HERE), "run");
  const fetching = settled(gate.run());
  await until(() => io.writes().length === 1);
  assert.equal(gate.running?.action, "fetch");
  assert.equal(await gate.confirm(HERE), null);
  await turns();
  assert.deepEqual(io.writes().map(([cmd, args]) => kindOf(cmd, args)), ["fetch"]);
  fetchHold.resolve({ code: 0 });
  await fetching;
  await turns();
  assert.deepEqual(io.writes().map(([cmd, args]) => kindOf(cmd, args)), ["fetch"]);
});

// The Fetch is pressed during the re-check, so no card press clears it: only the confirming guard can stop run().
test("R14: a Fetch pressed during a confirm's re-check cannot run until the confirm ends", async () => {
  const { io, snap, gate } = await gateOn();
  assert.equal(gate.press("pull", snap, HERE), "card");
  const hold = deferred();
  io.set({ hold: { dirs: hold.promise } });
  const confirming = gate.confirm(HERE);
  await until(() => io.kinds().includes("dirs"));
  gate.press("fetch", snap, HERE);
  const before = io.calls.length;
  assert.equal(await settled(gate.run()), null);
  await turns();
  assert.equal(io.calls.length, before);
  hold.resolve();
  await confirming;
  await turns();
  const writes = io.writes().map(([cmd, args]) => kindOf(cmd, args));
  assert.ok(!writes.includes("fetch"), writes.join(" "));
  assert.ok(writes.length <= 1, writes.join(" "));
});

// `running` is a public field of the contract; the test sets it while the re-check is held, the one moment R14 names.
test("R14: confirm() whose re-check ends while an action is running answers null and runs no write", async () => {
  const { io, snap, gate } = await gateOn();
  assert.equal(gate.press("pull", snap, HERE), "card");
  const hold = deferred();
  io.set({ hold: { dirs: hold.promise } });
  const confirming = gate.confirm(HERE);
  await until(() => io.kinds().includes("dirs"));
  gate.running = { action: "fetch", root: ROOT, on: null };
  hold.resolve();
  assert.equal(await confirming, null);
  await turns();
  assert.deepEqual(io.writes(), []);
});

test("R14: a press that opens a card clears a pending Fetch", async () => {
  const { io, snap, gate } = await gateOn();
  assert.equal(gate.press("fetch", snap, HERE), "run");
  assert.equal(gate.press("pull", snap, HERE), "card");
  assert.equal(await settled(gate.run()), null);
  await turns();
  assert.deepEqual(io.calls, []);
  assert.equal(gate.card?.action, "pull");
});

test("R14: drop(root, on) clears a result of another machine and keeps one of the same repo", async () => {
  const where = { cwd: ROOT, on: "devbox" };
  for (const [on, kept] of [["local", false], ["devbox", true]]) {
    const { snap, gate } = await gateOn({}, where);
    assert.equal(gate.press("fetch", snap, where), "run");
    await settled(gate.run());
    assert.equal(gate.result?.root, ROOT);
    assert.equal(gate.result?.on, "devbox");
    gate.drop(ROOT, on);
    if (kept) assert.equal(gate.result?.on, "devbox", `drop("${ROOT}", "${on}") keeps the result`);
    else assert.equal(gate.result, null, `drop("${ROOT}", "${on}") clears the result`);
  }
});

test("R14: a rejected check-ref-format says it could not check the name and runs no switch", async () => {
  const { io, snap, gate } = await gateOn({ reject: ["check"] });
  assert.equal(gate.press("branch", snap, HERE), "card");
  await gate.confirm(HERE, "feat/new");
  await turns();
  assert.equal(gate.nameError, "Could not check the name");
  assert.ok(io.kinds().includes("check"));
  assert.deepEqual(io.writes(), []);
});

test("R14: a remote to use that starts with - disables Fetch, Pull and Push, and press builds no command", async () => {
  const dash = { remote: "-f", ref: "refs/heads/feat/login", short: "-f/feat/login" };
  const { io, snap, gate } = await gateOn({ upstream: dash, remotes: ["-f"] });
  assert.deepEqual(snap.upstream, dash);
  for (const action of ["fetch", "pull", "push"]) {
    const reason = disabledReason(action, snap, null);
    assert.equal(typeof reason, "string", action);
    assert.ok(reason.length > 0, action);
    assert.equal(gate.press(action, snap, HERE), null, action);
  }
  // Middle value: the local actions do not use a remote and stay enabled.
  for (const action of ["branch", "stash", "pop"]) assert.equal(disabledReason(action, snap, null), null, action);
  assert.equal(gate.card, null);
  await turns();
  assert.deepEqual(io.calls, []);
});

// `fetch --all` passes every remote name to a child git, so a remote "-f" among others would be read as --force.
test("R14: a remote named -f beside origin disables Fetch only; Pull and Push use origin and stay enabled", async () => {
  const { io, snap, gate } = await gateOn({ remotes: ["origin", "-f"] });
  assert.deepEqual(snap.upstream, UP);
  assert.equal(snap.ahead, 2);
  assert.equal(snap.behind, 1);
  const reason = disabledReason("fetch", snap, null);
  assert.equal(typeof reason, "string");
  assert.ok(reason.length > 0);
  assert.equal(gate.press("fetch", snap, HERE), null);
  assert.equal(disabledReason("pull", snap, null), null);
  assert.equal(disabledReason("push", snap, null), null);
  await turns();
  assert.deepEqual(io.calls, []);
});

test("R14: Push that would publish to the only remote, named -f, is disabled", async () => {
  const { io, snap, gate } = await gateOn({ upstream: null, ahead: null, behind: null, remotes: ["-f"] });
  assert.equal(snap.upstream, null);
  const reason = disabledReason("push", snap, null);
  assert.equal(typeof reason, "string");
  assert.ok(reason.length > 0);
  assert.equal(gate.press("push", snap, HERE), null);
  await turns();
  assert.deepEqual(io.calls, []);
});
