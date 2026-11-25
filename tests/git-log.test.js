// The Git tab's pure read layer (git-log.js): the argument builders and the parsers of history, status, refs, stash,
// remotes, operations and a commit's files, checked against fixtures written by hand in git's documented shapes (AC13, AC14, AC15, AC40, AC43).
import { test } from "node:test";
import assert from "node:assert/strict";
import { logArgs, parseLog, LOG_PAGE, LOG_FORMAT, statusArgs2, parseStatus2, refsArgs, parseRefs, remotesArgs, parseRemotes,
  stashTopArgs, parseStashTop, OP_FILES, opOf, commitFilesArgs, commitPatchArgs, parseCommitFiles, MAX_FILES }
  from "../mods/herdsidian/git-log.js";

const QUIET = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
const NUL = "\0";
const hex = (letter, n = 40) => letter.repeat(n);
const nuls = (records) => records.map((r) => r + NUL).join("");

test("AC13: the history command for the first page, a count of 600 and a skip of 300", () => {
  assert.equal(LOG_PAGE, 300);
  assert.equal(LOG_FORMAT, "%H%x00%P%x00%an%x00%ae%x00%at%x00%s");
  const base = ["log", "--exclude=refs/stash", "--exclude=refs/notes/*", "--all", "--topo-order", "--no-color"];
  const format = `--format=${LOG_FORMAT}`;
  assert.deepEqual(logArgs("/work/repo"), [...QUIET, "-C", "/work/repo", ...base, "-n", "300", format]);
  assert.deepEqual(logArgs("/work/repo", 600), [...QUIET, "-C", "/work/repo", ...base, "-n", "600", format]);
  assert.deepEqual(logArgs("/work/repo", 300, 300), [...QUIET, "-C", "/work/repo", ...base, "-n", "300", format, "--skip=300"]);
});

const record = (hash, parents, author, email, at, subject) => [hash, parents.join(" "), author, email, at, subject].join(NUL) + "\n";

test("AC14: parseLog keeps every field in its place for hard subjects", () => {
  const out = [
    record(hex("a"), [hex("b")], "Ada Lovelace", "ada@example.com", "1700000000", "tab\there, \"quotes\" and 'single' | pipe"),
    record(hex("b"), [hex("c")], "Zoë Ñandú", "zoe@example.com", "1700000060", "emoji 🚀 café 日本語 — dash"),
    record(hex("c"), [], "Root", "root@example.com", "1700000120", "initial"),
  ].join("");
  assert.deepEqual(parseLog(out), [
    { hash: hex("a"), parents: [hex("b")], author: "Ada Lovelace", email: "ada@example.com", at: 1700000000000, subject: "tab\there, \"quotes\" and 'single' | pipe" },
    { hash: hex("b"), parents: [hex("c")], author: "Zoë Ñandú", email: "zoe@example.com", at: 1700000060000, subject: "emoji 🚀 café 日本語 — dash" },
    { hash: hex("c"), parents: [], author: "Root", email: "root@example.com", at: 1700000120000, subject: "initial" },
  ]);
});

test("AC14: parseLog reads an empty subject, an author with no email and an unreadable time", () => {
  const out = record(hex("a"), [hex("b")], "Ada", "ada@example.com", "1700000000", "")
    + record(hex("b"), [], "No Mail", "", "1700000060", "next")
    + record(hex("c"), [], "Late", "late@example.com", "", "no time");
  const [empty, noMail, noTime] = parseLog(out);
  assert.equal(empty.subject, "");
  assert.equal(empty.author, "Ada");
  assert.equal(empty.email, "ada@example.com");
  assert.equal(empty.at, 1700000000000);
  assert.deepEqual(noMail, { hash: hex("b"), parents: [], author: "No Mail", email: "", at: 1700000060000, subject: "next" });
  assert.equal(noTime.at, null);
  assert.equal(noTime.subject, "no time");
});

test("AC14: parseLog reads 0, 1, 2 and 4 parents and a 64-hex hash", () => {
  const out = record(hex("1"), [], "A", "a@x.io", "1", "none")
    + record(hex("2"), [hex("a")], "A", "a@x.io", "2", "one")
    + record(hex("3"), [hex("a"), hex("b")], "A", "a@x.io", "3", "two")
    + record(hex("4"), [hex("a"), hex("b"), hex("c"), hex("d")], "A", "a@x.io", "4", "four")
    + record(hex("e", 64), [hex("f", 64)], "A", "a@x.io", "5", "sha256");
  const commits = parseLog(out);
  assert.deepEqual(commits.map((c) => c.parents.length), [0, 1, 2, 4, 1]);
  assert.deepEqual(commits[3].parents, [hex("a"), hex("b"), hex("c"), hex("d")]);
  assert.equal(commits[4].hash, hex("e", 64));
  assert.deepEqual(commits[4].parents, [hex("f", 64)]);
  assert.deepEqual(commits.map((c) => c.subject), ["none", "one", "two", "four", "sha256"]);
});

