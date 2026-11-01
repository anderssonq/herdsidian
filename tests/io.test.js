import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// io.js imports the herdr runtime, which does not exist under node: resolve it to an empty stub.
const hooks = `
export const resolve = (spec, ctx, next) => spec === "herdr"
  ? { url: "data:text/javascript,export const exec=0,readTextFile=0,writeTextFile=0", shortCircuit: true }
  : next(spec, ctx);`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);
const { saveContext } = await import("../mods/herdsidian/io.js");

const where = { space: "s1", name: "work", folder: "/r/work", vault: "/v" };
const link = { type: "link", note: "a.md" };
const FILE = "/state/context.json";
const good = '{"version":1,"spaces":[]}';

// Fake I/O: `files` is the disk, `log` records every call, `writes` is a queue of write outcomes.
function fakes({ text = null, writeResults = [], mvCode = 0 } = {}) {
  const files = { [FILE]: text };
  const log = [];
  return {
    files, log,
    exec: async (cmd, args) => {
      log.push([cmd, ...args]);
      if (cmd === "mv" && mvCode === 0) files[FILE] = null;
      return { code: cmd === "mv" ? mvCode : 0, stdout: "", stderr: cmd === "mv" && mvCode ? "no such file" : "" };
    },
    readTextFile: async (path) => {
      if (files[path] === null || files[path] === undefined) throw new Error("ENOENT");
      return files[path];
    },
    writeTextFile: async (path, data, previous) => {
      log.push(["write", path, previous]);
      const next = writeResults.shift();
      if (next === "stale") throw new Error("stale snapshot");
      files[path] = data;
    },
  };
}
const calls = (f, name) => f.log.filter((c) => c[0] === name);

test("saveContext creates the folder with mkdir -p on the first write", async () => {
  const f = fakes();
  const doc = await saveContext("/state", link, where, ["s1"], f);
  assert.deepEqual(calls(f, "mkdir"), [["mkdir", "-p", "/state"]]);
  assert.deepEqual(calls(f, "write"), [["write", FILE, null]]);
  assert.deepEqual(doc.spaces[0].notes, ["a.md"]);
});

test("saveContext does not mkdir when the file exists and writes against what it read", async () => {
  const f = fakes({ text: good });
  await saveContext("/state", link, where, ["s1"], f);
  assert.equal(calls(f, "mkdir").length, 0);
  assert.deepEqual(calls(f, "write"), [["write", FILE, good]]);
});

test("saveContext starts over on a stale snapshot", async () => {
  const f = fakes({ text: good, writeResults: ["stale"] });
  const doc = await saveContext("/state", link, where, ["s1"], f);
  assert.equal(calls(f, "write").length, 2);
  assert.deepEqual(doc.spaces[0].notes, ["a.md"]);
});

test("saveContext throws after 3 stale tries", async () => {
  const f = fakes({ text: good, writeResults: ["stale", "stale", "stale", "stale"] });
  await assert.rejects(saveContext("/state", link, where, ["s1"], f), /Cannot save the agent context: stale snapshot/);
  assert.equal(calls(f, "write").length, 3);
});

test("saveContext moves an invalid file aside on a link and writes a fresh one", async () => {
  const f = fakes({ text: "{nope" });
  const doc = await saveContext("/state", link, where, ["s1"], f);
  const [mv] = calls(f, "mv");
  assert.equal(mv[1], FILE);
  assert.match(mv[2], /^\/state\/context\.json\.invalid-\d+$/);
  assert.deepEqual(calls(f, "write"), [["write", FILE, null]]);
  assert.deepEqual(doc.spaces[0].notes, ["a.md"]);
});

test("saveContext leaves an invalid file alone on unlink, scope and exclude (AC31)", async () => {
  for (const type of ["unlink", "scope", "exclude"]) {
    const f = fakes({ text: "{nope" });
    await assert.rejects(saveContext("/state", { type, note: "a.md" }, where, ["s1"], f), /invalid/, type);
    assert.deepEqual(f.log, [], type);
    assert.equal(f.files[FILE], "{nope", type);
  }
});

