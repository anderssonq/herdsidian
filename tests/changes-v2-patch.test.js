// Changes V2: the patch command, the hunk parser, the totals and the whole-file body (AC4, AC23, AC24, AC32, AC34),
// checked against patches made by real git in a temp repo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as changes from "../mods/herdsidian/changes.js";

// diff.js is new: before it exists every hunkTitle test fails on its own, not the whole file.
const diff = await import("../mods/herdsidian/diff.js").catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});

// Never an inherited GIT_DIR (a test run from a git hook would write into the wrong repo), and no user config.
// An empty home and no system attributes: a user's gitattributes diff driver would change sections and binary detection.
const isolated = realpathSync(mkdtempSync(join(tmpdir(), "herdsidian-patch-home-")));
const env = { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined,
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  HOME: isolated, XDG_CONFIG_HOME: isolated, GIT_ATTR_NOSYSTEM: "1" };
const git = (args) => execFileSync("git", args, { env, encoding: "utf8", maxBuffer: 1 << 24 });
const gitIn = (dir, ...args) => git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-C", dir, ...args]);

const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), "herdsidian-patch-")));
const write = (dir, name, text) => { mkdirSync(join(dir, name, ".."), { recursive: true }); writeFileSync(join(dir, name), text); };

// The quiet flags of V1, as diffArgs starts with them.
const quietOf = (root) => { const args = changes.diffArgs(root, true); return args.slice(0, args.indexOf("-C")); };

// The fixture repo of the parser tests: one commit, then one change per file.
const sixty = Array.from({ length: 60 }, (_v, i) => `line ${i + 1}`);
const ten = Array.from({ length: 10 }, (_v, i) => `row ${i + 1}`);
let repo = null;
before(() => {
  repo = scratch();
  gitIn(repo, "init", "-q", "-b", "main");
  write(repo, "three.txt", `${sixty.join("\n")}\n`);
  write(repo, "gone.txt", "first\nsecond\n");
  write(repo, "old.txt", `${ten.join("\n")}\n`);
  write(repo, "one.txt", "a\n");
  write(repo, "nonl.txt", "x\ny");
  write(repo, "crlf.txt", "a\r\nb\r\nc\r\n");
  write(repo, "tricky.txt", "top\n--- old\n-- a/file\nmid\nend\n");
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-q", "-m", "base");
  write(repo, "three.txt", `${sixty.map((l, i) => ([4, 29, 54].includes(i) ? l.toUpperCase() : l)).join("\n")}\n`);
  write(repo, "fresh.txt", "one\ntwo\nthree\n");
  gitIn(repo, "add", "fresh.txt");
  rmSync(join(repo, "gone.txt"));
  gitIn(repo, "mv", "old.txt", "new.txt");
  write(repo, "new.txt", `${ten.map((l, i) => (i === 4 ? "ROW 5" : l)).join("\n")}\n`);
  write(repo, "one.txt", "b\n");
  write(repo, "nonl.txt", "x\nz");
  write(repo, "crlf.txt", "a\r\nB\r\nc\r\n");
  write(repo, "tricky.txt", "top\n+++ new\n++ b/file\nmid\n@@ -9 +9 @@\nend\n");
});
after(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
  rmSync(isolated, { recursive: true, force: true });
});

// The patch of one change, made by real git with the flags of the plan (not through patchArgs, so a parser test
// fails only for the parser).
const patchOf = (path, from = null) =>
  gitIn(repo, "diff", "HEAD", "-U3", "--no-color", "--no-ext-diff", "-M", "--", ...(from ? [from, path] : [path]));
const FIXTURES = [
  { name: "3 hunks", path: "three.txt" },
  { name: "new file", path: "fresh.txt" },
  { name: "deleted file", path: "gone.txt" },
  { name: "rename with a content change", path: "new.txt", from: "old.txt" },
  { name: "header with no count", path: "one.txt" },
  { name: "no newline on both sides", path: "nonl.txt" },
  { name: "CRLF file", path: "crlf.txt" },
  { name: "content lines that start with ---, +++ and @@", path: "tricky.txt" },
];
const head = (h) => ({ oldStart: h.oldStart, oldCount: h.oldCount, newStart: h.newStart, newCount: h.newCount, section: h.section });
const line = (kind, old, nu, text) => ({ kind, old, new: nu, text });

// patchArgs (AC32 and D2 item 1)

