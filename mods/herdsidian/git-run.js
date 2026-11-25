// The Git tab's one place that runs a write: readSnapshot (the repo state the buttons and the re-check use) and
// ActionGate (press, confirm, the re-check, the run, the outcome). Pure: io = { exec, readTextFile } is handed in.
import { dirsArgs, parseDirs, statusArgs2, parseStatus2, refsArgs, parseRefs, remotesArgs, parseRemotes, stashTopArgs,
  parseStashTop, OP_FILES, opOf } from "./git-log.js";
import { BAD_NAME, CHECK_FAILED, branchNameError, cardOf, checkNameCommand, commandOf, disabledReason, noAnswerOf, outcomeOf,
  sameForAction, staleOf } from "./git-actions.js";

// A git read that must succeed: a non-zero exit is an error, as a rejection is.
async function gitRead(io, args, on) {
  const r = await io.exec("git", args, { on });
  if (r.code !== 0) throw new Error((r.stderr || "").split("\n")[0] || `git exited with ${r.code}`);
  return r.stdout;
}

// -> Snapshot, or { error } when any read fails (then every action is disabled and a re-check counts as changed).
export async function readSnapshot(io, where) {
  const on = where?.on ?? null;
  try {
    const dirs = parseDirs(await gitRead(io, dirsArgs(where.cwd), on));
    if (!dirs) return { error: "Not a git repository" };
    const { root, gitDir } = dirs;
    const [status, refs, remotes, stash, present] = await Promise.all([
      gitRead(io, statusArgs2(root), on).then(parseStatus2),
      gitRead(io, refsArgs(root), on).then(parseRefs),
      gitRead(io, remotesArgs(root), on).then(parseRemotes),
      gitRead(io, stashTopArgs(root), on).then(parseStashTop),
      Promise.all(OP_FILES.map(([file]) => io.readTextFile(`${gitDir}/${file}`, { on }).then((text) => (text === null ? null : file)))),
    ]);
    const upstream = refs.upstream ? { ...refs.upstream, short: status.upstreamShort } : null;
    return { root, gitDir, on, head: status.head, branch: status.branch, upstream, ahead: status.ahead, behind: status.behind,
      remotes, changed: status.changed, unmerged: status.unmerged, op: opOf(present.filter(Boolean)), stash, refs: refs.refs };
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
}

export class ActionGate {
  constructor(io) {
    this.io = io;
    this.card = null;
    this.running = null;
    this.result = null;
    this.nameError = null;
    this.pending = null;
    this.confirming = false;
  }

  // AC45: no command runs here. Fetch answers "run" (the caller then awaits run()); the others open a card.
  press(action, snap) {
    if (this.confirming || disabledReason(action, snap, this.running)) return null;
    this.card = null;
    this.nameError = null;
    if (action === "fetch") {
      this.pending = cardOf("fetch", snap);
      return "run";
    }
    // R14: a card replaces a Fetch not yet run, so the two can never both write.
    this.pending = null;
    this.card = cardOf(action, snap);
    return "card";
  }

  // Fetch only, after press() answered "run". R14: never while another action re-checks or runs.
  async run() {
    const card = this.pending;
    this.pending = null;
    if (!card || this.running || this.confirming) return null;
    return this.execute(card, "");
  }

  cancel() {
    this.card = null;
    this.nameError = null;
    this.pending = null;
  }

  // Leaving the tab or another repo: the card goes, a running action does not stop. With the repo shown now (root and
  // machine, R14), a result panel of another repo goes too.
  drop(root, on = null) {
    this.cancel();
    if (root !== undefined && this.result && (this.result.root !== root || this.result.on !== on)) this.result = null;
  }

  dismiss() {
    this.result = null;
  }

  // AC47, AC52: the name check, the re-check on the folder focused now, then the one write.
  async confirm(where, input) {
    const card = this.card;
    if (!card || this.confirming || this.running) return null;
    const name = String(input ?? "").trim();
    if (card.action === "branch") {
      this.nameError = branchNameError(name);
      if (this.nameError) return null;
    }
    const fresh = await this.recheck(card, where, name);
    // The card was dropped or replaced while the re-check ran, or git refused the name.
    if (fresh === null || this.card !== card) return null;
    // R14: another action started while the re-check ran; the card stays for a later confirm.
    if (this.running) return null;
    this.card = null;
    this.nameError = null;
    if (!sameForAction(card, fresh)) {
      this.result = staleOf(card);
      return this.result;
    }
    // No await since the re-check: execute sets `running` before anything else can run.
    return this.execute(card, input);
  }

  // `confirming` covers only the reads; `running` alone guards the write. -> the fresh snapshot, or null for a refused name.
  async recheck(card, where, name) {
    this.confirming = true;
    try {
      if (card.action === "branch") {
        const { cmd, args } = checkNameCommand(card.root, name);
        const check = await this.io.exec(cmd, args, { on: card.on }).catch(() => null);
        // R14: a check that did not answer says nothing about the name.
        if (!check || check.code !== 0) {
          if (this.card === card) this.nameError = check ? BAD_NAME : CHECK_FAILED;
          return null;
        }
      }
      return await readSnapshot(this.io, where);
    } finally {
      this.confirming = false;
    }
  }

  // AC49, AC50: one exec, never cancelled; a rejection is a failure, never a success.
  async execute(card, input) {
    const { cmd, args, timeout } = commandOf(card, input);
    this.result = null;
    this.running = { action: card.action, root: card.root, on: card.on };
    let outcome;
    try {
      const result = await this.io.exec(cmd, args, timeout ? { on: card.on, timeout } : { on: card.on });
      outcome = outcomeOf(card, result, card.action === "pop" && result.code !== 0 ? await this.topStash(card) : {});
    } catch (error) {
      outcome = noAnswerOf(card, error?.message ?? error);
    }
    this.running = null;
    this.result = outcome;
    return outcome;
  }

  // R7: the top stash after a failed Pop. Unknown counts as gone, so the panel never claims a stash that is not there.
  async topStash(card) {
    try {
      const r = await this.io.exec("git", stashTopArgs(card.root), { on: card.on });
      return { stash: r.code === 0 ? parseStashTop(r.stdout) : null };
    } catch {
      return { stash: null };
    }
  }
}
