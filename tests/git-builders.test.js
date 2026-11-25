// The Git tab's command builders (AC44, AC52, Q2, Q3, Q4, Q10; critical: data): the exact command of each action, the
// stash message rule, a matrix that no output can force, delete, reset or skip hooks, the pure branch-name check and
// the publish remote. Written from the spec and the plan's git-actions.js contract. The module loads lazily, so a
// missing export fails one test, not the file.
import { test } from "node:test";
import assert from "node:assert/strict";

const api = () => import("../mods/herdsidian/git-actions.js");

const ROOT = "/work/repo";
const PROMPT = "GIT_TERMINAL_PROMPT=0";
const NETWORK = 120000;

// AC44: the 7 rows of the plan's command table, exact.

test("AC44 fetchCommand: env GIT_TERMINAL_PROMPT=0 git -C <root> fetch --all, 120 s", async () => {
  const { fetchCommand } = await api();
  assert.deepEqual(fetchCommand(ROOT), { cmd: "env", args: [PROMPT, "git", "-C", ROOT, "fetch", "--all"], timeout: NETWORK });
});

test("AC44 pullCommand: fast-forward only, no rebase, no autostash, 120 s", async () => {
  const { pullCommand } = await api();
  assert.deepEqual(pullCommand(ROOT), {
    cmd: "env", args: [PROMPT, "git", "-C", ROOT, "pull", "--ff-only", "--no-rebase", "--no-autostash"], timeout: NETWORK,
  });
});

test("AC44 pushCommand with an upstream: push <remote> refs/heads/<branch>:<remote ref>, 120 s", async () => {
  const { pushCommand } = await api();
  // The remote ref is not the branch name, so the test sees which one the refspec uses.
  const command = pushCommand(ROOT, { branch: "feat/x", remote: "origin", remoteRef: "refs/heads/main", publish: false });
  assert.deepEqual(command, { cmd: "env", args: [PROMPT, "git", "-C", ROOT, "push", "origin", "refs/heads/feat/x:refs/heads/main"], timeout: NETWORK });
});

test("AC44 pushCommand to publish: push --set-upstream <remote> refs/heads/<branch>:refs/heads/<branch>, 120 s", async () => {
  const { pushCommand } = await api();
  const command = pushCommand(ROOT, { branch: "feat/x", remote: "fork", remoteRef: null, publish: true });
  assert.deepEqual(command, {
    cmd: "env", args: [PROMPT, "git", "-C", ROOT, "push", "--set-upstream", "fork", "refs/heads/feat/x:refs/heads/feat/x"], timeout: NETWORK,
  });
});

test("AC44 branchCommand (Q2): git -C <root> switch -c <name>, no timeout key", async () => {
  const { branchCommand } = await api();
  assert.deepEqual(branchCommand(ROOT, "feat/x"), { cmd: "git", args: ["-C", ROOT, "switch", "-c", "feat/x"] });
});

test("AC44 stashCommand (Q3): git -C <root> stash push --include-untracked, no timeout key", async () => {
  const { stashCommand } = await api();
  assert.deepEqual(stashCommand(ROOT, ""), { cmd: "git", args: ["-C", ROOT, "stash", "push", "--include-untracked"] });
});

test("AC44 popCommand: git -C <root> stash pop, no timeout key", async () => {
  const { popCommand } = await api();
  assert.deepEqual(popCommand(ROOT), { cmd: "git", args: ["-C", ROOT, "stash", "pop"] });
});

// Q3: the stash message.

test("Q3 stashCommand: no -m for an empty message", async () => {
  const { stashCommand } = await api();
  assert.deepEqual(stashCommand(ROOT, "").args, ["-C", ROOT, "stash", "push", "--include-untracked"]);
});

test("Q3 stashCommand: no -m for a message of spaces", async () => {
  const { stashCommand } = await api();
  assert.deepEqual(stashCommand(ROOT, "   ").args, ["-C", ROOT, "stash", "push", "--include-untracked"]);
});

test("Q3 stashCommand: -m and the trimmed message for a typed message", async () => {
  const { stashCommand } = await api();
  assert.deepEqual(stashCommand(ROOT, "  wip notes  "), { cmd: "git", args: ["-C", ROOT, "stash", "push", "--include-untracked", "-m", "wip notes"] });
});

test("Q3 stashCommand: a message that starts with - is one argument after -m", async () => {
  const { stashCommand } = await api();
  assert.deepEqual(stashCommand(ROOT, "-wip notes").args, ["-C", ROOT, "stash", "push", "--include-untracked", "-m", "-wip notes"]);
});

// AC44: the matrix. Every builder over names and messages that a shell or git could read as something else.

const VALUES = ["feat/x", "my branch", "a+b", "+main", "-wip", "rama-ñandú", "it's \"quoted\"", "$(x)"];
const REMOTES = ["origin", "fork"];
const FLAGS = ["--force", "-f", "--force-with-lease", "--force-if-includes", "--delete", "-d", "-D", "-B", "--no-verify"];
const WORDS = ["reset", "clean", "checkout", "restore", "drop", "clear"];