test("AC32: patchArgs gives the exact command for a normal file, with -- before the path", () => {
  const root = "/work/repo";
  const args = changes.patchArgs(root, "src/a b.js", null, true);
  const quiet = quietOf(root);
  assert.ok(quiet.includes("--no-optional-locks"));
  assert.deepEqual(quiet.slice(quiet.indexOf("core.fsmonitor=false") - 1, quiet.indexOf("core.fsmonitor=false") + 1), ["-c", "core.fsmonitor=false"]);
  assert.deepEqual(args, [...quiet, "--literal-pathspecs", "-C", root, "diff", "HEAD", "-U3", "--no-color", "--no-ext-diff", "--", "src/a b.js"]);
  assert.equal(args.indexOf("--"), args.length - 2);
});

test("AC32: patchArgs of a rename passes -M, then --, then the old and the new path", () => {
  const root = "/work/repo";
  const args = changes.patchArgs(root, "new name.txt", "old name.txt", true);
  assert.deepEqual(args, [...quietOf(root), "--literal-pathspecs", "-C", root, "diff", "HEAD", "-U3", "--no-color", "--no-ext-diff",
    "-M", "--", "old name.txt", "new name.txt"]);
  assert.equal(args.indexOf("--"), args.length - 3);
});

test("AC32: patchArgs in a repo with no commit has no HEAD: the work tree against the index", () => {
  const root = "/work/repo";
  const args = changes.patchArgs(root, "a.txt", null, false);
  assert.deepEqual(args, [...quietOf(root), "--literal-pathspecs", "-C", root, "diff", "-U3", "--no-color", "--no-ext-diff", "--", "a.txt"]);
  assert.equal(args.includes("HEAD"), false);
});

