import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// vault-io.js imports the herdr runtime, which does not exist under node: resolve it to an empty stub.
const hooks = `
export const resolve = (spec, ctx, next) => spec === "herdr"
  ? { url: "data:text/javascript,export const exec=0,readTextFile=0,writeTextFile=0", shortCircuit: true }
  : next(spec, ctx);`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);
const io = await import("../mods/herdsidian/vault-io.js");
const { PRUNE } = await import("../mods/herdsidian/io.js");

const LIMIT = 8 * 1024 * 1024 - 1024;
const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const code = (n, stderr = "") => ({ code: n, stdout: "", stderr });

// Fake deps: `reply(cmd, args)` gives the result (or throws); every call is logged.
function fakes(reply, writeTextFile) {
  const log = [];
  return {
    log,
    exec: async (cmd, args) => {
      log.push([cmd, ...args]);
      return reply(cmd, args);
    },
    writeTextFile: async (...a) => {
      log.push(["write", ...a]);
      if (writeTextFile) return writeTextFile(...a);
    },
  };
}
const rejects = () => { throw new Error("spawn failed"); };

test("listNames: parses NUL names, throws on every failure", async () => {
  const d = fakes(() => ok("/v/a.md\0/v/-x\0/v/with space\0"));
  assert.deepEqual(await io.listNames("/v", d), ["a.md", "-x", "with space"]);
  assert.deepEqual(d.log, [["find", "-H", "/v", "-mindepth", "1", "-maxdepth", "1", "-print0"]]);
  assert.deepEqual(await io.listNames("/v", fakes(() => ok(""))), []);
  await assert.rejects(io.listNames("/v", fakes(rejects)), /spawn failed/);
  await assert.rejects(io.listNames("/v", fakes(() => code(1, "no such folder"))), /no such folder/);
  await assert.rejects(io.listNames("/v", fakes(() => ok("/v/a.md"))), /Cannot list/);
  await assert.rejects(io.listNames("/v", fakes(() => ok("a".repeat(LIMIT) + "\0"))), /Cannot list/);
  const d2 = fakes(() => ok());
  await assert.rejects(io.listNames("rel", d2));
  assert.equal(d2.log.length, 0);
});

test("exists: 0 true, 1 false, anything else throws", async () => {
  const d = fakes(() => ok());
  assert.equal(await io.exists("/v/a b", d), true);
  assert.deepEqual(d.log[0].slice(0, 2), ["sh", "-c"]);
  assert.deepEqual(d.log[0].slice(3), ["herdsidian", "/v/a b"]);
  assert.equal(await io.exists("/v/a", fakes(() => code(1))), false);
  await assert.rejects(io.exists("/v/a", fakes(() => code(2, "boom"))), /boom/);
  await assert.rejects(io.exists("/v/a", fakes(rejects)), /spawn failed/);
  await assert.rejects(io.exists("a", fakes(() => ok())));
});

test("countFolder: feeds folderCounts paths that start with the folder name", async () => {
  const d = fakes(() => ok("/v/d/a.md\0/v/d/photo.png\0/v/d/.git/x\0"));
  assert.deepEqual(await io.countFolder("/v/d/", d), { total: 3, unseen: 2, link: false });
  assert.deepEqual(d.log, [["find", "/v/d", "!", "-type", "d", "-print0"]]);
  assert.deepEqual(await io.countFolder("/v/d", fakes(() => ok("/v/d\0"))), { total: 0, unseen: 0, link: true });
  assert.deepEqual(await io.countFolder("/v/d", fakes(() => ok(""))), { total: 0, unseen: 0, link: false });
});

test("countFolder: a failure, a cut list or a bad path gives null", async () => {
  assert.equal(await io.countFolder("/v/d", fakes(rejects)), null);
  assert.equal(await io.countFolder("/v/d", fakes(() => ({ code: 1, stdout: "/v/d/a.md\0", stderr: "denied" }))), null);
  assert.equal(await io.countFolder("/v/d", fakes(() => ok("/v/d/a.md"))), null);
  assert.equal(await io.countFolder("/v/d", fakes(() => ok(`/v/d/${"a".repeat(LIMIT)}\0`))), null);
  const d = fakes(() => ok());
  assert.equal(await io.countFolder("d", d), null);
  assert.equal(await io.countFolder("/", d), null);
  assert.equal(d.log.length, 0);
});

