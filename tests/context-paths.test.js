import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { renamePaths, removePaths, applyChange } from "../mods/herdsidian/context.js";

// io.js imports the herdr runtime, which does not exist under node: resolve it to an empty stub.
const hooks = `
export const resolve = (spec, ctx, next) => spec === "herdr"
  ? { url: "data:text/javascript,export const exec=0,readTextFile=0,writeTextFile=0", shortCircuit: true }
  : next(spec, ctx);`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);
const { saveContext, listNotes, PRUNE } = await import("../mods/herdsidian/io.js");

const V = "/v";
const doc = () => ({
  version: 1,
  extra: 1,
  spaces: [
    { space: "s1", vault: V, notes: ["a/x.md", "ab/y.md", "a.md", "z.md"], excluded: ["a/q.md", "ab.md"], agents: { p1: ["a/x.md", "ab/y.md"], p2: ["z.md"] }, keep: true },
    { space: "s2", vault: V, notes: ["a"], excluded: [], agents: {} },
    { space: "s3", vault: "/other", notes: ["a/x.md"], excluded: ["a.md"], agents: { p1: ["a/x.md"] } },
  ],
});

test("renamePaths moves a folder and what is under it in notes, excluded and agents of every entry (AC22)", () => {
  const out = renamePaths(doc(), V, "a", "b");
  assert.deepEqual(out.spaces[0].notes, ["b/x.md", "ab/y.md", "a.md", "z.md"]);
  assert.deepEqual(out.spaces[0].excluded, ["b/q.md", "ab.md"]);
  assert.deepEqual(out.spaces[0].agents, { p1: ["b/x.md", "ab/y.md"], p2: ["z.md"] });
  assert.deepEqual(out.spaces[1].notes, ["b"]);
});

test("renamePaths renames a note and keeps it linked", () => {
  const out = renamePaths(doc(), V, "a.md", "c.md");
  assert.deepEqual(out.spaces[0].notes, ["a/x.md", "ab/y.md", "c.md", "z.md"]);
});

test("renamePaths leaves other vaults, unknown keys and a similar prefix alone (AC22)", () => {
  const before = doc();
  const out = renamePaths(before, V, "a", "b");
  assert.deepEqual(out.spaces[2], before.spaces[2]);
  assert.equal(out.extra, 1);
  assert.equal(out.spaces[0].keep, true);
  assert.deepEqual(out.spaces[0].notes.includes("ab/y.md"), true);
  assert.deepEqual(before, doc());
});

test("removePaths drops the item and what is under it, not `ab` for `a` (AC53)", () => {
  const out = removePaths(doc(), V, "a");
  assert.deepEqual(out.spaces[0].notes, ["ab/y.md", "a.md", "z.md"]);
  assert.deepEqual(out.spaces[0].excluded, ["ab.md"]);
  assert.deepEqual(out.spaces[0].agents, { p1: ["ab/y.md"], p2: ["z.md"] });
  assert.deepEqual(out.spaces[1].notes, []);
});

test("removePaths drops an agent key whose list empties, and keeps other vaults and keys", () => {
  const out = removePaths(doc(), V, "z.md");
  assert.deepEqual(Object.keys(out.spaces[0].agents), ["p1"]);
  assert.deepEqual(out.spaces[2], doc().spaces[2]);
  assert.equal(out.extra, 1);
  assert.equal(out.spaces[0].keep, true);
});

test("a path change with nothing to do returns the same doc", () => {
  const d = doc();
  assert.equal(removePaths(d, V, "nothing"), d);
  assert.equal(renamePaths(d, V, "nothing", "else"), d);
  assert.equal(removePaths(d, "/none", "a"), d);
});

test("applyChange runs rename-paths and remove-paths and ignores where", () => {
  const rename = applyChange(doc(), { type: "rename-paths", vault: V, from: "a.md", to: "c.md" }, { vault: "/other", space: "x" }, []);
  assert.ok(rename.spaces[0].notes.includes("c.md"));
  assert.equal(rename.spaces.length, 3);
  const remove = applyChange(doc(), { type: "remove-paths", vault: V, path: "z.md" }, undefined, []);
  assert.ok(!remove.spaces[0].notes.includes("z.md"));
});