test("AC32: with real git, a path with a space, a leading dash or shell characters gets the patch of that file only", () => {
  const dir = scratch();
  try {
    const names = ["a b.txt", "-dash.txt", "a*.txt", "ab.txt", "$(x).txt"];
    gitIn(dir, "init", "-q", "-b", "main");
    for (const name of names) write(dir, name, `${name} before\n`);
    write(dir, "old name.txt", `${ten.join("\n")}\n`);
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-q", "-m", "base");
    for (const name of names) write(dir, name, `${name} after\n`);
    gitIn(dir, "mv", "old name.txt", "new name.txt");
    write(dir, "new name.txt", `${ten.map((l, i) => (i === 4 ? "ROW 5" : l)).join("\n")}\n`);

    for (const name of names) {
      const patch = git(changes.patchArgs(dir, name, null, true));
      const heads = patch.split("\n").filter((l) => l.startsWith("diff --git "));
      assert.deepEqual(heads, [`diff --git a/${name} b/${name}`], name);
    }
    const renamed = git(changes.patchArgs(dir, "new name.txt", "old name.txt", true));
    assert.deepEqual(renamed.split("\n").filter((l) => l.startsWith("diff --git ")), ["diff --git a/old name.txt b/new name.txt"]);
    assert.ok(renamed.includes("\nrename from old name.txt\n"));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// parseHunks (AC23), each on a patch made by real git

test("AC23: parseHunks reads a file with 3 hunks: starts, counts and section", () => {
  const hunks = changes.parseHunks(patchOf("three.txt"));
  assert.deepEqual(hunks.map(head), [
    { oldStart: 2, oldCount: 7, newStart: 2, newCount: 7, section: "line 1" },
    { oldStart: 27, oldCount: 7, newStart: 27, newCount: 7, section: "line 26" },
    { oldStart: 52, oldCount: 7, newStart: 52, newCount: 7, section: "line 51" },
  ]);
  for (const [i, n] of [5, 30, 55].entries()) {
    assert.equal(hunks[i].lines.length, 8);
    assert.deepEqual(hunks[i].lines.filter((l) => l.kind !== "context"), [line("del", n, null, `line ${n}`), line("add", null, n, `LINE ${n}`)]);
  }
});

test("AC23: parseHunks reads a new file as add lines only", () => {
  const hunks = changes.parseHunks(patchOf("fresh.txt"));
  assert.deepEqual(hunks.map(head), [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 3, section: "" }]);
  assert.deepEqual(hunks[0].lines, [line("add", null, 1, "one"), line("add", null, 2, "two"), line("add", null, 3, "three")]);
});

test("AC23: parseHunks reads a deleted file as del lines only", () => {
  const hunks = changes.parseHunks(patchOf("gone.txt"));
  assert.deepEqual(hunks.map(head), [{ oldStart: 1, oldCount: 2, newStart: 0, newCount: 0, section: "" }]);
  assert.deepEqual(hunks[0].lines, [line("del", 1, null, "first"), line("del", 2, null, "second")]);
});

test("AC23: parseHunks of a rename with a content change gives the content hunk only", () => {
  const patch = patchOf("new.txt", "old.txt");
  assert.ok(patch.includes("\nrename from old.txt\n"), "the fixture is a rename");
  const hunks = changes.parseHunks(patch);
  assert.deepEqual(hunks.map(head), [{ oldStart: 2, oldCount: 7, newStart: 2, newCount: 7, section: "row 1" }]);
  assert.deepEqual(hunks[0].lines.filter((l) => l.kind !== "context"), [line("del", 5, null, "row 5"), line("add", null, 5, "ROW 5")]);
  assert.equal(hunks[0].lines.some((l) => /rename|similarity/.test(l.text)), false);
});

test("AC23: parseHunks reads a header with no count (@@ -1 +1 @@) as a count of 1", () => {
  const patch = patchOf("one.txt");
  assert.ok(patch.includes("\n@@ -1 +1 @@\n"), "the fixture has a header with no count");
  const hunks = changes.parseHunks(patch);
  assert.deepEqual(hunks.map(head), [{ oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, section: "" }]);
  assert.deepEqual(hunks[0].lines, [line("del", 1, null, "a"), line("add", null, 1, "b")]);
});

test("AC23: parseHunks reads the no-newline marker on both sides as notes with no numbers", () => {
  const hunks = changes.parseHunks(patchOf("nonl.txt"));
  assert.deepEqual(hunks.map(head), [{ oldStart: 1, oldCount: 2, newStart: 1, newCount: 2, section: "" }]);
  const lines = hunks[0].lines;
  assert.deepEqual(lines.map((l) => l.kind), ["context", "del", "note", "add", "note"]);
  assert.deepEqual(lines.filter((l) => l.kind !== "note"), [line("context", 1, 1, "x"), line("del", 2, null, "y"), line("add", null, 2, "z")]);
  for (const note of lines.filter((l) => l.kind === "note")) {
    assert.equal(note.old, null);
    assert.equal(note.new, null);
    assert.match(note.text, /No newline at end of file/);
  }
});

test("AC23: parseHunks of a CRLF file keeps no \\r in a text", () => {
  const patch = patchOf("crlf.txt");
  assert.ok(patch.includes("\r\n"), "the fixture has CRLF lines");
  const hunks = changes.parseHunks(patch);
  assert.deepEqual(hunks.map(head), [{ oldStart: 1, oldCount: 3, newStart: 1, newCount: 3, section: "" }]);
  assert.deepEqual(hunks[0].lines, [line("context", 1, 1, "a"), line("del", 2, null, "b"), line("add", null, 2, "B"), line("context", 3, 3, "c")]);
});

test("AC23: parseHunks reads content lines that start with ---, +++ and @@ as content", () => {
  const hunks = changes.parseHunks(patchOf("tricky.txt"));
  assert.deepEqual(hunks.map(head), [{ oldStart: 1, oldCount: 5, newStart: 1, newCount: 6, section: "" }]);
  assert.deepEqual(hunks[0].lines, [
    line("context", 1, 1, "top"),
    line("del", 2, null, "--- old"),
    line("del", 3, null, "-- a/file"),
    line("add", null, 2, "+++ new"),
    line("add", null, 3, "++ b/file"),
    line("context", 4, 4, "mid"),
    line("add", null, 5, "@@ -9 +9 @@"),
    line("context", 5, 6, "end"),
  ]);
});

test("AC23: for each fixture, the add and del lines equal parseNumstat of diffArgs for the same change", () => {
  const stats = changes.parseNumstat(git(changes.diffArgs(repo, true)));
  for (const { name, path, from } of FIXTURES) {
    const lines = changes.parseHunks(patchOf(path, from)).flatMap((h) => h.lines);
    const counted = { add: lines.filter((l) => l.kind === "add").length, del: lines.filter((l) => l.kind === "del").length };
    assert.deepEqual(counted, stats.get(path), name);
  }
});

test("AC25: line numbers: context has both, del only old, add only new, a note none", () => {
  for (const { name, path, from } of FIXTURES) {
    for (const l of changes.parseHunks(patchOf(path, from)).flatMap((h) => h.lines)) {
      const shape = [l.kind, typeof l.old, typeof l.new];
      const want = { context: ["context", "number", "number"], del: ["del", "number", "object"], add: ["add", "object", "number"],
        note: ["note", "object", "object"] }[l.kind];
      assert.deepEqual(shape, want, `${name}: ${JSON.stringify(l)}`);
      if (l.kind === "del") assert.equal(l.new, null, name);
      if (l.kind === "add") assert.equal(l.old, null, name);
      if (l.kind === "note") assert.deepEqual([l.old, l.new], [null, null], name);
    }
  }
});

// hunkTitle (AC24)

test("AC24: hunkTitle is \"Line <new start> · <section>\" when the hunk has a section", () => {
  const hunk = { oldStart: 118, oldCount: 5, newStart: 120, newCount: 7, section: "export class ChangesTab {", lines: [] };
  assert.equal(diff.hunkTitle(hunk), "Line 120 · export class ChangesTab {");
});

test("AC24: hunkTitle is \"Line <n>\" with no section", () => {
  assert.equal(diff.hunkTitle({ oldStart: 2, oldCount: 7, newStart: 3, newCount: 7, section: "", lines: [] }), "Line 3");
});

test("AC24: hunkTitle uses the old start when the new count is 0", () => {
  assert.equal(diff.hunkTitle({ oldStart: 7, oldCount: 3, newStart: 6, newCount: 0, section: "", lines: [] }), "Line 7");
  assert.equal(diff.hunkTitle({ oldStart: 7, oldCount: 3, newStart: 6, newCount: 0, section: "fn x", lines: [] }), "Line 7 · fn x");
});

// sumStats (AC4)

test("AC4: sumStats sums add and del of every entry; a binary entry adds 0", () => {
  const stats = new Map([["a.txt", { add: 2, del: 1 }], ["bin.dat", { add: null, del: null }], ["gone.txt", { add: 0, del: 4 }]]);
  assert.deepEqual(changes.sumStats(stats), { add: 2, del: 5 });
});

test("AC4: sumStats also counts the files after the first 500", () => {
  const stats = new Map(Array.from({ length: 600 }, (_v, i) => [`f${i}.txt`, { add: 1, del: 2 }]));
  assert.deepEqual(changes.sumStats(stats), { add: 600, del: 1200 });
});

test("AC4: sumStats of an empty map gives 0 and 0", () => {
  assert.deepEqual(changes.sumStats(new Map()), { add: 0, del: 0 });
});

// wholeFile (AC34)

test("AC34: wholeFile of a read that exceeds 1 MiB gives \"File too large to preview\"", () => {
  assert.deepEqual(changes.wholeFile({ error: "Text file exceeds 1 MiB" }), { notice: "File too large to preview" });
});

test("AC34: wholeFile of a read that is not UTF-8 gives \"Binary file, no preview\"", () => {
  assert.deepEqual(changes.wholeFile({ error: "stream did not contain valid UTF-8" }), { notice: "Binary file, no preview" });
});

test("AC34: wholeFile of any other read error gives its first line", () => {
  assert.deepEqual(changes.wholeFile({ error: "Permission denied\nsecond line" }), { notice: "Permission denied" });
});

test("AC34: wholeFile of a null read gives \"File not found\"", () => {
  assert.deepEqual(changes.wholeFile({ text: null }), { notice: "File not found" });
});

test("AC34: wholeFile of a text with a NUL gives \"Binary file, no preview\"", () => {
  assert.deepEqual(changes.wholeFile({ text: "a\0b\n" }), { notice: "Binary file, no preview" });
});

test("AC34: wholeFile of a text of 1048576 characters or more gives \"File too large to preview\"", () => {
  assert.deepEqual(changes.wholeFile({ text: "x".repeat(1048576) }), { notice: "File too large to preview" });
  assert.equal(changes.wholeFile({ text: "x".repeat(1048575) }).notice, undefined);
});

test("AC34: wholeFile of an empty text gives \"No text changes\"", () => {
  assert.deepEqual(changes.wholeFile({ text: "" }), { notice: "No text changes" });
});

test("AC34: wholeFile gives one hunk of add lines numbered from 1, under \"Line 1\"", () => {
  const { hunks } = changes.wholeFile({ text: "one\ntwo\nthree\n" });
  assert.deepEqual(hunks, [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 3, section: "",
    lines: [line("add", null, 1, "one"), line("add", null, 2, "two"), line("add", null, 3, "three")] }]);
  assert.equal(diff.hunkTitle(hunks[0]), "Line 1");
});

test("AC34: wholeFile of a file with no final newline keeps its last line", () => {
  const { hunks } = changes.wholeFile({ text: "one\ntwo" });
  assert.deepEqual(hunks, [{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 2, section: "",
    lines: [line("add", null, 1, "one"), line("add", null, 2, "two")] }]);
});