test("AC14: parseLog skips empty records and an empty output", () => {
  assert.deepEqual(parseLog(""), []);
  const out = `\n${record(hex("a"), [], "A", "a@x.io", "1", "only")}\n`;
  assert.equal(parseLog(out).length, 1);
});

test("parseStatus2 reads a clean branch with an upstream", () => {
  const out = nuls([`# branch.oid ${hex("a")}`, "# branch.head main", "# branch.upstream origin/main", "# branch.ab +0 -0"]);
  assert.deepEqual(parseStatus2(out), { head: hex("a"), branch: "main", upstreamShort: "origin/main", ahead: 0, behind: 0, changed: 0, unmerged: 0 });
});

test("parseStatus2 reads ahead and behind", () => {
  const out = nuls([`# branch.oid ${hex("a")}`, "# branch.head feat/x", "# branch.upstream origin/feat/x", "# branch.ab +3 -2", "# stash 2"]);
  const status = parseStatus2(out);
  assert.equal(status.branch, "feat/x");
  assert.equal(status.upstreamShort, "origin/feat/x");
  assert.equal(status.ahead, 3);
  assert.equal(status.behind, 2);
});

test("parseStatus2 gives null ahead, behind and upstream with no upstream", () => {
  const status = parseStatus2(nuls([`# branch.oid ${hex("a")}`, "# branch.head main"]));
  assert.equal(status.upstreamShort, null);
  assert.equal(status.ahead, null);
  assert.equal(status.behind, null);
  assert.equal(status.branch, "main");
});

test("parseStatus2 gives a null branch when detached and a null head with no commit", () => {
  const detached = parseStatus2(nuls([`# branch.oid ${hex("a")}`, "# branch.head (detached)"]));
  assert.equal(detached.branch, null);
  assert.equal(detached.head, hex("a"));
  const fresh = parseStatus2(nuls(["# branch.oid (initial)", "# branch.head main"]));
  assert.equal(fresh.head, null);
  assert.equal(fresh.branch, "main");
});

test("parseStatus2 counts a rename once: its old path is not an entry", () => {
  const out = nuls([`# branch.oid ${hex("a")}`, "# branch.head main",
    `2 R. N... 100644 100644 100644 ${hex("a")} ${hex("b")} R100 new name.txt`, "old name.txt",
    `1 .M N... 100644 100644 100644 ${hex("a")} ${hex("b")} lib/ui.js`]);
  const status = parseStatus2(out);
  assert.equal(status.changed, 2);
  assert.equal(status.unmerged, 0);
});

test("parseStatus2 counts an unmerged entry", () => {
  const out = nuls([`# branch.oid ${hex("a")}`, "# branch.head main",
    `u UU N... 100644 100644 100644 100644 ${hex("a")} ${hex("b")} ${hex("c")} conflicted.txt`]);
  assert.equal(parseStatus2(out).unmerged, 1);
});

test("the status, refs, remote and stash builders", () => {
  assert.deepEqual(statusArgs2("/work/repo"), [...QUIET, "-C", "/work/repo", "status", "--porcelain=v2", "--branch", "--show-stash", "-z"]);
  const refs = refsArgs("/work/repo");
  assert.deepEqual(refs.slice(0, 6), [...QUIET, "-C", "/work/repo", "for-each-ref"]);
  assert.match(refs[6], /^--format=/);
  assert.deepEqual(refs.slice(7), ["refs/heads", "refs/remotes", "refs/tags"]);
  assert.deepEqual(remotesArgs("/work/repo"), [...QUIET, "-C", "/work/repo", "remote"]);
  assert.deepEqual(stashTopArgs("/work/repo"), [...QUIET, "-C", "/work/repo", "stash", "list", "-n", "1", "--format=%H%x00%gs"]);
});

// A for-each-ref line: refname, object, peeled object, symref, upstream remote, upstream ref, HEAD mark.
const refLine = (full, sha, { peeled = "", symref = "", remote = "", ref = "", head = " " } = {}) => [full, sha, peeled, symref, remote, ref, head].join(NUL) + "\n";

