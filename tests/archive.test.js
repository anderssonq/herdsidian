// Archived (AC-1 to AC-7): the pure store in lib/archive.js, and the lint guard on its copies.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArchive, withArchived, withoutArchived, isArchivedAgent, prunedSpaces, prunedAgents } from "../lib/archive.js";

const EMPTY = { spaces: [], agents: [] };

test("AC-1: a missing, null, non-object or wrongly typed store reads as empty and never throws", () => {
  for (const raw of [undefined, null, "x", 5, true, [], {}, { spaces: "a", agents: 5 }, { spaces: {}, agents: "t1" }]) {
    assert.deepEqual(readArchive(raw), EMPTY, JSON.stringify(raw));
  }
  assert.deepEqual(readArchive({ spaces: ["a"], agents: ["t1"] }), { spaces: ["a"], agents: ["t1"] });
});

test("AC-2: archiving an id twice stores it once; restoring an id that is not stored changes nothing", () => {
  const once = withArchived(undefined, "spaces", "a");
  assert.deepEqual(withArchived(once, "spaces", "a"), { spaces: ["a"], agents: [] });
  assert.deepEqual(withArchived(withArchived(undefined, "agents", "t1"), "agents", "t1"), { spaces: [], agents: ["t1"] });
  assert.deepEqual(withoutArchived(once, "spaces", "zz"), once);
  assert.deepEqual(withoutArchived(once, "agents", "a"), once);
  assert.deepEqual(withoutArchived(once, "spaces", "a"), EMPTY);
});

test("AC-3: a write to spaces keeps the stored agents unchanged, and the reverse", () => {
  const raw = { spaces: ["a"], agents: ["t1"] };
  assert.deepEqual(withArchived(raw, "spaces", "b"), { spaces: ["a", "b"], agents: ["t1"] });
  assert.deepEqual(withArchived(raw, "agents", "t2"), { spaces: ["a"], agents: ["t1", "t2"] });
  assert.deepEqual(withoutArchived(raw, "spaces", "a"), { spaces: [], agents: ["t1"] });
  assert.deepEqual(withoutArchived(raw, "agents", "t1"), { spaces: ["a"], agents: [] });
});

test("AC-4: an agent is archived when its address or its space is stored", () => {
  const store = { spaces: ["a"], agents: ["t9"] };
  assert.equal(isArchivedAgent(store, { address: "t9", space: "b" }), true);
  assert.equal(isArchivedAgent(store, { address: "t1", space: "a" }), true);
  assert.equal(isArchivedAgent(store, { address: "t1", space: "b" }), false);
  assert.equal(isArchivedAgent(EMPTY, { address: "t1", space: "a" }), false);
});

test("AC-5: space pruning drops an id only for a ready machine that no longer lists it", () => {
  const machines = [{ name: null, layout: "ready" }, { name: "vps", layout: "loading" }, { name: "nas", layout: "ready" }, { name: "gone", layout: "unavailable" }];
  const spaces = [{ id: "a" }, { id: "nas/z" }];
  const store = { spaces: ["a", "old", "vps/x", "nas/y", "nas/z", "gone/q", "other/w"], agents: ["t1"] };
  const out = prunedSpaces(store, machines, spaces);
  assert.deepEqual(out.spaces, ["a", "vps/x", "nas/z", "gone/q", "other/w"]);
  assert.deepEqual(out.agents, ["t1"]);
});

test("AC-6: agent pruning drops an address only for a heard machine where it is not a live terminal", () => {
  const terminals = [{ address: "t1", state: "live" }, { address: "t2", state: "gone" }, { address: "vps/t1", state: "live" }];
  const store = { spaces: ["a"], agents: ["t1", "t2", "t3", "vps/t1", "vps/t2", "nas/t1"] };
  const out = prunedAgents(store, terminals);
  assert.deepEqual(out.agents, ["t1", "vps/t1", "nas/t1"]);
  assert.deepEqual(out.spaces, ["a"]);
});

const repo = new URL("..", import.meta.url).pathname;
const copies = [];
after(() => { for (const dir of copies) rmSync(dir, { recursive: true, force: true }); });
const lint = (edit) => {
  const dir = mkdtempSync(join(tmpdir(), "herdsidian-lint-"));
  copies.push(dir);
  cpSync(repo, dir, { recursive: true, filter: (src) => !/(^|\/)(\.git|node_modules)$/.test(src) });
  edit(dir);
  const r = spawnSync(process.execPath, ["scripts/lint.js"], { cwd: dir, encoding: "utf8" });
  return { code: r.status, stderr: r.stderr };
};

test("AC-7: a clean copy passes lint", () => {
  const r = lint(() => {});
  assert.equal(r.code, 0, r.stderr);
});

for (const mod of ["guide-spaces", "guide-agents"]) {
  test(`AC-7: lint fails when mods/${mod}/archive.js differs from lib/archive.js`, () => {
    const r = lint((dir) => appendFileSync(join(dir, `mods/${mod}/archive.js`), "\n// drift\n"));
    assert.equal(r.code, 1);
    assert.match(r.stderr, new RegExp(`mods/${mod}/archive\\.js: differs from lib/archive\\.js`));
  });

  for (const runtime of ["herdr", "gpui-kit", "gpui-base"]) {
    test(`AC-7: lint fails when mods/${mod}/archive.js imports ${runtime}`, () => {
      const line = `\nimport { lintProbe } from "${runtime}";\n`;
      const r = lint((dir) => { for (const f of ["lib/archive.js", `mods/${mod}/archive.js`]) appendFileSync(join(dir, f), line); });
      assert.equal(r.code, 1);
      assert.match(r.stderr, new RegExp(`mods/${mod}/archive\\.js: line \\d+: pure file must not import`));
    });
  }
}