test("snapshotFiles: prunes the hidden names, strict on failure", async () => {
  const d = fakes(() => ok("/v/a.md\0/v/img/p.png\0"));
  assert.deepEqual(await io.snapshotFiles("/v/", d), ["a.md", "img/p.png"]);
  assert.deepEqual(d.log, [["find", "-H", "/v", "(", ...PRUNE, ")", "-prune", "-o", "!", "-type", "d", "-print0"]]);
  assert.deepEqual(await io.snapshotFiles("/v", fakes(() => ok(""))), []);
  assert.equal(await io.snapshotFiles("/v", fakes(rejects)), null);
  assert.equal(await io.snapshotFiles("/v", fakes(() => ({ code: 1, stdout: "/v/a.md\0", stderr: "" }))), null);
  assert.equal(await io.snapshotFiles("/v", fakes(() => ok("/v/a.md"))), null);
  assert.equal(await io.snapshotFiles("rel", fakes(() => ok())), null);
});

test("snapshotFiles: output of 8 MiB minus 1 KiB or more gives null, one byte less is read", async () => {
  const pad = (n) => `/v/${"a".repeat(n - 4)}\0`; // n characters in all
  assert.equal((await io.snapshotFiles("/v", fakes(() => ok(pad(LIMIT - 1)))))?.length, 1);
  assert.equal(await io.snapshotFiles("/v", fakes(() => ok(pad(LIMIT)))), null);
  // Two-byte characters: fewer characters than the limit, but over it in bytes.
  const wide = `/v/${"é".repeat(LIMIT / 2 - 1)}\0`;
  assert.ok(wide.length < LIMIT);
  assert.equal(await io.snapshotFiles("/v", fakes(() => ok(wide))), null);
});

test("makeFolder: mkdir with the absolute path and no -p", async () => {
  const d = fakes(() => ok());
  assert.deepEqual(await io.makeFolder("/v/-d/", d), { ok: true, reason: null });
  assert.deepEqual(d.log, [["mkdir", "/v/-d"]]);
  assert.deepEqual(await io.makeFolder("/v/d", fakes(() => code(1, "mkdir: File exists"))), { ok: false, reason: "mkdir: File exists" });
  assert.equal((await io.makeFolder("/v/d", fakes(rejects))).ok, false);
  const bad = fakes(() => ok());
  assert.equal((await io.makeFolder("d", bad)).ok, false);
  assert.equal(bad.log.length, 0);
});

test("makeNote: reads the folder, then writes once with a null previous", async () => {
  const d = fakes(() => ok("/v/Untitled.md\0/v/UNTITLED 2.md\0"));
  assert.deepEqual(await io.makeNote("/v", d), { ok: true, name: "Untitled 3.md", reason: null });
  assert.deepEqual(d.log[1], ["write", "/v/Untitled 3.md", "", null]);
  assert.equal(d.log.length, 2);
});

test("makeNote: a listing failure writes nothing; a write failure reports the reason", async () => {
  const d = fakes(() => code(1, "no such folder"));
  const r = await io.makeNote("/v/gone", d);
  assert.equal(r.ok, false);
  assert.match(r.reason, /no such folder/);
  assert.equal(d.log.some((c) => c[0] === "write"), false);
  const w = fakes(() => ok(""), () => { throw new Error("denied"); });
  assert.deepEqual(await io.makeNote("/v", w), { ok: false, name: null, reason: "denied" });
  assert.equal((await io.makeNote(undefined, fakes(() => ok()))).ok, false);
});

test("moveItem: one sh call with the paths as arguments, and a reason for each code", async () => {
  const d = fakes(() => ok());
  assert.deepEqual(await io.moveItem("/v/a b", "/v/-x", d), { ok: true, code: 0, reason: null });
  const [cmd, flag, script, name, src, dst] = d.log[0];
  assert.deepEqual([cmd, flag, name, src, dst], ["sh", "-c", "herdsidian", "/v/a b", "/v/-x"]);
  assert.match(script, /\/bin\/mv -n "\$1" "\$2" \|\| exit 1/);
  assert.equal(d.log.length, 1);
  for (const [n, re] of [[3, /no longer exists/], [4, /already exists/], [5, /could not be confirmed/]]) {
    const r = await io.moveItem("/v/a", "/v/b", fakes(() => code(n)));
    assert.equal(r.ok, false);
    assert.equal(r.code, n);
    assert.match(r.reason, re);
  }
  const fail = await io.moveItem("/v/a", "/v/b", fakes(() => code(1, "mv: Permission denied")));
  assert.deepEqual([fail.ok, fail.code, fail.reason], [false, 1, "mv: Permission denied"]);
  assert.equal((await io.moveItem("/v/a", "/v/b", fakes(rejects))).ok, false);
});

test("moveItem: a relative or equal path runs nothing", async () => {
  const d = fakes(() => ok());
  for (const [a, b] of [["a", "/v/b"], ["/v/a", "b"], ["/v/a", "/v/a"]]) assert.equal((await io.moveItem(a, b, d)).ok, false);
  assert.equal(d.log.length, 0);
});

