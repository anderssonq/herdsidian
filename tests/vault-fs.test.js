import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_TRASH, realHost } from "./support/real-host.js";

// vault-io.js imports the herdr runtime, which does not exist under node: resolve it to an empty stub.
const hooks = `
export const resolve = (spec, ctx, next) => spec === "herdr"
  ? { url: "data:text/javascript,export const exec=0,readTextFile=0,writeTextFile=0", shortCircuit: true }
  : next(spec, ctx);`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);
const io = await import("../mods/herdsidian/vault-io.js");
const { takenName } = await import("../mods/herdsidian/actions.js");

const roots = [];
// A fresh folder under the temp folder; the test never touches any other path.
function temp() {
  const root = mkdtempSync(join(tmpdir(), "herdsidian-fs-"));
  roots.push(root);
  return root;
}
test.after(() => {
  for (const r of roots) {
    try { chmodSync(r, 0o755); } catch { /* already gone */ }
    rmSync(r, { recursive: true, force: true });
  }
});

const put = (root, rel, text = "") => {
  const path = join(root, rel);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  return path;
};

// Every entry under dir with its content, to prove that nothing else changed.
function tree(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap((e) => {
    const p = join(dir, e.name), rel = p.slice(base.length + 1);
    if (e.isSymbolicLink()) return [`${rel} -> link`];
    return e.isDirectory() ? [`${rel}/`, ...tree(p, base)] : [`${rel}: ${readFileSync(p, "utf8")}`];
  });
}

const cantLock = process.getuid?.() === 0;

// real-host safety

test("real-host: the root must be a clean path under the temp folder", () => {
  assert.throws(() => realHost({ root: "/" }), /not under the temp folder/);
  assert.throws(() => realHost({ root: tmpdir() }), /not under the temp folder/);
  assert.throws(() => realHost({ root: `${tmpdir()}/../outside` }), /clean absolute path/);
  assert.throws(() => realHost({ root: "relative" }), /clean absolute path/);
  assert.throws(() => realHost({}), /clean absolute path/);
  // A link in the temp folder that leads out of it is refused too (the target is only resolved, never changed).
  const holder = temp();
  symlinkSync("/usr", join(holder, "link"));
  assert.throws(() => realHost({ root: join(holder, "link") }), /leads outside the temp folder/);
});

test("real-host: a trash call for a path outside root throws and the file stays", async () => {
  const root = temp();
  const other = temp();
  const file = put(other, "keep.md", "x");
  const host = realHost({ root });
  await assert.rejects(host.exec("/usr/bin/trash", ["-s", file]), /outside the test root/);
  await assert.rejects(host.exec("/usr/bin/trash", ["-s", root]), /outside the test root/);
  await assert.rejects(host.exec("/usr/bin/trash", ["-s", `${root}/../x`]), /clean absolute path/);
  assert.equal(readFileSync(file, "utf8"), "x");
  assert.deepEqual(host.calls, []);
  assert.deepEqual((await io.trashItem(file, host)).ok, false);
  assert.equal(existsSync(file), true);
});

test("real-host: trash takes exactly [-s, abs]", async () => {
  const root = temp();
  const file = put(root, "a.md", "x");
  const host = realHost({ root });
  for (const args of [["--", file], [file], ["-s", file, file], ["-f", file], ["-s", "a.md"], []]) {
    await assert.rejects(host.exec("/usr/bin/trash", args));
  }
  assert.equal(existsSync(file), true);
  assert.deepEqual(host.calls, []);
});

test("real-host: a link inside root cannot lead the trash outside", async () => {
  const root = temp();
  const other = temp();
  const file = put(other, "keep.md", "x");
  symlinkSync(other, join(root, "out"));
  const host = realHost({ root });
  await assert.rejects(host.exec("/usr/bin/trash", ["-s", join(root, "out", "keep.md")]), /leads outside/);
  assert.equal(existsSync(file), true);
});

