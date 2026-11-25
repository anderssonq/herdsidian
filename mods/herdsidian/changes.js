// The Changes tab's pure logic: the git commands, their -z outputs parsed into rows, the count, and one file's patch.
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
// The patch of one file. --literal-pathspecs: "a*.txt" must not also match "ab.txt"; --no-ext-diff: a diff tool in the
// person's git config would replace the patch format. -M only for a rename, so its old and new path pair up.
export const patchArgs = (root, path, from, head) => [...QUIET, "--literal-pathspecs", "-C", root, "diff", ...(head ? ["HEAD"] : []),
  "-U3", "--no-color", "--no-ext-diff", ...(from ? ["-M"] : []), "--", ...(from ? [from, path] : [path])];

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

// The +add −del totals of every changed file, past MAX_ROWS too. A binary file (null) adds 0.
export function sumStats(stats) {
  let add = 0, del = 0;
  for (const s of stats.values()) { add += s.add ?? 0; del += s.del ?? 0; }
  return { add, del };
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?([^]*)$/;
// git writes CRLF content as is: one "\r" at the end of a line belongs to the file, not to the text drawn.
const chomp = (text) => (text.endsWith("\r") ? text.slice(0, -1) : text);

// The hunks of a one-row `git diff -U3` patch, every section in git's order. A hunk is read by its counts, not by line prefixes, so a content
// line that starts with "---", "+++" or "@@" stays content. A "\ No newline" line is a note: no numbers, no count.
export function parseHunks(patch) {
  const lines = patch.split("\n"), hunks = [];
  let hunk = null, oldNo = 0, newNo = 0, oldLeft = 0, newLeft = 0;
  for (const raw of lines) {
    const text = chomp(raw);
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      const sign = text[0], body = text.slice(1);
      if (sign === " " && oldLeft > 0 && newLeft > 0) { hunk.lines.push({ kind: "context", old: oldNo++, new: newNo++, text: body }); oldLeft--; newLeft--; }
      else if (sign === "-" && oldLeft > 0) { hunk.lines.push({ kind: "del", old: oldNo++, new: null, text: body }); oldLeft--; }
      else if (sign === "+" && newLeft > 0) { hunk.lines.push({ kind: "add", old: null, new: newNo++, text: body }); newLeft--; }
      else if (sign === "\\") hunk.lines.push({ kind: "note", old: null, new: null, text });
      else break;
      continue;
    }
    // A full hunk: the no-newline note of its last line, the next header, or the end of the patch.
    if (hunk && text.startsWith("\\")) { hunk.lines.push({ kind: "note", old: null, new: null, text }); continue; }
    const m = HUNK.exec(text);
    if (m) {
      const count = (n) => (n === undefined ? 1 : Number(n));
      hunk = { oldStart: Number(m[1]), oldCount: count(m[2]), newStart: Number(m[3]), newCount: count(m[4]), section: m[5], lines: [] };
      hunks.push(hunk);
      oldNo = hunk.oldStart; newNo = hunk.newStart; oldLeft = hunk.oldCount; newLeft = hunk.newCount;
      continue;
    }
    // A rename git cannot pair (under 50 % similar) is two sections: the next one's headers are skipped like the first's.
    if (hunk && text.startsWith("diff --git ")) { hunk = null; continue; }
    // Before the first hunk: the diff, index, mode, rename and ---/+++ headers. After a full hunk: the end.
    if (hunk) break;
  }
  return hunks;
}

// git's binary answers come in the header, before any hunk: the same words inside a hunk are content.
export function isBinaryPatch(patch) {
  for (const raw of patch.split("\n")) {
    const text = chomp(raw);
    if (text.startsWith("@@")) return false;
    if (text === "GIT binary patch" || (text.startsWith("Binary files ") && text.endsWith(" differ"))) return true;
  }
  return false;
}

// The most diff lines kept (AC30); the view says how many there were in all.
export const MAX_LINES = 2000;
// The first `max` lines across the hunks, in order. A hunk past the cut is dropped, so no title is drawn with no lines.
export function capLines(hunks, max = MAX_LINES) {
  const total = hunks.reduce((n, h) => n + h.lines.length, 0);
  if (total <= max) return { hunks, total, shown: total };
  const kept = [];
  let left = max;
  for (const h of hunks) {
    if (left <= 0) break;
    const lines = h.lines.slice(0, left);
    kept.push(lines.length === h.lines.length ? h : { ...h, lines });
    left -= lines.length;
  }
  return { hunks: kept, total, shown: max };
}

// The largest text readTextFile gives; Herdr refuses more with "exceeds 1 MiB".
const MAX_TEXT = 1048576;
// An untracked file, read whole, as one hunk of added lines; or the notice shown instead of lines (AC34).
export function wholeFile(read) {
  if (read.error !== undefined) {
    const message = String(read.error?.message ?? read.error);
    if (message.includes("exceeds 1 MiB")) return { notice: "File too large to preview" };
    if (message.includes("UTF-8")) return { notice: "Binary file, no preview" };
    return { notice: message.split("\n")[0] };
  }
  const { text } = read;
  if (text === null || text === undefined) return { notice: "File not found" };
  if (text.includes("\0")) return { notice: "Binary file, no preview" };
  if (text.length >= MAX_TEXT) return { notice: "File too large to preview" };
  if (text === "") return { notice: "No text changes" };
  const parts = text.split("\n");
  if (parts.at(-1) === "") parts.pop();
  const lines = parts.map((part, i) => ({ kind: "add", old: null, new: i + 1, text: chomp(part) }));
  return { hunks: [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: lines.length, section: "", lines }] };
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
