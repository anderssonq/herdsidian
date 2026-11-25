// The Git tab's pure read layer: the argument builders and the parsers of history, status, refs, remotes, the top stash,
// the operation in progress and a commit's files and patch. Pure (no herdr, gpui-kit or gpui-base import), so Node tests import it.
import { QUIET } from "./changes.js";

// A history page, and the fields of one record (NUL between fields, a newline after the record).
export const LOG_PAGE = 300;
export const LOG_FORMAT = "%H%x00%P%x00%an%x00%ae%x00%at%x00%s";
// The stash and notes commits are not history. --skip pages in; a zero skip adds nothing.
export const logArgs = (root, count = LOG_PAGE, skip = 0) => [...QUIET, "-C", root, "log", "--exclude=refs/stash", "--exclude=refs/notes/*",
  "--all", "--topo-order", "--no-color", "-n", String(count), `--format=${LOG_FORMAT}`, ...(skip > 0 ? [`--skip=${skip}`] : [])];

// Commit = { hash, parents, author, email, at: ms | null, subject }
export function parseLog(stdout) {
  const commits = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const [hash, parents, author, email, at, ...rest] = line.split("\0");
    commits.push({ hash, parents: parents ? parents.split(" ") : [], author: author ?? "", email: email ?? "",
      at: /^\d+$/.test(at ?? "") ? Number(at) * 1000 : null, subject: rest.join("\0") });
  }
  return commits;
}

export const dirsArgs = (cwd) => ["-C", cwd, "rev-parse", "--show-toplevel", "--absolute-git-dir"];
export function parseDirs(stdout) {
  const [root, gitDir] = stdout.split("\n").map((s) => s.trim());
  return root && gitDir ? { root, gitDir } : null;
}

export const statusArgs2 = (root) => [...QUIET, "-C", root, "status", "--porcelain=v2", "--branch", "--show-stash", "-z"];

// Headers start with "# "; entries are "1 ", "2 " (then the old path as one more record), "u " and "? ". "! " is ignored.
export function parseStatus2(stdout) {
  const parts = stdout.split("\0");
  const out = { head: null, branch: null, upstreamShort: null, ahead: null, behind: null, changed: 0, unmerged: 0 };
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec) continue;
    if (rec.startsWith("# ")) {
      const [key, ...rest] = rec.slice(2).split(" ");
      const value = rest.join(" ");
      if (key === "branch.oid") out.head = value === "(initial)" ? null : value;
      else if (key === "branch.head") out.branch = value === "(detached)" ? null : value;
      else if (key === "branch.upstream") out.upstreamShort = value;
      else if (key === "branch.ab") {
        const m = /^\+(\d+) -(\d+)$/.exec(value);
        if (m) { out.ahead = Number(m[1]); out.behind = Number(m[2]); }
      }
      continue;
    }
    const kind = rec[0];
    if (kind === "2") i++;
    if (kind === "1" || kind === "2" || kind === "u" || kind === "?") out.changed++;
    if (kind === "u") out.unmerged++;
  }
  return out;
}

const REFS_FORMAT = "%(refname)%00%(objectname)%00%(*objectname)%00%(symref)%00%(upstream:remotename)%00%(upstream:remoteref)%00%(HEAD)";
export const refsArgs = (root) => [...QUIET, "-C", root, "for-each-ref", `--format=${REFS_FORMAT}`, "refs/heads", "refs/remotes", "refs/tags"];

const REF_KINDS = [["refs/heads/", "local"], ["refs/remotes/", "remote"], ["refs/tags/", "tag"]];

// Ref = { full, name, kind, sha, current }. An annotated tag gives its commit (the peeled object); a symref (origin/HEAD) is dropped.
export function parseRefs(stdout) {
  const refs = [];
  let upstream = null;
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const [full, object, peeled, symref, remote, ref, head] = line.split("\0");
    if (symref) continue;
    const found = REF_KINDS.find(([prefix]) => full.startsWith(prefix));
    if (!found) continue;
    const current = head === "*";
    refs.push({ full, name: full.slice(found[0].length), kind: found[1], sha: peeled || object, current });
    if (current && remote) upstream = { remote, ref };
  }
  return { refs, upstream };
}