test("real-host: trash by bare name or through a shell reaches the fake or throws", async () => {
  const root = temp();
  const file = put(root, "a.md", "x");
  const host = realHost({ root });
  await assert.rejects(host.exec("sh", ["-c", `trash -s ${file}`]), /may not call trash/);
  assert.equal(existsSync(file), true);
  assert.equal((await host.exec("trash", ["-s", file])).code, 0);
  assert.equal(existsSync(file), false);
  assert.equal(readdirSync(join(root, FAKE_TRASH)).length, 1);
});

test("real-host: the real Trash is refused without the opt-in", { skip: process.env.HERDSIDIAN_REAL_TRASH === "1" && process.platform === "darwin" }, () => {
  assert.throws(() => realHost({ root: temp(), realTrash: true }), /HERDSIDIAN_REAL_TRASH=1 on darwin/);
});

test("real-host: readTextFile rejects over 1 MiB and invalid UTF-8; writeTextFile is a compare-and-swap", async () => {
  const root = temp();
  const host = realHost({ root });
  assert.equal(await host.readTextFile(put(root, "ok.md", "hé")), "hé");
  await assert.rejects(host.readTextFile(put(root, "big.md", "a".repeat(1024 * 1024 + 1))), /exceeds 1 MiB/);
  assert.equal((await host.readTextFile(put(root, "edge.md", "a".repeat(1024 * 1024)))).length, 1024 * 1024);
  writeFileSync(join(root, "bad.md"), Buffer.from([0xff, 0xfe, 0x41]));
  await assert.rejects(host.readTextFile(join(root, "bad.md")), /valid UTF-8/);
  const path = join(root, "n.md");
  await host.writeTextFile(path, "one", null);
  await assert.rejects(host.writeTextFile(path, "two", null));
  await assert.rejects(host.writeTextFile(path, "two", "stale"));
  assert.equal(readFileSync(path, "utf8"), "one");
  await host.writeTextFile(path, "two", "one");
  assert.equal(readFileSync(path, "utf8"), "two");
  await assert.rejects(host.writeTextFile(join(root, "missing.md"), "x", "old"));
  assert.equal(existsSync(join(root, "missing.md")), false);
  await assert.rejects(host.writeTextFile(join(root, "no", "dir.md"), "x", null));
  assert.equal(existsSync(join(root, "no")), false);
});

test("real-host: readTextFile resolves null for a missing file, as Herdr does", async () => {
  const root = temp();
  const host = realHost({ root });
  assert.equal(await host.readTextFile(join(root, "missing.md")), null);
  assert.equal(await host.readTextFile(join(root, "no", "dir.md")), null);
});

// moveItem

test("moveItem: moves a note and a folder with hidden content (AC17)", async () => {
  const root = temp();
  const host = realHost({ root });
  put(root, "a.md", "note");
  put(root, "docs/b.md", "b");
  put(root, "docs/.obsidian/app.json", "{}");
  put(root, "docs/photo.png", "png");
  mkdirSync(join(root, "docs", "empty"));
  assert.deepEqual(await io.moveItem(join(root, "a.md"), join(root, "A new.md"), host), { ok: true, code: 0, reason: null });
  assert.deepEqual(await io.moveItem(join(root, "docs"), join(root, "guides"), host), { ok: true, code: 0, reason: null });
  assert.deepEqual(tree(root), [
    "A new.md: note",
    "guides/", "guides/.obsidian/", "guides/.obsidian/app.json: {}", "guides/b.md: b", "guides/empty/", "guides/photo.png: png",
  ]);
});

test("moveItem: a taken target gives code 4 and nothing is overwritten (AC18, AC61)", async () => {
  const root = temp();
  const host = realHost({ root });
  put(root, "a.md", "A");
  put(root, "b.md", "B");
  const before = tree(root);
  const r = await io.moveItem(join(root, "a.md"), join(root, "b.md"), host);
  assert.equal(r.ok, false);
  assert.equal(r.code, 4);
  assert.deepEqual(tree(root), before);
});