test("saveContext continues when another window already moved the invalid file", async () => {
  const f = fakes({ text: "{nope", mvCode: 1 });
  // The other window moved it and wrote a good file between our read and our mv.
  const read = f.readTextFile;
  let reads = 0;
  f.readTextFile = async (path) => {
    reads++;
    if (reads === 2) f.files[FILE] = good;
    return read(path);
  };
  const doc = await saveContext("/state", link, where, ["s1"], f);
  assert.deepEqual(doc.spaces[0].notes, ["a.md"]);
  assert.deepEqual(calls(f, "write"), [["write", FILE, good]]);
});

test("saveContext throws when the mv fails and the file is still invalid", async () => {
  const f = fakes({ text: "{nope", mvCode: 1 });
  await assert.rejects(saveContext("/state", link, where, ["s1"], f), /Cannot save the agent context: no such file/);
  assert.equal(calls(f, "write").length, 0);
});

test("saveContext refuses a file from a newer Herdsidian for every change and writes nothing", async () => {
  const text = '{"version":2,"spaces":[]}';
  for (const type of ["link", "unlink", "scope", "exclude"]) {
    const f = fakes({ text });
    await assert.rejects(saveContext("/state", { type, note: "a.md" }, where, ["s1"], f), /newer Herdsidian/, type);
    assert.deepEqual(f.log, [], type);
    assert.equal(f.files[FILE], text, type);
  }
});

const { allNotes, noteTime, MAX_NOTES } = await import("../mods/herdsidian/io.js");

test("allNotes builds the find args, prunes HIDDEN, makes paths relative and sorts", async () => {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return { code: 0, stdout: "/v/b.md\n/v/sub/a.MD\n\n/v/a.md\n", stderr: "" };
  };
  const notes = await allNotes("/v", { exec });
  assert.deepEqual(notes, ["a.md", "b.md", "sub/a.MD"]);
  assert.deepEqual(calls, [["find", "/v", "(", "-name", ".obsidian", "-o", "-name", ".git", "-o", "-name", ".trash",
    "-o", "-name", "node_modules", ")", "-prune", "-o", "-type", "f", "-iname", "*.md", "-print"]]);
});

test("allNotes caps the list at 5,000", async () => {
  const lines = Array.from({ length: MAX_NOTES + 20 }, (_, i) => `/v/n${String(i).padStart(5, "0")}.md`);
  const notes = await allNotes("/v", { exec: async () => ({ code: 0, stdout: lines.join("\n"), stderr: "" }) });
  assert.equal(MAX_NOTES, 5000);
  assert.equal(notes.length, 5000);
  assert.equal(notes[0], "n00000.md");
});

test("allNotes throws when the vault cannot be listed", async () => {
  const exec = async () => ({ code: 1, stdout: "", stderr: "find: /gone: No such file or directory" });
  await assert.rejects(allNotes("/gone", { exec }), /No such file or directory/);
  await assert.rejects(allNotes("/gone", { exec: async () => ({ code: 1, stdout: "\n", stderr: "" }) }), /Cannot list the vault/);
});

test("allNotes keeps the list when find exits non-zero but still printed notes", async () => {
  const exec = async () => ({ code: 1, stdout: "/v/b.md\n/v/a.md\n", stderr: "find: /v/locked: Permission denied" });
  assert.deepEqual(await allNotes("/v", { exec }), ["a.md", "b.md"]);
});

test("noteTime gives milliseconds on success", async () => {
  const calls = [];
  const exec = async (cmd, args) => { calls.push([cmd, ...args]); return { code: 0, stdout: "1700000000\n", stderr: "" }; };
  assert.equal(await noteTime("/v/a.md", { exec }), 1700000000000);
  assert.deepEqual(calls, [["stat", "-f", "%m", "/v/a.md"]]);
});

test("noteTime gives null on a non-zero code, bad output or a throw", async () => {
  assert.equal(await noteTime("/v/a.md", { exec: async () => ({ code: 1, stdout: "", stderr: "no" }) }), null);
  assert.equal(await noteTime("/v/a.md", { exec: async () => ({ code: 0, stdout: "", stderr: "" }) }), null);
  assert.equal(await noteTime("/v/a.md", { exec: async () => ({ code: 0, stdout: "x", stderr: "" }) }), null);
  assert.equal(await noteTime("/v/a.md", { exec: async () => { throw new Error("boom"); } }), null);
});