// Every output of every builder, each with the values it was given: [label, command, wholes], where `wholes` are the
// arguments that must appear whole, as one argument each.
async function outputs() {
  const { fetchCommand, pullCommand, pushCommand, branchCommand, stashCommand, popCommand, checkNameCommand } = await api();
  const out = [
    ["fetch", fetchCommand(ROOT), [ROOT]],
    ["pull", pullCommand(ROOT), [ROOT]],
    ["pop", popCommand(ROOT), [ROOT]],
  ];
  for (const value of VALUES) {
    for (const remote of REMOTES) {
      out.push([`push ${value} to ${remote}`, pushCommand(ROOT, { branch: value, remote, remoteRef: `refs/heads/${value}`, publish: false }),
        [ROOT, remote, `refs/heads/${value}:refs/heads/${value}`]]);
      out.push([`publish ${value} to ${remote}`, pushCommand(ROOT, { branch: value, remote, remoteRef: null, publish: true }),
        [ROOT, remote, `refs/heads/${value}:refs/heads/${value}`]]);
    }
    out.push([`branch ${value}`, branchCommand(ROOT, value), [ROOT, value]]);
    out.push([`stash ${value}`, stashCommand(ROOT, value), [ROOT, value]]);
    out.push([`check ${value}`, checkNameCommand(ROOT, value), [ROOT, value]]);
  }
  return out;
}

test("AC44 matrix: no builder output holds a force, delete, -B or --no-verify flag", async () => {
  for (const [label, { args }] of await outputs()) {
    for (const arg of args) {
      const flag = FLAGS.find((f) => arg === f || arg.startsWith(f));
      assert.equal(flag, undefined, `${label}: argument ${JSON.stringify(arg)} is or starts with ${flag}`);
    }
  }
});

test("AC44 matrix: no refspec of a push starts with +", async () => {
  for (const [label, { args }] of await outputs()) {
    if (!args.includes("push") || args.includes("stash")) continue;
    for (const arg of args.slice(args.indexOf("push") + 1)) assert.equal(arg.startsWith("+"), false, `${label}: ${JSON.stringify(arg)}`);
  }
});

test("AC44 matrix: no -C after switch", async () => {
  for (const [label, { args }] of await outputs()) {
    const at = args.indexOf("switch");
    if (at < 0) continue;
    assert.equal(args.slice(at + 1).includes("-C"), false, `${label}: ${JSON.stringify(args)}`);
  }
});

test("AC44 matrix: none of reset, clean, checkout, restore, drop, clear is an argument", async () => {
  for (const [label, { args }] of await outputs()) {
    for (const word of WORDS) assert.equal(args.includes(word), false, `${label}: holds ${word}`);
  }
});

test("AC44 matrix: each value is one whole argument, never split and never joined to a flag", async () => {
  for (const [label, { args }, wholes] of await outputs()) {
    for (const whole of wholes) assert.ok(args.includes(whole), `${label}: ${JSON.stringify(whole)} whole in ${JSON.stringify(args)}`);
    // The root comes right after -C, once.
    assert.equal(args.filter((a) => a === "-C").length, 1, `${label}: one -C`);
    assert.equal(args[args.indexOf("-C") + 1], ROOT, `${label}: the root after -C`);
  }
  // Where the value sits, per builder: after -c, after -m, after --branch, after the remote.
  const { pushCommand, branchCommand, stashCommand, checkNameCommand } = await api();
  for (const value of VALUES) {
    const branch = branchCommand(ROOT, value).args;
    assert.deepEqual(branch.slice(branch.indexOf("switch")), ["switch", "-c", value], `branch ${value}`);
    const stash = stashCommand(ROOT, value).args;
    assert.deepEqual(stash.slice(stash.indexOf("-m")), ["-m", value], `stash ${value}`);
    const check = checkNameCommand(ROOT, value).args;
    assert.deepEqual(check.slice(check.indexOf("--branch")), ["--branch", value], `check ${value}`);
    const push = pushCommand(ROOT, { branch: value, remote: "origin", remoteRef: `refs/heads/${value}`, publish: false }).args;
    assert.deepEqual(push.slice(push.indexOf("origin")), ["origin", `refs/heads/${value}:refs/heads/${value}`], `push ${value}`);
  }
});

test("AC44 matrix: no shell; the command is env for the network actions and git for the others", async () => {
  for (const [label, { cmd, args }] of await outputs()) {
    const network = label.startsWith("fetch") || label.startsWith("pull") || label.startsWith("push") || label.startsWith("publish");
    assert.equal(cmd, network ? "env" : "git", label);
    if (network) assert.deepEqual(args.slice(0, 2), [PROMPT, "git"], label);
  }
});

// AC52: the pure part of the branch-name check.

for (const name of ["", "   ", "-bad", "a@{b", "@{-1}"]) {
  test(`AC52 branchNameError: "Not a valid branch name" for ${JSON.stringify(name)}`, async () => {
    const { branchNameError } = await api();
    assert.equal(branchNameError(name), "Not a valid branch name");
  });
}

for (const name of ["feat/ok", "ok+1", "rama-ñandú"]) {
  test(`AC52 branchNameError: null for ${JSON.stringify(name)}`, async () => {
    const { branchNameError } = await api();
    assert.equal(branchNameError(name), null);
  });
}

// Q4: which remote a publish uses.

test("Q4 publishRemote: origin when it is listed with others", async () => {
  const { publishRemote } = await api();
  assert.equal(publishRemote(["upstream", "origin", "fork"]), "origin");
});

test("Q4 publishRemote: the only remote", async () => {
  const { publishRemote } = await api();
  assert.equal(publishRemote(["fork"]), "fork");
});

test("Q4 publishRemote: null for two remotes without origin", async () => {
  const { publishRemote } = await api();
  assert.equal(publishRemote(["fork", "mirror"]), null);
});

test("Q4 publishRemote: null for no remote", async () => {
  const { publishRemote } = await api();
  assert.equal(publishRemote([]), null);
});

// AC52: the command that asks git.

test("AC52 checkNameCommand: git -C <root> check-ref-format --branch <name>", async () => {
  const { checkNameCommand } = await api();
  assert.deepEqual(checkNameCommand(ROOT, "feat/x"), { cmd: "git", args: ["-C", ROOT, "check-ref-format", "--branch", "feat/x"] });
});