test("moveItem: a folder target is never entered (AC18, AC61)", async () => {
  const root = temp();
  const host = realHost({ root });
  put(root, "a.md", "A");
  put(root, "g/x.md", "X");
  put(root, "f/y.md", "Y");
  const before = tree(root);
  assert.equal((await io.moveItem(join(root, "a.md"), join(root, "g"), host)).code, 4);
  assert.equal((await io.moveItem(join(root, "f"), join(root, "g"), host)).code, 4);
  assert.deepEqual(tree(root), before);
});

test("moveItem: a taken broken link counts as taken", async () => {
  const root = temp();
  put(root, "a.md", "A");
  symlinkSync(join(root, "nowhere"), join(root, "b.md"));
  const r = await io.moveItem(join(root, "a.md"), join(root, "b.md"), realHost({ root }));
  assert.equal(r.code, 4);
  assert.equal(readFileSync(join(root, "a.md"), "utf8"), "A");
});

test("moveItem: a missing source gives code 3 and creates nothing (AC60)", async () => {
  const root = temp();
  const host = realHost({ root });
  put(root, "keep.md", "K");
  const before = tree(root);
  const r = await io.moveItem(join(root, "gone.md"), join(root, "new.md"), host);
  assert.equal(r.code, 3);
  assert.equal(r.ok, false);
  assert.equal((await io.moveItem(join(root, "gone.md"), join(root, "no", "deep", "new.md"), host)).code, 3);
  assert.deepEqual(tree(root), before);
});

