// Lint and source rules of the Git tab: the pure files stay pure, the session reader is gone, the write builders stay in two files.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = new URL("..", import.meta.url).pathname;
const dirs = [];
let shared = null;

// One throwaway copy of the repo for every case; the real tree is never touched.
const copyRepo = () => {
  if (shared) return shared;
  shared = mkdtempSync(join(tmpdir(), "herdsidian-lint-git-"));
  dirs.push(shared);
  cpSync(repo, shared, { recursive: true, filter: (src) => !/(^|\/)(\.git|node_modules)$/.test(src) });
  return shared;
};

const lint = (cwd) => {
  const r = spawnSync(process.execPath, ["scripts/lint.js"], { cwd, encoding: "utf8" });
  return { code: r.status, stderr: r.stderr };
};

// Run `fn` with `rel` of the copy set to `content`, then put the file back as it was.
const withFile = (rel, content, fn) => {
  const path = join(copyRepo(), rel);
  const had = existsSync(path);
  const original = had ? readFileSync(path, "utf8") : null;
  writeFileSync(path, content);
  try { return fn(); }
  finally { if (had) writeFileSync(path, original); else rmSync(path, { force: true }); }
};

const withAppend = (rel, text, fn) => {
  const path = join(copyRepo(), rel);
  const original = readFileSync(path, "utf8");
  appendFileSync(path, text);
  try { return fn(); }
  finally { writeFileSync(path, original); }
};

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const sources = (dir) => readdirSync(dir, { recursive: true }).filter((f) => f.endsWith(".js")).map((f) => ({ file: f, text: readFileSync(join(dir, f), "utf8") }));
const herdsidian = join(repo, "mods/herdsidian");

test("AC54 the real tree passes lint", () => {
  const r = lint(repo);
  assert.equal(r.code, 0, r.stderr);
});

// ---- AC54: the pure files import no host module
// One lint run per file (lint takes seconds): line 1 imports herdr, line 2 gpui-kit, line 3 gpui-base, and each line must be named.
const SPECS = ["herdr", "gpui-kit", "gpui-base"];
for (const name of ["git-log", "git-lanes", "git-model", "git-actions", "git-run", "diff-pane"]) {
  test(`AC54 lint fails when mods/herdsidian/${name}.js imports herdr, gpui-kit or gpui-base`, () => {
    const source = SPECS.map((spec, i) => `import { x${i} } from "${spec}";`).join("\n") + "\nexport const probe = [x0, x1, x2];\n";
    withFile(`mods/herdsidian/${name}.js`, source, () => {
      const r = lint(copyRepo());
      assert.equal(r.code, 1, r.stderr);
      SPECS.forEach((spec, i) => {
        assert.match(r.stderr, new RegExp(`mods/herdsidian/${name}\\.js: line ${i + 1}: pure file must not import herdr`), spec);
      });
    });
  });
}

// ---- AC33: shared copies and no hex literal in a mod
const copiesOf = (name) => readdirSync(join(repo, "mods")).filter((m) => existsSync(join(repo, "mods", m, `${name}.js`))).map((m) => `mods/${m}/${name}.js`);

for (const name of ["tokens", "keys"]) {
  const copies = copiesOf(name);
  test(`AC33 there are copies of lib/${name}.js to check`, () => assert.ok(copies.length >= 5, copies.join(", ")));
  for (const copy of copies) {
    test(`AC33 lint fails when ${copy} differs from lib/${name}.js`, () => {
      withAppend(copy, "// drift\n", () => {
        const r = lint(copyRepo());
        assert.equal(r.code, 1, r.stderr);
        assert.match(r.stderr, new RegExp(`${copy.replace(/\./g, "\\.")}.*differs from lib/${name}\\.js`));
      });
    });
  }
}

test("AC33 lint fails on a hex literal in a Git file of a mod", () => {
  withFile("mods/herdsidian/git-model.js", 'export const probe = "#12abef";\n', () => {
    const r = lint(copyRepo());
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, /mods\/herdsidian\/git-model\.js: line 1: hex literal #12abef/);
  });
});

// ---- AC3: the session reader is gone
test("AC3 turn.js and agent-session.js do not exist in mods/herdsidian", () => {
  assert.equal(existsSync(join(herdsidian, "turn.js")), false);
  assert.equal(existsSync(join(herdsidian, "agent-session.js")), false);
});

test("AC3 no file of mods/herdsidian imports turn.js or agent-session.js", () => {
  const importing = sources(herdsidian).filter((s) => /from\s*["']\.\/(turn|agent-session)\.js["']|import\s*["']\.\/(turn|agent-session)\.js["']/.test(s.text)).map((s) => s.file);
  assert.deepEqual(importing, []);
});

test("AC3 scripts/lint.js does not name the two removed files", () => {
  const text = readFileSync(join(repo, "scripts/lint.js"), "utf8");
  assert.equal(text.includes("mods/herdsidian/turn.js"), false);
  assert.equal(text.includes("mods/herdsidian/agent-session.js"), false);
});

test("AC3 lib/agent-session.js equals mods/guide-agents/agent-session.js", () => {
  assert.equal(readFileSync(join(repo, "mods/guide-agents/agent-session.js"), "utf8"), readFileSync(join(repo, "lib/agent-session.js"), "utf8"));
});

// ---- AC1 and R13: no session read, and the write builders stay in two files
test("AC1 no file of mods/herdsidian holds /bin/sh or .claude", () => {
  const holding = sources(herdsidian).filter((s) => s.text.includes("/bin/sh") || s.text.includes(".claude")).map((s) => s.file);
  assert.deepEqual(holding, []);
});

test("AC52 only git-actions.js and git-run.js hold the name of a Command builder", () => {
  const builder = /\b(?:fetch|pull|push|branch|stash|pop|checkName)Command\b/;
  const holding = sources(herdsidian).filter((s) => builder.test(s.text)).map((s) => s.file).sort();
  for (const file of holding) assert.ok(["git-actions.js", "git-run.js"].includes(file), `${file} names a Command builder`);
});