// A fake folder for moveSameItem: `lists` are the successive listNames answers.
const listing = (...lists) => {
  const rest = [...lists];
  return (cmd) => (cmd === "find" ? ok(rest.shift().map((n) => `/v/${n}\0`).join("")) : ok());
};

test("moveSameItem: plain /bin/mv after the checks, then the exact name must show", async () => {
  const d = fakes(listing(["foo.md", "x"], ["Foo.md", "x"]));
  assert.deepEqual(await io.moveSameItem("/v/foo.md", "/v/Foo.md", d), { ok: true, code: 0, reason: null });
  assert.deepEqual(d.log.filter((c) => c[0] === "/bin/mv"), [["/bin/mv", "/v/foo.md", "/v/Foo.md"]]);
});

test("moveSameItem: refuses when it is not the same item, when src is gone, when the exact name exists", async () => {
  const other = fakes(listing());
  assert.equal((await io.moveSameItem("/v/a.md", "/v/b.md", other)).ok, false);
  assert.equal((await io.moveSameItem("/v/a/foo.md", "/v/b/Foo.md", other)).ok, false);
  assert.equal((await io.moveSameItem("foo.md", "Foo.md", other)).ok, false);
  assert.equal(other.log.length, 0);
  const gone = fakes(listing(["x"]));
  assert.equal((await io.moveSameItem("/v/foo.md", "/v/Foo.md", gone)).code, 3);
  assert.equal(gone.log.some((c) => c[0] === "/bin/mv"), false);
  // A case-sensitive disk with both names: plain mv would overwrite Foo.md.
  const both = fakes(listing(["foo.md", "Foo.md"]));
  assert.equal((await io.moveSameItem("/v/foo.md", "/v/Foo.md", both)).code, 4);
  assert.equal(both.log.some((c) => c[0] === "/bin/mv"), false);
});

test("moveSameItem: an mv failure, an unchanged name and a rejecting exec are failures", async () => {
  const mvFails = fakes((cmd) => (cmd === "/bin/mv" ? code(1, "mv: denied") : listing(["foo.md"])(cmd)));
  assert.deepEqual(await io.moveSameItem("/v/foo.md", "/v/Foo.md", mvFails), { ok: false, code: 1, reason: "mv: denied" });
  const same = fakes(listing(["foo.md"], ["foo.md"]));
  assert.equal((await io.moveSameItem("/v/foo.md", "/v/Foo.md", same)).code, 5);
  assert.equal((await io.moveSameItem("/v/foo.md", "/v/Foo.md", fakes(rejects))).ok, false);
});

// Fake exists + trash: `present` answers the successive exists calls.
const trashing = (present, trash) => {
  const rest = [...present];
  return (cmd) => (cmd === "sh" ? code(rest.shift() ? 0 : 1) : trash);
};

test("trashItem: exists, then trash -s with the absolute path, then exists again", async () => {
  const d = fakes(trashing([true, false], ok()));
  assert.deepEqual(await io.trashItem("/v/-x.md/", d), { ok: true, reason: null });
  assert.deepEqual(d.log.filter((c) => c[0] !== "sh"), [["/usr/bin/trash", "-s", "/v/-x.md"]]);
  assert.equal(d.log.length, 3);
});

test("trashItem: a failed exec, a non-zero exit, exit 0 with the item still there, a missing item, an exists failure", async () => {
  const stuck = await io.trashItem("/v/a.md", fakes(trashing([true, true], ok())));
  assert.equal(stuck.ok, false);
  assert.match(stuck.reason, /still there/);
  const failed = await io.trashItem("/v/a.md", fakes(trashing([true], code(5, "trash: bad"))));
  assert.deepEqual(failed, { ok: false, reason: "trash: bad" });
  const thrown = await io.trashItem("/v/a.md", fakes((cmd) => (cmd === "sh" ? ok() : rejects())));
  assert.deepEqual(thrown, { ok: false, reason: "spawn failed" });
  const missing = fakes(trashing([false], ok()));
  assert.match((await io.trashItem("/v/a.md", missing)).reason, /no longer exists/);
  assert.equal(missing.log.some((c) => c[0] === "/usr/bin/trash"), false);
  const unknown = fakes((cmd) => (cmd === "sh" ? code(2, "cannot tell") : ok()));
  assert.equal((await io.trashItem("/v/a.md", unknown)).ok, false);
  assert.equal(unknown.log.some((c) => c[0] === "/usr/bin/trash"), false);
});

test("trashItem: a relative path or the root runs nothing", async () => {
  const d = fakes(() => ok());
  for (const p of ["a.md", "/", "", undefined]) assert.equal((await io.trashItem(p, d)).ok, false);
  assert.equal(d.log.length, 0);
});