test("moveItem: a missing target folder fails and creates nothing (AC60)", async () => {
  const root = temp();
  put(root, "a.md", "A");
  const before = tree(root);
  const r = await io.moveItem(join(root, "a.md"), join(root, "no", "a.md"), realHost({ root }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 1);
  assert.deepEqual(tree(root), before);
});

test("moveItem: Unicode form counts as taken (AC18)", async () => {
  const root = temp();
  const host = realHost({ root });
  const nfc = "café.md", nfd = "café.md";
  put(root, nfc, "A");
  put(root, "b.md", "B");
  // The check is the disk's own: only a disk that matches forms (APFS) can say "taken" here.
  if (existsSync(join(root, nfd))) {
    assert.equal((await io.moveItem(join(root, "b.md"), join(root, nfd), host)).code, 4);
    assert.equal(readFileSync(join(root, "b.md"), "utf8"), "B");
  }
  assert.equal(takenName(await io.listNames(root, host), nfd), true, "takenName sees it on any disk");
  assert.equal(takenName(await io.listNames(root, host), "CAFÉ.MD"), true);
});

// moveSameItem

test("moveSameItem: foo.md to Foo.md and docs to Docs keep their content (AC19)", async () => {
  const root = temp();
  const host = realHost({ root });
  put(root, "foo.md", "note");
  put(root, "docs/.hidden/x.md", "x");
  assert.deepEqual(await io.moveSameItem(join(root, "foo.md"), join(root, "Foo.md"), host), { ok: true, code: 0, reason: null });
  assert.deepEqual(await io.moveSameItem(join(root, "docs"), join(root, "Docs"), host), { ok: true, code: 0, reason: null });
  assert.deepEqual((await io.listNames(root, host)).sort(), ["Docs", "Foo.md"]);
  assert.deepEqual(tree(root), ["Docs/", "Docs/.hidden/", "Docs/.hidden/x.md: x", "Foo.md: note"]);
});

test("moveSameItem: refuses another item, another folder and a missing source", async () => {
  const root = temp();
  const host = realHost({ root });
  put(root, "a.md", "A");
  put(root, "b.md", "B");
  mkdirSync(join(root, "sub"));
  const before = tree(root);
  assert.equal((await io.moveSameItem(join(root, "a.md"), join(root, "b.md"), host)).ok, false);
  assert.equal((await io.moveSameItem(join(root, "a.md"), join(root, "sub", "A.md"), host)).ok, false);
  assert.equal((await io.moveSameItem(join(root, "gone.md"), join(root, "Gone.md"), host)).code, 3);
  assert.deepEqual(tree(root), before);
});

// listNames and takenName

test("listNames and takenName see photo.png, hidden entries and links (AC18)", async () => {
  const root = temp();
  const host = realHost({ root });
  put(root, "photo.png", "p");
  put(root, "a.md");
  put(root, ".hidden");
  symlinkSync(join(root, "nowhere"), join(root, "broken"));
  mkdirSync(join(root, "Dir"));
  const names = await io.listNames(root, host);
  assert.deepEqual(names.sort(), [".hidden", "Dir", "a.md", "broken", "photo.png"]);
  assert.equal(takenName(names, "Photo.PNG"), true);
  assert.equal(takenName(names, "dir"), true);
  assert.equal(takenName(names, "free.md"), false);
  await assert.rejects(io.listNames(join(root, "missing"), host));
});

// makeNote and makeFolder

test("makeNote: Untitled, then Untitled 2, ignoring case; the note is empty (AC9, AC10)", async () => {
  const root = temp();
  const host = realHost({ root });
  assert.deepEqual(await io.makeNote(root, host), { ok: true, name: "Untitled.md", reason: null });
  assert.equal((await io.makeNote(root, host)).name, "Untitled 2.md");
  rmSync(join(root, "Untitled 2.md"));
  rmSync(join(root, "Untitled.md"));
  put(root, "UNTITLED.MD");
  assert.equal((await io.makeNote(root, host)).name, "Untitled 2.md");
  assert.equal(readFileSync(join(root, "Untitled 2.md"), "utf8"), "");
  // Another folder's Untitled.md does not count (AC10).
  mkdirSync(join(root, "sub"));
  assert.equal((await io.makeNote(join(root, "sub"), host)).name, "Untitled.md");
});

test("makeNote: a missing parent creates nothing (AC60)", async () => {
  const root = temp();
  const host = realHost({ root });
  put(root, "keep.md", "K");
  const before = tree(root);
  const r = await io.makeNote(join(root, "gone", "deeper"), host);
  assert.equal(r.ok, false);
  assert.equal(r.name, null);
  assert.deepEqual(tree(root), before);
});

test("makeFolder: no -p, and an existing name fails (AC12, AC60)", async () => {
  const root = temp();
  const host = realHost({ root });
  assert.deepEqual(await io.makeFolder(join(root, "new"), host), { ok: true, reason: null });
  assert.equal(lstatSync(join(root, "new")).isDirectory(), true);
  put(root, "taken.md", "T");
  mkdirSync(join(root, "dir"));
  const before = tree(root);
  for (const name of ["taken.md", "dir", "new"]) {
    const r = await io.makeFolder(join(root, name), host);
    assert.equal(r.ok, false);
    assert.match(r.reason, /exists/i);
  }
  const deep = await io.makeFolder(join(root, "a", "b"), host);
  assert.equal(deep.ok, false);
  assert.equal(existsSync(join(root, "a")), false);
  assert.deepEqual(tree(root), before);
});

// trashItem

test("trashItem with the fake: exact args, a note and a whole folder (AC49)", async () => {
  const root = temp();
  const host = realHost({ root });
  const note = put(root, "a.md", "A");
  put(root, "docs/b.md", "B");
  put(root, "docs/.obsidian/app.json", "{}");
  const docs = join(root, "docs");
  assert.deepEqual(await io.trashItem(note, host), { ok: true, reason: null });
  assert.deepEqual(await io.trashItem(docs, host), { ok: true, reason: null });
  assert.deepEqual(host.calls, [["trash", "-s", note], ["trash", "-s", docs]]);
  assert.deepEqual(tree(root), [
    `${FAKE_TRASH}/`, `${FAKE_TRASH}/0-a.md: A`, `${FAKE_TRASH}/1-docs/`, `${FAKE_TRASH}/1-docs/.obsidian/`,
    `${FAKE_TRASH}/1-docs/.obsidian/app.json: {}`, `${FAKE_TRASH}/1-docs/b.md: B`,
  ]);
});

test("trashItem: a link goes alone, never its target", async () => {
  const root = temp();
  const host = realHost({ root });
  put(root, "real/x.md", "X");
  symlinkSync(join(root, "real"), join(root, "link"));
  assert.equal((await io.trashItem(join(root, "link"), host)).ok, true);
  assert.equal(readFileSync(join(root, "real", "x.md"), "utf8"), "X");
  assert.equal(existsSync(join(root, "link")), false);
});

test("trashItem: fail, exit 0 with the item still there, and missing give ok:false and the item stays (AC50)", async () => {
  for (const [mode, re] of [["fail", /trash: failed/], ["stuck", /still there/], ["missing", /no such file/]]) {
    const root = temp();
    const host = realHost({ root, trash: mode });
    const file = put(root, "a.md", "A");
    const r = await io.trashItem(file, host);
    assert.equal(r.ok, false, mode);
    assert.match(r.reason, re);
    assert.equal(readFileSync(file, "utf8"), "A");
    assert.equal(existsSync(join(root, FAKE_TRASH)), false);
  }
});

test("trashItem: an item that is already gone is ok:false and trash is not called (AC50)", async () => {
  const root = temp();
  const host = realHost({ root });
  const r = await io.trashItem(join(root, "gone.md"), host);
  assert.equal(r.ok, false);
  assert.match(r.reason, /no longer exists/);
  assert.deepEqual(host.calls, []);
});

// The one test that may reach the real Trash: opt-in, darwin, one temp file.
test("trashItem with the real Trash: one temp file (AC49)", { skip: !(process.env.HERDSIDIAN_REAL_TRASH === "1" && process.platform === "darwin") }, async () => {
  const root = temp();
  const file = put(root, `herdsidian-test-${Math.random().toString(36).slice(2)}.txt`, "trash me");
  const host = realHost({ root, realTrash: true });
  assert.deepEqual(await io.trashItem(file, host), { ok: true, reason: null });
  assert.equal(existsSync(file), false);
  assert.deepEqual(host.calls, [["real-trash", "-s", file]]);
  await assert.rejects(host.exec("/usr/bin/trash", ["-s", put(root, "other.txt")]), /herdsidian-test-/);
});

// AC64: names

const NAMES = ["-x.md", "--help", 'say "hi" \'there\'.md', "$(touch x)", "*", "with space.md", "back\\slash"];

test("odd names: create, move, folder and trash use the exact name and change nothing else (AC64)", async () => {
  const root = temp();
  const host = realHost({ root });
  put(root, "bystander.md", "B");
  put(root, "x", "keep");
  const sub = join(root, "work");
  mkdirSync(sub);
  for (const name of NAMES) {
    const dir = join(sub, `d${NAMES.indexOf(name)}`);
    mkdirSync(dir);
    put(dir, "plain.md", "A");
    assert.equal((await io.moveItem(join(dir, "plain.md"), join(dir, name), host)).ok, true, name);
    assert.deepEqual(await io.listNames(dir, host), [name]);
    assert.equal(readFileSync(join(dir, name), "utf8"), "A");
    assert.equal((await io.trashItem(join(dir, name), host)).ok, true, name);
    assert.deepEqual(await io.listNames(dir, host), []);
    assert.deepEqual(await io.makeFolder(join(dir, name), host), { ok: true, reason: null });
    assert.deepEqual(await io.listNames(dir, host), [name]);
    assert.equal(lstatSync(join(dir, name)).isDirectory(), true);
    assert.equal((await io.moveItem(join(dir, name), join(dir, `${name}-2`), host)).ok, true, name);
    assert.deepEqual(await io.listNames(dir, host), [`${name}-2`]);
  }
  assert.equal(readFileSync(join(root, "x"), "utf8"), "keep");
  assert.equal(readFileSync(join(root, "bystander.md"), "utf8"), "B");
  assert.deepEqual(readdirSync(root).sort(), [FAKE_TRASH, "bystander.md", "work", "x"]);
  assert.equal(existsSync(join(process.cwd(), "x")), false);
  assert.equal(readdirSync(join(root, FAKE_TRASH)).length, NAMES.length);
});

// snapshotFiles and countFolder

test("snapshotFiles: skips the hidden folders, finds photo.png, drops directories (AC41)", async () => {
  const root = temp();
  const host = realHost({ root });
  for (const rel of ["a.md", "photo.png", "sub/b.md", ".obsidian/x.json", ".git/y", "node_modules/z", ".trash/t", "sub/.git/q", "sub/deep/c.md"]) put(root, rel);
  mkdirSync(join(root, "emptydir"));
  assert.deepEqual((await io.snapshotFiles(root, host)).sort(), ["a.md", "photo.png", "sub/b.md", "sub/deep/c.md"]);
  assert.equal((await io.snapshotFiles(`${root}/`, host)).length, 4);
});

test("snapshotFiles: a failing find gives null (AC46)", async () => {
  const root = temp();
  const host = realHost({ root });
  assert.equal(await io.snapshotFiles(join(root, "missing"), host), null);
  assert.equal(await io.snapshotFiles("relative", host), null);
});

test("countFolder: total, unseen, empty, a link, and a failure (AC48)", async () => {
  const root = temp();
  const host = realHost({ root });
  for (const rel of ["d/a.md", "d/B.MD", "d/photo.png", "d/.obsidian/c.json", "d/sub/e.md", "d/.git/h.md"]) put(root, rel);
  mkdirSync(join(root, "d", "emptysub"));
  mkdirSync(join(root, "empty"));
  assert.deepEqual(await io.countFolder(join(root, "d"), host), { total: 6, unseen: 3, link: false });
  assert.deepEqual(await io.countFolder(join(root, "empty"), host), { total: 0, unseen: 0, link: false });
  symlinkSync(join(root, "d"), join(root, "link"));
  assert.deepEqual(await io.countFolder(join(root, "link"), host), { total: 0, unseen: 0, link: true });
  assert.equal(await io.countFolder(join(root, "missing"), host), null);
});

// Permission failures (AC58)

test("a permission failure gives ok:false with the reason and changes nothing (AC58)", { skip: cantLock && "running as root" }, async () => {
  const root = temp();
  const host = realHost({ root });
  put(root, "a.md", "A");
  put(root, "locked/in.md", "I");
  const locked = join(root, "locked");
  chmodSync(locked, 0o555);
  try {
    const moved = await io.moveItem(join(root, "a.md"), join(locked, "a.md"), host);
    assert.equal(moved.ok, false);
    assert.match(moved.reason, /denied|permitted/i);
    assert.equal((await io.makeFolder(join(locked, "new"), host)).ok, false);
    assert.match((await io.makeFolder(join(locked, "new"), host)).reason, /denied|permitted/i);
    const note = await io.makeNote(locked, host);
    assert.equal(note.ok, false);
    assert.ok(note.reason);
    const trashed = await io.trashItem(join(locked, "in.md"), host);
    assert.equal(trashed.ok, false);
    assert.ok(trashed.reason);
    assert.deepEqual(readdirSync(locked), ["in.md"]);
    assert.equal(readFileSync(join(root, "a.md"), "utf8"), "A");
  } finally {
    chmodSync(locked, 0o755);
  }
});

test("an unreadable subfolder makes snapshotFiles and countFolder give null", { skip: cantLock && "running as root" }, async () => {
  const root = temp();
  const host = realHost({ root });
  put(root, "d/a.md");
  put(root, "d/closed/b.md");
  const closed = join(root, "d", "closed");
  chmodSync(closed, 0o000);
  try {
    assert.equal(await io.snapshotFiles(root, host), null);
    assert.equal(await io.countFolder(join(root, "d"), host), null);
  } finally {
    chmodSync(closed, 0o755);
  }
});

test("temp roots resolve under the temp folder", () => {
  const root = temp();
  assert.ok(realpathSync(root).startsWith(realpathSync(tmpdir())));
});
