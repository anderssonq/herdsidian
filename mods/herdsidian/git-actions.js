// The Git tab's write actions, pure: the command builders, the branch-name pre-check, the disabled reasons, the confirm
// texts, the re-check compare and the outcome of a result. No herdr, gpui-kit or gpui-base import, so Node tests import it.
export const ACTIONS = ["fetch", "pull", "push", "branch", "stash", "pop"];
export const LABELS = { fetch: "Fetch", pull: "Pull", push: "Push", branch: "Branch", stash: "Stash", pop: "Pop" };
const NETWORK_TIMEOUT_MS = 120000;
// Herdr's exec default when no timeout is passed.
const DEFAULT_TIMEOUT_MS = 30000;

const STALE_TEXT = "The repo changed since you asked. Check again.";
export const BAD_NAME = "Not a valid branch name";
export const CHECK_FAILED = "Could not check the name";
const KEPT_TEXT = "The stash was kept (stash@{0}).";

// A network command never asks for a password: env turns the prompt off for git only.
const network = (root, ...rest) => ({ cmd: "env", args: ["GIT_TERMINAL_PROMPT=0", "git", "-C", root, ...rest], timeout: NETWORK_TIMEOUT_MS });

// Each builder -> { cmd, args, timeout? }. One argument per value, no shell; nothing can force, delete or skip hooks.
export const fetchCommand = (root) => network(root, "fetch", "--all");
export const pullCommand = (root) => network(root, "pull", "--ff-only", "--no-rebase", "--no-autostash");
export const pushCommand = (root, { branch, remote, remoteRef, publish }) => (publish
  ? network(root, "push", "--set-upstream", remote, `refs/heads/${branch}:refs/heads/${branch}`)
  : network(root, "push", remote, `refs/heads/${branch}:${remoteRef}`));
export const branchCommand = (root, name) => ({ cmd: "git", args: ["-C", root, "switch", "-c", name] });
export const stashCommand = (root, message) => {
  const text = String(message ?? "").trim();
  return { cmd: "git", args: ["-C", root, "stash", "push", "--include-untracked", ...(text ? ["-m", text] : [])] };
};
export const popCommand = (root) => ({ cmd: "git", args: ["-C", root, "stash", "pop"] });
export const checkNameCommand = (root, name) => ({ cmd: "git", args: ["-C", root, "check-ref-format", "--branch", name] });

// The pure part of AC52; git's check-ref-format does the rest. "@{" is refused because git expands "@{-1}" to a branch.
export const branchNameError = (name) => {
  const text = String(name ?? "").trim();
  return !text || text.startsWith("-") || text.includes("@{") ? BAD_NAME : null;
};

// Q4: origin when it is listed, else the only remote, else none.
export const publishRemote = (remotes) => (remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0] : null);

const WITH_REMOTE = ["fetch", "pull", "push"];
const LOCAL_STATE = ["pull", "branch", "stash", "pop"];

// The remotes an action names on git's command line: Fetch all of them, Pull the upstream's, Push the one it pushes to.
function remotesUsed(action, snap) {
  if (action === "fetch") return snap.remotes;
  if (action === "pull") return [snap.upstream?.remote];
  if (action === "push") return [snap.upstream ? snap.upstream.remote : publishRemote(snap.remotes)];
  return [];
}

// AC48: the first cause that applies, in the plan's order.
export function disabledReason(action, snap, running) {
  if (running) return `${LABELS[running.action]} is running`;
  if (!snap || snap.error) return "Cannot read the repo state";
  if (action !== "fetch" && !snap.head) return "No commits yet";
  if (WITH_REMOTE.includes(action) && !snap.remotes?.length) return "No remote";
  // R14: git would read a remote named like a flag as an option.
  if (remotesUsed(action, snap).some((r) => r?.startsWith("-"))) return "A remote name starts with -: use a terminal";
  if ((action === "pull" || action === "push") && !snap.branch) return "Detached HEAD";
  if (LOCAL_STATE.includes(action)) {
    if (snap.op) return `Finish the ${snap.op} first`;
    if (snap.unmerged > 0) return "Resolve the conflicts first";
  }
  if (action === "pull" && !snap.upstream) return "No upstream branch";
  if (action === "push") {
    if (snap.upstream?.remote === ".") return "Upstream is a local branch";
    if (snap.upstream && snap.ahead === 0) return "Nothing to push";
    if (!snap.upstream && !publishRemote(snap.remotes)) return "Several remotes: push from a terminal";
  }
  if (action === "stash" && snap.changed === 0) return "Nothing to stash";
  if (action === "pop" && !snap.stash) return "No stash";
  return null;
}

