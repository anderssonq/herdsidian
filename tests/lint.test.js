import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = new URL("..", import.meta.url).pathname;
const copies = [];

// A throwaway copy of the repo; the real tree is never touched.
const copyRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), "herdsidian-lint-"));
  copies.push(dir);
  cpSync(repo, dir, {
    recursive: true,
    filter: (src) => !/(^|\/)(\.git|node_modules)$/.test(src),
  });
  return dir;
};

// Appends one expression, wrapped so it stays valid JavaScript, to files of the copy.
const addLine = (dir, files, expr) => {
  for (const f of files) appendFileSync(join(dir, f), `\nfunction lintProbe(t, n, c) { return ${expr}; }\n`);
};

const lint = (cwd) => {
  const r = spawnSync(process.execPath, ["scripts/lint.js"], { cwd, encoding: "utf8" });
  return { code: r.status, stderr: r.stderr };
};

// Lints a copy with `expr` added to `file`.
const lintWith = (file, expr) => {
  const dir = copyRepo();
  addLine(dir, [file], expr);
  return lint(dir);
};

const pane = "mods/herdsidian-pane/main.js";

after(() => {
  for (const dir of copies) rmSync(dir, { recursive: true, force: true });
});

test("a clean copy passes", () => {
  const r = lint(copyRepo());
  assert.equal(r.code, 0, r.stderr);
});

test("rejects alpha glued with + \"26\"", () => {
  const r = lintWith(pane, 't.blocked + "26"');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /alpha glued/);
});

test("rejects alpha glued in the middle of a template", () => {
  const r = lintWith(pane, "`${t.blocked}26 solid`");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /alpha glued/);
});

test("rejects alpha glued with .concat(\"26\")", () => {
  const r = lintWith(pane, 't.blocked.concat("26")');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /alpha glued/);
});

test("accepts ${n}deleted (two hex chars then a letter)", () => {
  const r = lintWith(pane, "`${n}deleted`");
  assert.equal(r.code, 0, r.stderr);
});

test("rejects a short hex literal", () => {
  const r = lintWith(pane, '"#fff"');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /short hex/);
});

test("rejects a hex literal outside guide-spaces/main.js", () => {
  const r = lintWith(pane, '"#3fae6a"');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /hex literal #3fae6a/);
});

test("allows the avatar hex inside guide-spaces/main.js", () => {
  const r = lintWith("mods/guide-spaces/main.js", '"#3fae6a"');
  assert.equal(r.code, 0, r.stderr);
});

test("scans the ui.js copies for hex literals", () => {
  const dir = copyRepo();
  const uiCopies = readdirSync(join(dir, "mods"))
    .map((m) => `mods/${m}/ui.js`)
    .filter((f) => existsSync(join(dir, f)));
  assert.ok(uiCopies.includes("mods/herdsidian-chrome/ui.js"));
  // Same line in lib/ui.js and every copy, so the copy guard still passes.
  addLine(dir, ["lib/ui.js", ...uiCopies], '"#123456"');
  const r = lint(dir);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /mods\/herdsidian-chrome\/ui\.js: line \d+: hex literal #123456/);
  assert.doesNotMatch(r.stderr, /differs from lib/);
});
