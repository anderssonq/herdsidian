import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const notes = "mods/herdsidian/main.js";

test("rejects window.paint_path without globalThis", () => {
  const r = lintWith(pane, "window.paint_path(1)");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /mods\/herdsidian-pane\/main\.js: line \d+: use globalThis\.window\.paint_path/);
});

test("accepts globalThis.window.paint_path", () => {
  const r = lintWith(pane, "globalThis.window.paint_path(1)");
  assert.equal(r.code, 0, r.stderr);
});

test("rejects terminal.send in mods/herdsidian", () => {
  const r = lintWith(notes, 'run("terminal.send", {})');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /mods\/herdsidian\/main\.js: line \d+: Send to agent must paste, never submit/);
});

test("rejects an Enter key in mods/herdsidian", () => {
  const r = lintWith(notes, '"enter"');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Send to agent must paste, never submit/);
});

test("allows terminal.send outside mods/herdsidian (the rule is scoped)", () => {
  const r = lintWith(pane, 'run("terminal.send", {})');
  assert.equal(r.code, 0, r.stderr);
});

// The no-submit rule also covers the palette files.
const paletteFiles = ["palette-main.js", "palette.js", "palette-view.js", "send.js"].map((f) => `mods/herdsidian/${f}`);
for (const file of paletteFiles) {
  for (const [what, expr] of [["task:", "{ task: 1 }"], ["terminal.keys", 'run("terminal.keys", {})'], ['"enter"', '"enter"']]) {
    test(`rejects ${what} in ${file}`, () => {
      const r = lintWith(file, expr);
      assert.equal(r.code, 1);
      assert.match(r.stderr, /Send to agent must paste, never submit/);
    });
  }
}

test("accepts \"cmd-enter\" in palette-main.js", () => {
  const r = lintWith("mods/herdsidian/palette-main.js", '"cmd-enter"');
  assert.equal(r.code, 0, r.stderr);
});

// Lints a copy whose keys.json has cmd-k bound to `action`.
const lintKey = (action) => {
  const dir = copyRepo();
  const file = join(dir, "keys.json");
  const keys = JSON.parse(readFileSync(file, "utf8"));
  keys["layout:herdsidian"]["cmd-k"] = action;
  writeFileSync(file, JSON.stringify(keys, null, 2));
  return lint(dir);
};

test("rejects mod.open of a mod that does not exist", () => {
  const r = lintKey("mod.open:nope");
  assert.equal(r.code, 1);
  assert.match(r.stderr, /mod\.open:nope/);
});

test("accepts mod.open of a mod in mods/ and of a shipped mod", () => {
  assert.equal(lintKey("mod.open:herdsidian").code, 0);
  assert.equal(lintKey("mod.open:picker").code, 0);
});

// Lints a copy with a top-level import line appended to `file`.
const lintImport = (file, line) => {
  const dir = copyRepo();
  appendFileSync(join(dir, file), `\n${line}\n`);
  return lint(dir);
};

test("rejects a herdr import in a pure file", () => {
  const r = lintImport("mods/herdsidian/palette.js", 'import { run } from "herdr";');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /mods\/herdsidian\/palette\.js: line \d+: pure file must not import herdr/);
});

test("rejects a gpui-kit import in a pure file", () => {
  const r = lintImport("mods/herdsidian/graph.js", 'import { div } from "gpui-kit";');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /pure file must not import/);
});

test("accepts a herdr import in palette-main.js", () => {
  const r = lintImport("mods/herdsidian/palette-main.js", 'import { run as lintProbeRun } from "herdr";');
  assert.equal(r.code, 0, r.stderr);
});