// What the card shows and what the re-check compares. Push publishes when the branch has no upstream.
export function cardOf(action, snap) {
  const publish = action === "push" && !snap.upstream;
  return {
    action, root: snap.root, on: snap.on ?? null, head: snap.head, branch: snap.branch, upstream: snap.upstream, op: snap.op,
    changed: snap.changed, stash: snap.stash, publish,
    remote: snap.upstream ? snap.upstream.remote : publishRemote(snap.remotes ?? []), remoteRef: snap.upstream?.ref ?? null,
  };
}

// AC46, word for word.
export function confirmText(card, input) {
  switch (card.action) {
    case "pull":
      return `Pull ${card.upstream.short} into ${card.branch}? Fast-forward only: no merge commit, no rebase. Your uncommitted changes stay; git stops if an incoming change touches a file you changed.`;
    case "push":
      return card.publish
        ? `Publish ${card.branch} to ${card.remote}/${card.branch} and track it?`
        : `Push ${card.branch} to ${card.upstream.short}? No force: git refuses if the remote has commits you do not have.`;
    case "branch":
      return `Create ${String(input ?? "").trim()} at ${card.head.slice(0, 7)} and switch to it? Your files do not change.`;
    case "stash":
      return `Stash ${card.changed} changed ${card.changed === 1 ? "file" : "files"}, untracked files included? They leave the working tree; Pop brings them back.`;
    case "pop":
      return `Apply and drop stash@{0} (${card.stash.message})? If it conflicts, git keeps the stash.`;
    default:
      return "";
  }
}

const sameUpstream = (a, b) => (a && b ? a.remote === b.remote && a.ref === b.ref && a.short === b.short : a === b);

// AC47 and D4: the fresh snapshot must match what the card showed, and the action must still be enabled on it.
export function sameForAction(card, fresh) {
  if (!fresh || fresh.error) return false;
  if (fresh.root !== card.root || (fresh.on ?? null) !== card.on) return false;
  if (fresh.branch !== card.branch || !sameUpstream(fresh.upstream, card.upstream) || fresh.op !== card.op) return false;
  if (card.action === "branch" && fresh.head !== card.head) return false;
  if (card.action === "stash" && fresh.changed !== card.changed) return false;
  if (card.action === "pop" && fresh.stash?.hash !== card.stash?.hash) return false;
  // A publish must still go to the remote the card named.
  if (card.action === "push" && cardOf("push", fresh).remote !== card.remote) return false;
  return disabledReason(card.action, fresh, null) === null;
}

// The command a confirmed card runs. `input` is the Branch name or the Stash message.
export function commandOf(card, input) {
  switch (card.action) {
    case "fetch": return fetchCommand(card.root);
    case "pull": return pullCommand(card.root);
    case "push": return pushCommand(card.root, card);
    case "branch": return branchCommand(card.root, String(input ?? "").trim());
    case "stash": return stashCommand(card.root, input);
    case "pop": return popCommand(card.root);
    default: return null;
  }
}

// Output lines a person can read: no empty line, no hint.
const linesOf = (text) => String(text ?? "").split(/\r\n|\n|\r/).map((l) => l.trimEnd()).filter((l) => l && !l.trimStart().startsWith("hint:"));
const fullOf = (stdout, stderr) => [stdout, stderr].filter(Boolean).join("\n");
const base = (card) => ({ action: card.action, root: card.root, on: card.on });

// AC50, AC53. `result` is exec's { code, stdout, stderr }; `extra.stash` is the top stash read again after the action (R7).
export function outcomeOf(card, result, extra = {}) {
  const { code, stdout = "", stderr = "" } = result;
  const label = LABELS[card.action];
  const full = fullOf(stdout, stderr);
  if (code === 0) {
    const first = linesOf(stdout)[0] ?? linesOf(stderr)[0];
    return { ...base(card), kind: "done", title: `${label} done`, lines: first ? [first] : [], full };
  }
  const err = linesOf(stderr);
  const lines = (err.length ? err : linesOf(stdout)).slice(0, 4);
  if (card.action === "pop" && card.stash && extra?.stash?.hash === card.stash.hash) lines.push(KEPT_TEXT);
  return { ...base(card), kind: "failed", title: `${label} failed`, lines, full };
}

// A rejected exec (a timeout, a start failure, a machine out of reach): git may have done part of the work.
export function noAnswerOf(card, message) {
  const seconds = (commandOf(card, "").timeout ?? DEFAULT_TIMEOUT_MS) / 1000;
  return { ...base(card), kind: "no-answer", title: `${LABELS[card.action]} failed`,
    lines: [`Git did not answer in ${seconds} s. Check the repo in a terminal before you try again.`], full: String(message ?? "") };
}

// The re-check found another repo state: nothing ran.
export const staleOf = (card) => ({ ...base(card), kind: "stale", title: `${LABELS[card.action]} did not run`, lines: [STALE_TEXT], full: "" });
