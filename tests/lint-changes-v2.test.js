import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tokens } from "../lib/tokens.js";
import { themeOf } from "./support/themes.js";

const repo = new URL("..", import.meta.url).pathname;
const copies = [];

// A throwaway copy of the repo; the real tree is never touched.
const copyRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), "herdsidian-lint-"));
  copies.push(dir);
  cpSync(repo, dir, { recursive: true, filter: (src) => !/(^|\/)(\.git|node_modules)$/.test(src) });
  return dir;
};

const lint = (cwd) => {
  const r = spawnSync(process.execPath, ["scripts/lint.js"], { cwd, encoding: "utf8" });
  return { code: r.status, stderr: r.stderr };
};

// The two files of the shared session rule: the canonical one and its copy.
const SESSION = ["lib/agent-session.js", "mods/guide-agents/agent-session.js"];
const SAME = "export const TAIL_BYTES = 262144;\n";

after(() => {
  for (const dir of copies) rmSync(dir, { recursive: true, force: true });
});

test("the real tree passes lint (true today)", () => {
  const r = lint(repo);
  assert.equal(r.code, 0, r.stderr);
});

test("AC44 lint passes when the two agent-session files are the same", () => {
  const dir = copyRepo();
  for (const f of SESSION) writeFileSync(join(dir, f), SAME);
  const r = lint(dir);
  assert.equal(r.code, 0, r.stderr);
});

for (const copy of SESSION.slice(1)) {
  test(`lint fails when ${copy} differs from lib/agent-session.js`, () => {
    const dir = copyRepo();
    for (const f of SESSION) writeFileSync(join(dir, f), SAME);
    appendFileSync(join(dir, copy), "// drift\n");
    const r = lint(dir);
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stderr, new RegExp(`${copy.replace(/\./g, "\\.")}.*differs from lib/agent-session\\.js`));
  });
}

for (const name of ["diff"]) {
  for (const spec of ["herdr", "gpui-kit", "gpui-base"]) {
    test(`lint fails when mods/herdsidian/${name}.js imports ${spec}`, () => {
      const dir = copyRepo();
      writeFileSync(join(dir, `mods/herdsidian/${name}.js`), `import { x } from "${spec}";\nexport const probe = x;\n`);
      const r = lint(dir);
      assert.equal(r.code, 1, r.stderr);
      assert.match(r.stderr, new RegExp(`mods/herdsidian/${name}\\.js: line 1: pure file must not import herdr`));
    });
  }
}

test("AC44 a differing tokens copy fails lint (true today)", () => {
  const dir = copyRepo();
  appendFileSync(join(dir, "mods/herdsidian/tokens.js"), "// drift\n");
  const r = lint(dir);
  assert.equal(r.code, 1, r.stderr);
  assert.match(r.stderr, /mods\/herdsidian\/tokens\.js.*differs from lib\/tokens\.js/);
});

test("AC44 tokens(t) has the same keys as before (true today)", () => {
  assert.deepEqual(Object.keys(tokens(themeOf("carbon"))), [
    "dot", "accentTrack", "highlight", "glass", "mainGlass", "line", "pill", "accentSoft", "changeMark",
    "glow", "glowEnd", "blockedSoft", "node", "nodeFar", "edge", "edgeHot",
  ]);
});
