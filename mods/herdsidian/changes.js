// The Changes tab's pure logic (V1): the git commands, their -z outputs parsed into rows, the count.
// Pure (no herdr, gpui-kit or gpui-base import), so Node tests import it.

// The most rows the tab draws; the count still includes every changed file.
export const MAX_ROWS = 500;

// Nothing may write under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
const QUIET = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
export const topArgs = (cwd) => ["-C", cwd, "rev-parse", "--show-toplevel"];
// --branch puts the branch on the first record: one call gives the entries and where we are.
export const statusArgs = (root) => [...QUIET, "-C", root, "status", "--porcelain=v1", "-z", "--branch"];
// Without a commit there is no HEAD to compare with: the work tree against the index.
export const diffArgs = (root, head) => [...QUIET, "-C", root, "diff", ...(head ? ["HEAD"] : []), "--numstat", "-z"];

// "## main...origin/main [ahead 1]", "## No commits yet on main", "## HEAD (no branch)".
export function parseBranch(line) {
  const text = line.replace(/^## /, "");
  const fresh = /^(?:No commits yet|Initial commit) on /.exec(text);
  if (fresh) return { name: text.slice(fresh[0].length), head: false };
  if (text.startsWith("HEAD (no branch)")) return { name: null, head: true };
  return { name: text.split(" ")[0].split("...")[0], head: true };
}

// The XY pair of a porcelain entry: untracked, conflict, renamed, added, deleted or modified.
export function statusKind(xy) {
  if (xy === "??") return "untracked";
  if (xy.includes("U") || xy === "AA" || xy === "DD") return "conflict";
  if (xy.includes("R") || xy.includes("C")) return "renamed";
  if (xy.includes("A")) return "added";
  if (xy.includes("D")) return "deleted";
  return "modified";
}

// The answer of `git rev-parse --show-toplevel`: a repo (exit 0 and a root), a real non-repo (non-zero exit), or
// no valid answer (exit 0 with no root, or the command could not run): then nothing is known and nothing is published.
export function classifyTop(result) {
  if (!result) return { kind: "unknown" };
  if (result.code !== 0) return { kind: "norepo" };
  const root = (result.stdout ?? "").trim();
  return root ? { kind: "repo", root } : { kind: "unknown" };
}

// Whether a read state is written to herdsidian.changes (the sidebar tab badge). A pane with no folder, no repo or a
// git error publishes {count: 0}, so the badge never keeps the last repo's number; "unknown" and "loading" publish nothing.
// An "error" in the repo of the last good read (`sameRoot`, e.g. an index.lock race) keeps the count it had.
export const publishes = (state, { sameRoot = false } = {}) =>
  state === "ready" || state === "norepo" || state === "nofolder" || (state === "error" && !sameRoot);

// Which repo the published count belongs to. `attempt` is the repo just read (null when none was found), `readyRoot`
// the repo of the last good read still held. Returns { sameRoot, readyRoot } for the next step: an error in the held
// repo keeps its count (sameRoot); any other error publishes 0, so nothing is held for the old repo any more; no
// folder or no repo published 0 too; "loading" and "unknown" change nothing.
export function readRoots(state, attempt, readyRoot) {
  if (state === "ready") return { sameRoot: false, readyRoot: attempt };
  if (state === "error") {
    const sameRoot = !!attempt && attempt === readyRoot;
    return { sameRoot, readyRoot: sameRoot ? readyRoot : null };
  }
  if (state === "nofolder" || state === "norepo") return { sameRoot: false, readyRoot: null };
  return { sameRoot: false, readyRoot };
}

// `git status --porcelain=v1 -z --branch`: "XY path" records; a rename or copy is followed by its old path.
export function parseStatus(stdout) {
  const parts = stdout.split("\0"), entries = [];
  let branch = null;
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    if (entry.startsWith("## ")) { branch = parseBranch(entry); continue; }
    const xy = entry.slice(0, 2);
    entries.push({ path: entry.slice(3), from: /[RC]/.test(xy) ? parts[++i] || null : null, kind: statusKind(xy) });
  }
  return { branch, entries };
}

// `git diff --numstat -z`: "add\tdel\tpath" records; a rename is "add\tdel\t" then the old and the new path.
// A binary file counts "-": null.
export function parseNumstat(stdout) {
  const parts = stdout.split("\0"), stats = new Map();
  const count = (n) => (n === "-" ? null : Number(n));
  for (let i = 0; i < parts.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t([^]*)$/.exec(parts[i]);
    if (!m) continue;
    const path = m[3] === "" ? (i += 2, parts[i]) : m[3];
    if (path) stats.set(path, { add: count(m[1]), del: count(m[2]) });
  }
  return stats;
}

// The rows of the tab, in git's order, at most `limit`. Untracked and binary files have no counts (null).
export function mergeRows(entries, stats, limit = MAX_ROWS) {
  return entries.slice(0, limit).map((e) => {
    const stat = e.kind === "untracked" ? { add: null, del: null } : stats.get(e.path) ?? { add: 0, del: 0 };
    return { path: e.path, from: e.from, status: e.kind, add: stat.add, del: stat.del };
  });
}

// The quiet period after a watch batch before git is read: batches that arrive meanwhile are merged into one refresh.
export const DEBOUNCE_MS = 600;
// Folders whose writes never change `git status`'s answer (build output, caches, git's own objects). The folder
// watch on macOS is recursive and reports them too (Herdsidian vault, Verification).
const IGNORED = new Set(["node_modules", ".next", "dist", "target", "build", ".turbo", ".cache"]);

// The longest the wait may last from the first relevant batch, however many events keep arriving.
export const MAX_WAIT_MS = 2500;

// Folder segments inside the repo only: a tracked file named `build` is still a change, and so is the repo root
// itself or a path outside it, even when a parent folder of the root is called `build`.
function ignored(path, root) {
  if (!path.startsWith(`${root}/`)) return false;
  const rel = path.slice(root.length + 1);
  const parts = rel.split("/");
  return parts.slice(0, -1).some((part) => IGNORED.has(part)) || (parts[0] === ".git" && parts[1] === "objects");
}

// False only for a batch whose every path is inside an ignored folder; .git/index, HEAD and refs stay relevant.
export function relevant(changed, root) {
  if (!Array.isArray(changed) || !changed.length) return true;
  return changed.some((p) => !ignored(p, root));
}

// The 30 px line above the rows. `label` is the branch name, or "detached HEAD".
export function summary(count, label) {
  const on = label ? ` on ${label}` : "";
  return count === 0 ? `No changes${on}` : `${count} ${count === 1 ? "file" : "files"} changed${on}`;
}