// Fake I/O, as in io.test.js.
const FILE = "/state/context.json";
function fakes({ text = null, writeResults = [] } = {}) {
  const files = { [FILE]: text };
  const log = [];
  return {
    files, log,
    exec: async (cmd, args) => { log.push([cmd, ...args]); return { code: 0, stdout: "", stderr: "" }; },
    readTextFile: async (path) => {
      if (files[path] === null || files[path] === undefined) throw new Error("ENOENT");
      return files[path];
    },
    writeTextFile: async (path, data, previous) => {
      log.push(["write", path, previous]);
      if (writeResults.shift() === "stale") throw new Error("stale snapshot");
      files[path] = data;
    },
  };
}
const calls = (f, name) => f.log.filter((c) => c[0] === name);
const text = JSON.stringify(doc());
const rename = { type: "rename-paths", vault: V, from: "a", to: "b" };
const remove = { type: "remove-paths", vault: V, path: "a" };

test("saveContext with a missing file makes no mkdir and no write", async () => {
  for (const change of [rename, remove]) {
    const f = fakes();
    const out = await saveContext("/state", change, {}, [], f);
    assert.deepEqual(out.spaces, []);
    assert.deepEqual(f.log, []);
  }
});

test("saveContext with no change makes no write", async () => {
  const f = fakes({ text });
  await saveContext("/state", { type: "remove-paths", vault: V, path: "nothing" }, {}, [], f);
  await saveContext("/state", { type: "rename-paths", vault: "/none", from: "a", to: "b" }, {}, [], f);
  assert.deepEqual(f.log, []);
});

test("saveContext writes a path change against what it read", async () => {
  const f = fakes({ text });
  const out = await saveContext("/state", rename, {}, [], f);
  assert.deepEqual(calls(f, "write"), [["write", FILE, text]]);
  assert.equal(calls(f, "mkdir").length, 0);
  assert.ok(out.spaces[0].notes.includes("b/x.md"));
  assert.ok(JSON.parse(f.files[FILE]).spaces[0].notes.includes("b/x.md"));
});

test("saveContext throws on an invalid file and does not rewrite or move it (AC59)", async () => {
  for (const change of [rename, remove]) {
    const f = fakes({ text: "{nope" });
    await assert.rejects(saveContext("/state", change, {}, [], f), /invalid/);
    assert.deepEqual(f.log, []);
    assert.equal(f.files[FILE], "{nope");
  }
});

test("saveContext throws on a file from a newer Herdsidian and does not touch it (AC59)", async () => {
  const newer = '{"version":2,"spaces":[]}';
  for (const change of [rename, remove]) {
    const f = fakes({ text: newer });
    await assert.rejects(saveContext("/state", change, {}, [], f), /newer Herdsidian/);
    assert.deepEqual(f.log, []);
    assert.equal(f.files[FILE], newer);
  }
});

test("saveContext retries a stale path write, as for the other changes", async () => {
  const f = fakes({ text, writeResults: ["stale"] });
  const out = await saveContext("/state", remove, {}, [], f);
  assert.equal(calls(f, "write").length, 2);
  assert.deepEqual(out.spaces[0].notes, ["ab/y.md", "a.md", "z.md"]);
});

test("saveContext throws after 3 stale path writes", async () => {
  const f = fakes({ text, writeResults: ["stale", "stale", "stale"] });
  await assert.rejects(saveContext("/state", remove, {}, [], f), /stale snapshot/);
  assert.equal(calls(f, "write").length, 3);
});

test("listNotes still gives the same find args, built from PRUNE", async () => {
  const seen = [];
  const exec = async (cmd, args) => { seen.push([cmd, ...args]); return { code: 0, stdout: "/v/a.md\n", stderr: "" }; };
  await listNotes("/v", { exec });
  assert.deepEqual(seen, [["find", "/v", "(", "-name", ".obsidian", "-o", "-name", ".git", "-o", "-name", ".trash",
    "-o", "-name", "node_modules", ")", "-prune", "-o", "-type", "f", "-iname", "*.md", "-print"]]);
  assert.deepEqual(seen[0].slice(3, 3 + PRUNE.length), PRUNE);
});