test("AC15: parseRefs classes local, remote and tag refs and drops the remote HEAD symref", () => {
  const out = refLine("refs/heads/main", hex("a"), { remote: "origin", ref: "refs/heads/main", head: "*" })
    + refLine("refs/heads/feat/x", hex("b"))
    + refLine("refs/remotes/origin/main", hex("a"))
    + refLine("refs/remotes/origin/HEAD", hex("a"), { symref: "refs/remotes/origin/main" })
    + refLine("refs/tags/v1", hex("c"))
    + refLine("refs/tags/v2", hex("d"), { peeled: hex("e") });
  const { refs } = parseRefs(out);
  assert.deepEqual(refs, [
    { full: "refs/heads/main", name: "main", kind: "local", sha: hex("a"), current: true },
    { full: "refs/heads/feat/x", name: "feat/x", kind: "local", sha: hex("b"), current: false },
    { full: "refs/remotes/origin/main", name: "origin/main", kind: "remote", sha: hex("a"), current: false },
    { full: "refs/tags/v1", name: "v1", kind: "tag", sha: hex("c"), current: false },
    { full: "refs/tags/v2", name: "v2", kind: "tag", sha: hex("e"), current: false },
  ]);
});

test("AC15: parseRefs takes the upstream of the current branch, or null", () => {
  const withUp = refLine("refs/heads/main", hex("a"), { remote: "origin", ref: "refs/heads/main", head: "*" })
    + refLine("refs/heads/other", hex("b"), { remote: "fork", ref: "refs/heads/other" });
  assert.deepEqual(parseRefs(withUp).upstream, { remote: "origin", ref: "refs/heads/main" });
  const without = refLine("refs/heads/main", hex("a"), { head: "*" }) + refLine("refs/heads/other", hex("b"), { remote: "fork", ref: "refs/heads/other" });
  assert.equal(parseRefs(without).upstream, null);
  assert.equal(parseRefs("").upstream, null);
  assert.deepEqual(parseRefs("").refs, []);
});

test("parseStashTop reads the top stash or null", () => {
  const top = parseStashTop(`${hex("a")}${NUL}On main: wip notes\n`);
  assert.equal(top.hash, hex("a"));
  assert.match(top.message, /wip notes$/);
  assert.equal(parseStashTop(""), null);
});

test("parseRemotes reads one name per line", () => {
  assert.deepEqual(parseRemotes("origin\nupstream\n"), ["origin", "upstream"]);
  assert.deepEqual(parseRemotes(""), []);
});

test("opOf names the operation of each file and none for no file", () => {
  assert.equal(opOf([]), null);
  assert.equal(opOf(["MERGE_HEAD"]), "merge");
  assert.equal(opOf(["CHERRY_PICK_HEAD"]), "cherry-pick");
  assert.equal(opOf(["REVERT_HEAD"]), "revert");
  assert.equal(opOf(["BISECT_LOG"]), "bisect");
  assert.equal(opOf(["rebase-merge/head-name"]), "rebase");
  assert.equal(opOf(["rebase-apply/head-name"]), "rebase");
  assert.equal(opOf(["rebase-apply/applying"]), "rebase");
  assert.equal(opOf(["something-else"]), null);
});

test("OP_FILES lists the seven files and opOf keeps the order rebase, merge, cherry-pick, revert, bisect", () => {
  assert.deepEqual(OP_FILES.map(([file]) => file).sort(), ["BISECT_LOG", "CHERRY_PICK_HEAD", "MERGE_HEAD", "REVERT_HEAD",
    "rebase-apply/applying", "rebase-apply/head-name", "rebase-merge/head-name"]);
  assert.equal(opOf(["BISECT_LOG", "REVERT_HEAD", "CHERRY_PICK_HEAD", "MERGE_HEAD", "rebase-merge/head-name"]), "rebase");
  assert.equal(opOf(["BISECT_LOG", "REVERT_HEAD", "CHERRY_PICK_HEAD", "MERGE_HEAD"]), "merge");
  assert.equal(opOf(["BISECT_LOG", "REVERT_HEAD", "CHERRY_PICK_HEAD"]), "cherry-pick");
  assert.equal(opOf(["BISECT_LOG", "REVERT_HEAD"]), "revert");
});

