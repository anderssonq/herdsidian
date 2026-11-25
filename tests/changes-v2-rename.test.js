// Changes V2: the patch of a rename (AC23, AC32). A rename with heavy edits is two sections in git's patch (the old
// file deleted, the new file added); parseHunks must read both. Checked against real git in a temp repo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as changes from "../mods/herdsidian/changes.js";

// Never an inherited GIT_DIR (a test run from a git hook would write into the wrong repo), and no user config.
// An empty home and no system attributes: a user's gitattributes diff driver would change sections and binary detection.
const isolated = realpathSync(mkdtempSync(join(tmpdir(), "herdsidian-rename-home-")));
const env = { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined,
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  HOME: isolated, XDG_CONFIG_HOME: isolated, GIT_ATTR_NOSYSTEM: "1" };
const git = (args) => execFileSync("git", args, { env, encoding: "utf8", maxBuffer: 1 << 24 });
const gitIn = (dir, ...args) => git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-C", dir, ...args]);

const ten = Array.from({ length: 10 }, (_v, i) => `row ${i + 1}`);
let repo = null;
const write = (name, text) => writeFileSync(join(repo, name), text);

// Three renames: a heavy edit (under 50 % similar), a heavy edit whose new file has no final newline, a light edit.
before(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "herdsidian-rename-")));
  gitIn(repo, "init", "-q", "-b", "main");
  write("a.txt", "alpha\nbeta\ngamma\ndelta\n");
  write("m.txt", "keep\nold\n");
  write("light.txt", `${ten.join("\n")}\n`);
  gitIn(repo, "add", "-A");
  gitIn(repo, "commit", "-q", "-m", "base");
  gitIn(repo, "mv", "a.txt", "z.txt");
  write("z.txt", "one\ntwo\nthree\n");
  gitIn(repo, "mv", "m.txt", "n.txt");
  write("n.txt", "brand\nnew");
  gitIn(repo, "mv", "light.txt", "lit.txt");
  write("lit.txt", `${ten.map((l, i) => (i === 4 ? "ROW 5" : l)).join("\n")}\n`);
});
after(() => {
  if (repo) rmSync(repo, { recursive: true, force: true });
  rmSync(isolated, { recursive: true, force: true });
});

// The patch of a status row, read with the exact patchArgs command the tab runs.
const patchOfRow = (path) => {
  const entry = changes.parseStatus(git(changes.statusArgs(repo))).entries.find((e) => e.path === path);
  assert.ok(entry, `status lists ${path}`);
  return { entry, patch: git(changes.patchArgs(repo, entry.path, entry.from, true)) };
};
const sections = (patch) => patch.split("\n").filter((l) => l.startsWith("diff --git "));
const head = (h) => ({ oldStart: h.oldStart, oldCount: h.oldCount, newStart: h.newStart, newCount: h.newCount, section: h.section });
const line = (kind, old, nu, text) => ({ kind, old, new: nu, text });

test("AC23: a rename with heavy edits gives the hunks of both sections, in git's order", () => {
  const { entry, patch } = patchOfRow("z.txt");
  assert.deepEqual([entry.from, entry.kind], ["a.txt", "renamed"]);
  assert.deepEqual(sections(patch), ["diff --git a/a.txt b/a.txt", "diff --git a/z.txt b/z.txt"], "git prints two sections");
  const hunks = changes.parseHunks(patch);
  assert.deepEqual(hunks.map(head), [
    { oldStart: 1, oldCount: 4, newStart: 0, newCount: 0, section: "" },
    { oldStart: 0, oldCount: 0, newStart: 1, newCount: 3, section: "" },
  ]);
  assert.deepEqual(hunks[0].lines, [line("del", 1, null, "alpha"), line("del", 2, null, "beta"), line("del", 3, null, "gamma"), line("del", 4, null, "delta")]);
  assert.deepEqual(hunks[1].lines, [line("add", null, 1, "one"), line("add", null, 2, "two"), line("add", null, 3, "three")]);
  // numstat lists the two sides as two entries (the row keeps only its own); the patch holds both.
  const stats = changes.parseNumstat(git(changes.diffArgs(repo, true)));
  const lines = hunks.flatMap((h) => h.lines);
  const counted = { add: lines.filter((l) => l.kind === "add").length, del: lines.filter((l) => l.kind === "del").length };
  const own = stats.get(entry.path), old = stats.get(entry.from);
  assert.deepEqual(counted, { add: own.add + old.add, del: own.del + old.del });
});

test("AC23: a rename with light edits is still one section with its content hunk only", () => {
  const { entry, patch } = patchOfRow("lit.txt");
  assert.equal(entry.from, "light.txt");
  assert.deepEqual(sections(patch), ["diff --git a/light.txt b/lit.txt"]);
  const hunks = changes.parseHunks(patch);
  assert.deepEqual(hunks.map(head), [{ oldStart: 2, oldCount: 7, newStart: 2, newCount: 7, section: "row 1" }]);
  assert.deepEqual(hunks[0].lines.filter((l) => l.kind !== "context"), [line("del", 5, null, "row 5"), line("add", null, 5, "ROW 5")]);
});

test("AC23: in a two-section rename, a no-newline note of the second section stays in its own hunk", () => {
  const { entry, patch } = patchOfRow("n.txt");
  assert.equal(entry.from, "m.txt");
  assert.deepEqual(sections(patch), ["diff --git a/m.txt b/m.txt", "diff --git a/n.txt b/n.txt"], "git prints two sections");
  const hunks = changes.parseHunks(patch);
  assert.deepEqual(hunks.map(head), [
    { oldStart: 1, oldCount: 2, newStart: 0, newCount: 0, section: "" },
    { oldStart: 0, oldCount: 0, newStart: 1, newCount: 2, section: "" },
  ]);
  assert.deepEqual(hunks[0].lines, [line("del", 1, null, "keep"), line("del", 2, null, "old")]);
  assert.deepEqual(hunks[1].lines.map((l) => l.kind), ["add", "add", "note"]);
  assert.deepEqual(hunks[1].lines.slice(0, 2), [line("add", null, 1, "brand"), line("add", null, 2, "new")]);
  assert.deepEqual([hunks[1].lines[2].old, hunks[1].lines[2].new], [null, null]);
  assert.match(hunks[1].lines[2].text, /No newline at end of file/);
});