export const remotesArgs = (root) => [...QUIET, "-C", root, "remote"];
export const parseRemotes = (stdout) => stdout.split("\n").map((s) => s.trim()).filter(Boolean);

// The message stays as git prints it (%gs, e.g. "On main: wip").
export const stashTopArgs = (root) => [...QUIET, "-C", root, "stash", "list", "-n", "1", "--format=%H%x00%gs"];
export function parseStashTop(stdout) {
  const line = stdout.split("\n")[0];
  if (!line) return null;
  const [hash, ...rest] = line.split("\0");
  return hash ? { hash, message: rest.join("\0") } : null;
}

// Files in the git dir that mean an operation is in progress, in the order opOf prefers.
export const OP_FILES = [
  ["rebase-merge/head-name", "rebase"], ["rebase-apply/head-name", "rebase"], ["rebase-apply/applying", "rebase"],
  ["MERGE_HEAD", "merge"], ["CHERRY_PICK_HEAD", "cherry-pick"], ["REVERT_HEAD", "revert"], ["BISECT_LOG", "bisect"],
];
export const opOf = (present) => OP_FILES.find(([file]) => present.includes(file))?.[1] ?? null;

export const MAX_FILES = 500;

// A merge is compared with its first parent; a root commit with --root.
const sides = (commit) => (commit.parents.length ? [commit.parents[0], commit.hash] : ["--root", commit.hash]);

// --raw gives the status letters, --numstat the counts: one call.
export const commitFilesArgs = (root, commit) => [...QUIET, "-C", root, "diff-tree", "-r", "-z", "--raw", "--numstat", "-M",
  "--no-commit-id", ...sides(commit)];
// --literal-pathspecs: "a*.txt" must not also match "ab.txt". A rename lists the old and the new path.
export const commitPatchArgs = (root, commit, file) => [...QUIET, "--literal-pathspecs", "-C", root, "diff-tree", "--no-commit-id",
  "-p", "-U3", "--no-color", "--no-ext-diff", "-M", ...sides(commit), "--", ...(file.from ? [file.from, file.path] : [file.path])];

const LETTERS = { A: "added", D: "deleted", R: "renamed", C: "renamed" };

// `diff-tree -r -z --raw --numstat -M`: the raw records first (":modes shas STATUS", then the path, a rename or copy
// then the old and the new path), then the numstat records ("add\tdel\tpath", a rename "add\tdel\t" then old and new).
// A binary file counts "-": null. `count` and `total` cover every file, `files` the first MAX_FILES.
export function parseCommitFiles(stdout) {
  const parts = stdout.split("\0"), all = new Map();
  let i = 0;
  for (; i < parts.length && parts[i].startsWith(":"); i++) {
    const letter = parts[i].slice(parts[i].lastIndexOf(" ") + 1)[0];
    const renamed = letter === "R" || letter === "C";
    const from = renamed ? parts[++i] : null;
    const path = parts[++i];
    all.set(path, { path, from, status: LETTERS[letter] ?? "modified", add: 0, del: 0 });
  }
  const count = (n) => (n === "-" ? null : Number(n));
  for (; i < parts.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t([^]*)$/.exec(parts[i]);
    if (!m) continue;
    const path = m[3] === "" ? (i += 2, parts[i]) : m[3];
    const file = all.get(path);
    if (file) { file.add = count(m[1]); file.del = count(m[2]); }
  }
  const list = [...all.values()];
  const total = { add: 0, del: 0 };
  for (const f of list) { total.add += f.add ?? 0; total.del += f.del ?? 0; }
  return { files: list.slice(0, MAX_FILES), count: list.length, total };
}