test("AC40: commitFilesArgs compares with the first parent, or uses --root", () => {
  const head = [...QUIET, "-C", "/work/repo", "diff-tree", "-r", "-z", "--raw", "--numstat", "-M", "--no-commit-id"];
  assert.deepEqual(commitFilesArgs("/work/repo", { hash: hex("a"), parents: [hex("b")] }), [...head, hex("b"), hex("a")]);
  assert.deepEqual(commitFilesArgs("/work/repo", { hash: hex("a"), parents: [hex("b"), hex("c")] }), [...head, hex("b"), hex("a")]);
  assert.deepEqual(commitFilesArgs("/work/repo", { hash: hex("a"), parents: [] }), [...head, "--root", hex("a")]);
});

test("AC43: commitPatchArgs for a normal commit, a merge, a root commit and a rename", () => {
  const head = [...QUIET, "--literal-pathspecs", "-C", "/work/repo", "diff-tree", "--no-commit-id", "-p", "-U3", "--no-color", "--no-ext-diff", "-M"];
  const file = { path: "src/a.js", from: null };
  assert.deepEqual(commitPatchArgs("/work/repo", { hash: hex("a"), parents: [hex("b")] }, file), [...head, hex("b"), hex("a"), "--", "src/a.js"]);
  assert.deepEqual(commitPatchArgs("/work/repo", { hash: hex("a"), parents: [hex("b"), hex("c")] }, file), [...head, hex("b"), hex("a"), "--", "src/a.js"]);
  assert.deepEqual(commitPatchArgs("/work/repo", { hash: hex("a"), parents: [] }, file), [...head, "--root", hex("a"), "--", "src/a.js"]);
  assert.deepEqual(commitPatchArgs("/work/repo", { hash: hex("a"), parents: [hex("b")] }, { path: "new name.js", from: "old name.js" }),
    [...head, hex("b"), hex("a"), "--", "old name.js", "new name.js"]);
});

// The raw records, then the numstat records, as `diff-tree -r -z --raw --numstat -M` prints them.
const raw = (letter, path, from) => `:100644 100644 ${hex("0")} ${hex("1")} ${letter}${NUL}${from ? `${from}${NUL}` : ""}${path}${NUL}`;
const stat = (add, del, path, from) => (from ? `${add}\t${del}\t${NUL}${from}${NUL}${path}${NUL}` : `${add}\t${del}\t${path}${NUL}`);

test("AC40: parseCommitFiles reads A, M, D, R, T, a binary file and the totals", () => {
  const out = raw("A", "src/new.js") + raw("M", "src/old.js") + raw("D", "gone.txt") + raw("R100", "dir/renamed name.js", "dir/before.js")
    + raw("T", "link.sh") + raw("M", "logo.png")
    + stat(10, 0, "src/new.js") + stat(3, 2, "src/old.js") + stat(0, 7, "gone.txt") + stat(4, 1, "dir/renamed name.js", "dir/before.js")
    + stat(1, 1, "link.sh") + stat("-", "-", "logo.png");
  const { files, count, total } = parseCommitFiles(out);
  const row = (f) => ({ path: f.path, status: f.status, add: f.add, del: f.del });
  assert.deepEqual(files.map(row), [
    { path: "src/new.js", status: "added", add: 10, del: 0 },
    { path: "src/old.js", status: "modified", add: 3, del: 2 },
    { path: "gone.txt", status: "deleted", add: 0, del: 7 },
    { path: "dir/renamed name.js", status: "renamed", add: 4, del: 1 },
    { path: "link.sh", status: "modified", add: 1, del: 1 },
    { path: "logo.png", status: "modified", add: null, del: null },
  ]);
  assert.equal(files[3].from, "dir/before.js");
  assert.ok(!files[0].from);
  assert.equal(count, 6);
  assert.deepEqual(total, { add: 18, del: 11 });
});

test("AC40: parseCommitFiles caps 501 files at 500 rows and counts all 501", () => {
  assert.equal(MAX_FILES, 500);
  const paths = Array.from({ length: 501 }, (_, i) => `f${i}.txt`);
  const out = paths.map((p) => raw("A", p)).join("") + paths.map((p) => stat(2, 1, p)).join("");
  const { files, count, total } = parseCommitFiles(out);
  assert.equal(files.length, 500);
  assert.equal(count, 501);
  assert.deepEqual(total, { add: 1002, del: 501 });
  assert.equal(files[499].path, "f499.txt");
});

test("AC40: parseCommitFiles of an empty output is empty", () => {
  assert.deepEqual(parseCommitFiles(""), { files: [], count: 0, total: { add: 0, del: 0 } });
});
