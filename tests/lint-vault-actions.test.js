import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
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

// Appends one expression, wrapped so it stays valid JavaScript, to a file of the copy.
const addLine = (dir, file, expr) => {
  appendFileSync(join(dir, file), `\nfunction lintProbe(t, n, c) { return ${expr}; }\n`);
};

const lint = (cwd) => {
  const r = spawnSync(process.execPath, ["scripts/lint.js"], { cwd, encoding: "utf8" });
  return { code: r.status, stderr: r.stderr };
};

// Lints a copy with `expr` added to `file`.
const lintWith = (file, expr) => {
  const dir = copyRepo();
  addLine(dir, file, expr);
  return lint(dir);
};

const main = "mods/herdsidian/main.js";

after(() => {
  for (const dir of copies) rmSync(dir, { recursive: true, force: true });
});

test("the real tree passes the vault actions rules", () => {
  const r = lint(repo);
  assert.equal(r.code, 0, r.stderr);
});

for (const cmd of ["rm", "rmdir", "unlink"]) {
  test(`rejects exec of ${cmd} in mods/herdsidian`, () => {
    const r = lintWith(main, `exec("${cmd}", ["x"])`);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /mods\/herdsidian\/main\.js: line \d+: no rm, rmdir or unlink/);
  });
}

for (const expr of [
  'exec("/bin/rm", ["x"])',
  'exec("/usr/bin/unlink", ["x"])',
  'deps.exec("/bin/rmdir", ["x"])',
  'run(deps, "rm", ["x"])',
  'run(deps, "rmdir", ["x"])',
  'run(deps, "/bin/rm", ["x"])',
  'run("unlink", ["x"])',
  "run(deps, `rm`, [])",
]) {
  test(`rejects ${expr} in mods/herdsidian`, () => {
    const r = lintWith(main, expr);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /mods\/herdsidian\/main\.js: line \d+: no rm, rmdir or unlink/);
  });
}

for (const expr of ['run(deps, "mkdir", ["x"])', 'exec("/bin/mv", ["a", "b"])', 'run("layout.show", { id: "rm" })', 'exec("/usr/bin/trash", ["-s", "x"])']) {
  test(`allows ${expr} in mods/herdsidian`, () => {
    const r = lintWith(main, expr);
    assert.equal(r.code, 0, r.stderr);
  });
}

test("rejects dim as a text color in mods/herdsidian", () => {
  const r = lintWith(main, 'div().text_color(t.dim)');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /mods\/herdsidian\/main\.js: line \d+: dim is never a text color/);
});

test("rejects rm - inside a string in mods/herdsidian", () => {
  const r = lintWith(main, 'exec("sh", ["-c", "rm -rf x"])');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /mods\/herdsidian\/main\.js: line \d+: no rm, rmdir or unlink/);
});
