// The whole Notes view on a temp vault, through real-host: real mv, find and sh, and a fake trash that refuses
// anything outside the temp root. What counts here is the exact bytes on disk after each action.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { state, fakeCx, findById, settle } from "./support/mod-stubs.js";
import { during } from "./support/live-cx.js";
import { realHost, FAKE_TRASH } from "./support/real-host.js";

const { default: Notes } = await import("../mods/herdsidian/main.js");
const { ACTION_KEY } = await import("../mods/herdsidian/actions.js");

const isRoot = process.getuid?.() === 0;
const stateHome = process.env.XDG_STATE_HOME;
let root, vault, host, writes, locked;

// Waits for something real-host does on the real disk. A view that never gets there fails the test.
async function until(done, what) {
  for (let i = 0; i < 250; i++) {
    if (done()) return;
    await settle();
  }
  assert.fail(`never happened: ${what}`);
}

function useHost(options = {}) {
  host = realHost({ root, ...options });
  state.exec = (...args) => host.exec(...args);
  state.readTextFile = (path) => host.readTextFile(path);
  state.writeTextFile = (path, text, expected) => {
    writes.push(path);
    return host.writeTextFile(path, text, expected);
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "herdsidian-actions-"));
  vault = `${root}/vault`;
  mkdirSync(vault);
  writes = []; locked = [];
  // The state folder is under the temp root too, so the real context file is never read or written.
  process.env.XDG_STATE_HOME = `${root}/state`;
  Object.assign(state, { shared: {}, runs: [], toasts: [], overlays: [], closed: [], props: {}, files: {}, commands: [], viewport: null, layout: { id: "root", children: [] } });
  localStorage.setItem("vault", vault);
  localStorage.removeItem(`recent:${vault}`);
  useHost();
});

afterEach(() => {
  for (const path of locked) chmodSync(path, 0o755);
  rmSync(root, { recursive: true, force: true });
  if (stateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = stateHome;
});

function put(rel, content) {
  const path = `${vault}/${rel}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
const bytes = (rel) => readFileSync(`${vault}/${rel}`);
const text = (rel) => bytes(rel).toString("utf8");
const on = (rel) => existsSync(`${vault}/${rel}`);
const vaultWrites = () => writes.filter((p) => p.startsWith(`${vault}/`)).map((p) => p.slice(vault.length + 1));

async function mount(files = {}) {
  for (const [rel, content] of Object.entries(files)) put(rel, content);
  const view = new Notes(), cx = fakeCx();
  cx.sleep = async () => {};
  view.init({}, cx);
  await until(() => view.entries.has("") && !view.indexing, "the first load");
  // Each render has its own cx, dead when it returns: a handler that kept it throws.
  return { view, cx, tree: () => during(cx, (live) => view.render(live)) };
}

let requests = 0;
// Posts a request as a surface does, and waits for its one message.
async function act(s, op, path, kind, name) {
  const count = state.toasts.length;
  state.shared[ACTION_KEY] = { id: `fs${++requests}`, at: Date.now(), vault, op, path, kind, ...(name !== undefined && { name }) };
  s.tree();
  await until(() => state.toasts.length > count && !s.view.actions.busy, `the message of ${op} ${path}`);
  await settle();
  return state.toasts[state.toasts.length - 1];
}

async function openNote(s, path, mode = "edit") {
  s.view.open(path, s.cx, mode);
  await until(() => s.view.note === path, `opening ${path}`);
}

function typeInto(s, value) {
  s.view.editor.set_value(value);
  during(s.cx, (live) => s.view.editor.fire("change", null, live));
}

const trashed = () => (existsSync(`${root}/${FAKE_TRASH}`) ? readdirSync(`${root}/${FAKE_TRASH}`) : []);

test("a folder rename leaves exact bytes: links change, code, frontmatter, CRLF and the attachment stay (AC24, AC26, AC40, AC43)", async () => {
  const lines = (old) => [
    "---",
    'up: "[[Projects/Old/one]]"',
    "---",
    "# Title",
    `See [[Projects/${old}/one#Top|alias]] and [t](Projects/${old}/two.md "Title").`,
    `Image ![[Projects/${old}/media/shot.png|300]] and ![x](Projects/${old}/media/shot.png#page=2).`,
    "Bare [[two]], web [w](https://example.com/Projects/Old/one.md), mail [m](mailto:a@b.c).",
    "Code `[[Projects/Old/one]]` here.",
    "```",
    "[[Projects/Old/one]]",
    "```",
    "[id]: Projects/Old/one.md",
    "End",
  ].join("\r\n"); // and no final newline
  const png = Buffer.from([0x89, 0x50, 0x00, 0xff, 0xfe, 0x0d, 0x0a]);
  const s = await mount({
    "other.md": lines("Old"),
    "Projects/Old/one.md": "Sibling [[two]] and [[Projects/Old/two]] and ![](media/shot.png).\n",
    "Projects/Old/two.md": "No links.\n",
    "Projects/Old/media/shot.png": png,
    "Projects/Old/.hidden/data": "kept",
    "Projects/Oldest/three.md": "[[Projects/Oldest/three]]\n",
    "plain.md": "No links.\n",
  });
  const message = await act(s, "rename", "Projects/Old", "dir", "New");
  assert.equal(text("other.md"), lines("New"));
  assert.equal(text("Projects/New/one.md"), "Sibling [[two]] and [[Projects/New/two]] and ![](media/shot.png).\n");
  assert.equal(text("Projects/New/two.md"), "No links.\n");
  assert.deepEqual(bytes("Projects/New/media/shot.png"), png);
  assert.equal(text("Projects/New/.hidden/data"), "kept", "what the tree hides moves too");
  assert.equal(text("Projects/Oldest/three.md"), "[[Projects/Oldest/three]]\n", "a sibling with the same start stays");
  assert.ok(!on("Projects/Old"));
  assert.deepEqual(vaultWrites().sort(), ["Projects/New/one.md", "other.md"], "a note with no changed link is not written");
  assert.deepEqual(message, { title: "2 notes updated", level: "success" });
  assert.ok(s.view.all.includes("Projects/New/one.md"));
});

test("the context file on disk follows a rename and loses a delete, for this vault only (AC22, AC53)", async () => {
  mkdirSync(`${root}/state/herdsidian`, { recursive: true });
  const file = `${root}/state/herdsidian/context.json`;
  const entry = (v, notes) => ({ space: v, vault: v, notes, excluded: [], agents: {} });
  writeFileSync(file, JSON.stringify({ version: 1, spaces: [entry(vault, ["Old/a.md", "b.md"]), entry("/other", ["Old/a.md"])] }));
  const s = await mount({ "Old/a.md": "", "b.md": "" });
  await act(s, "rename", "Old", "dir", "New");
  await until(() => JSON.parse(readFileSync(file, "utf8")).spaces[0].notes[0] === "New/a.md", "the context file follows");
  await act(s, "delete", "New", "dir");
  await until(() => JSON.parse(readFileSync(file, "utf8")).spaces[0].notes.length === 1, "the context file loses it");
  const doc = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(doc.spaces[0].notes, ["b.md"]);
  assert.deepEqual(doc.spaces[1].notes, ["Old/a.md"]);
});

test("notes that cannot be updated stay byte for byte, the others go on, and the message counts them (AC35)", { skip: isRoot && "root ignores file modes" }, async () => {
  const big = `[[Old]]\n${"x".repeat(1536 * 1024)}`;
  const notUtf8 = Buffer.concat([Buffer.from("[[Old]] "), Buffer.from([0xff, 0xfe])]);
  const s = await mount({
    "Old.md": "",
    "fine.md": "[[Old]]\n",
    "locked.md": "[[Old]]\n",
    "big.md": big,
    "binary.md": notUtf8,
    "racing.md": "[[Old]]\n",
  });
  chmodSync(`${vault}/locked.md`, 0o444);
  locked.push(`${vault}/locked.md`);
  // Changed by someone else right after our read, to the same length, so only the compare-and-swap can catch it.
  const raced = "[[Odd]]\n";
  state.readTextFile = async (path) => {
    const read = await host.readTextFile(path);
    if (path === `${vault}/racing.md`) writeFileSync(path, raced);
    return read;
  };
  const message = await act(s, "rename", "Old.md", "note", "New.md");
  assert.equal(text("fine.md"), "[[New]]\n");
  assert.equal(text("locked.md"), "[[Old]]\n");
  assert.equal(text("big.md"), big);
  assert.deepEqual(bytes("binary.md"), notUtf8);
  assert.equal(text("racing.md"), raced);
  assert.ok(on("New.md"), "the rename is not rolled back");
  assert.equal(message.title, "1 note updated, 4 not updated");
  assert.equal(message.level, "warning");
  for (const path of ["locked.md", "big.md", "binary.md", "racing.md"]) assert.ok(message.body.includes(path), path);
});

test("a case-only rename writes no other note, and the disk has the new case (AC19, AC38)", async () => {
  const s = await mount({ "foo.md": "x", "docs/a.md": "x", "b.md": "[[foo]] [[docs/a]]\n" });
  const note = await act(s, "rename", "foo.md", "note", "Foo.md");
  const folder = await act(s, "rename", "docs", "dir", "Docs");
  assert.deepEqual(vaultWrites(), []);
  assert.equal(text("b.md"), "[[foo]] [[docs/a]]\n");
  assert.deepEqual(readdirSync(vault).sort(), ["Docs", "Foo.md", "b.md"]);
  assert.deepEqual([note.title, folder.title], ["0 notes updated", "0 notes updated"]);
  assert.ok(s.view.entries.get("").some((e) => e.name === "Docs"));
});

test("a failed rename writes no other note and states the path and reason (AC38, AC58)", { skip: isRoot && "root ignores file modes" }, async () => {
  const s = await mount({ "Docs/a.md": "x", "b.md": "[[Docs/a]]\n" });
  chmodSync(`${vault}/Docs`, 0o555);
  locked.push(`${vault}/Docs`);
  const message = await act(s, "rename", "Docs/a.md", "note", "c.md");
  assert.equal(message.title, "Cannot rename Docs/a.md");
  assert.equal(message.level, "error");
  assert.ok(message.body);
  assert.deepEqual(vaultWrites(), []);
  assert.equal(text("b.md"), "[[Docs/a]]\n");
  assert.ok(on("Docs/a.md"));
  assert.ok(!on("Docs/c.md"));
});

test("a rename to a taken name moves nothing, and a folder never lands inside another (AC18, AC61)", async () => {
  const s = await mount({ "Docs/a.md": "x", "Taken/b.md": "y", "photo.png": "z", "c.md": "[[Docs/a]]\n" });
  const folder = await act(s, "rename", "Docs", "dir", "Taken");
  const file = await act(s, "rename", "c.md", "note", "PHOTO.png");
  assert.match(folder.title, /already exists/);
  assert.match(file.title, /already exists/);
  assert.deepEqual(readdirSync(`${vault}/Taken`), ["b.md"]);
  assert.equal(text("Docs/a.md"), "x");
  assert.equal(text("photo.png"), "z");
  assert.equal(text("c.md"), "[[Docs/a]]\n");
  assert.deepEqual(vaultWrites(), []);
});

test("a dirty open note: its file is untouched by the update, and the save goes to the new path only (AC33, AC55)", async () => {
  const s = await mount({ "Docs/a.md": "[[Docs/b]]\n", "Docs/b.md": "", "c.md": "[[Docs/b]]\n" });
  await openNote(s, "Docs/a.md");
  typeInto(s, "typed [[Docs/b]]\n");
  const message = await act(s, "rename", "Docs", "dir", "Papers");
  assert.equal(text("Papers/a.md"), "[[Docs/b]]\n");
  assert.equal(text("c.md"), "[[Papers/b]]\n");
  assert.equal(message.title, "1 note updated, 1 not updated");
  assert.ok(message.body.includes("Papers/a.md"));
  assert.deepEqual([s.view.note, s.view.editor.value(), s.view.dirty], ["Papers/a.md", "typed [[Docs/b]]\n", true]);
  during(s.cx, (live) => s.view.save(false, live));
  await until(() => !s.view.dirty, "the save");
  assert.equal(text("Papers/a.md"), "typed [[Docs/b]]\n");
  assert.ok(!on("Docs"), "nothing comes back at the old path");
});

test("a write during typing gives the conflict banner on save, and the editor text stays (AC34)", async () => {
  const s = await mount({ "Old.md": "", "a.md": "[[Old]]\n" });
  await openNote(s, "a.md");
  // The person types right after the update's write landed.
  state.writeTextFile = async (path, value, expected) => {
    await host.writeTextFile(path, value, expected);
    if (path === `${vault}/a.md`) typeInto(s, "typed\n");
  };
  await act(s, "rename", "Old.md", "note", "New.md");
  assert.equal(text("a.md"), "[[New]]\n");
  assert.equal(s.view.editor.value(), "typed\n");
  state.writeTextFile = (path, value, expected) => host.writeTextFile(path, value, expected);
  during(s.cx, (live) => s.view.save(false, live));
  await until(() => s.view.conflict, "the conflict");
  assert.equal(text("a.md"), "[[New]]\n");
  assert.equal(s.view.editor.value(), "typed\n");
  const banner = s.tree();
  assert.ok(findById(banner, "overwrite"), "the current banner shows");
  assert.ok(findById(banner, "reload"));
});

test("a clean open note gets the update on disk and shows it (AC34)", async () => {
  const s = await mount({ "Old.md": "", "a.md": "[[Old]]\n" });
  await openNote(s, "a.md");
  await act(s, "rename", "Old.md", "note", "New.md");
  await until(() => s.view.editor.value() === "[[New]]\n", "the new text");
  assert.equal(s.view.dirty, false);
});

test("a delete moves the folder whole into the fake trash, and the vault has no .trash (AC49, AC53)", async () => {
  const png = Buffer.from([0xff, 0x00, 0xfe]);
  const s = await mount({ "Docs/a.md": "x", "Docs/Sub/shot.png": png, "Docs/.hidden": "h", "b.md": "[[Docs/a]]\n" });
  const message = await act(s, "delete", "Docs", "dir");
  assert.equal(message.level, "success");
  assert.ok(!on("Docs"));
  assert.ok(!on(".trash"));
  assert.deepEqual(host.calls, [["trash", "-s", `${vault}/Docs`]]);
  const [item] = trashed();
  assert.equal(item, "0-Docs");
  assert.deepEqual(readFileSync(`${root}/${FAKE_TRASH}/${item}/Sub/shot.png`), png);
  assert.equal(readFileSync(`${root}/${FAKE_TRASH}/${item}/.hidden`, "utf8"), "h");
  assert.equal(text("b.md"), "[[Docs/a]]\n", "a delete changes no reference");
  assert.deepEqual(vaultWrites(), []);
});

test("deleting a note leaves its attachments in place (AC49)", async () => {
  const s = await mount({ "Docs/a.md": "![](shot.png)", "Docs/shot.png": "img" });
  await act(s, "delete", "Docs/a.md", "note");
  assert.ok(!on("Docs/a.md"));
  assert.equal(text("Docs/shot.png"), "img");
});

for (const mode of ["fail", "stuck", "missing"]) {
  test(`a trash that goes "${mode}" leaves the item in place and says so (AC50)`, async () => {
    useHost({ trash: mode });
    const s = await mount({ "Docs/a.md": "x" });
    const message = await act(s, "delete", "Docs", "dir");
    assert.equal(message.title, "Cannot delete Docs");
    assert.equal(message.level, "error");
    assert.equal(text("Docs/a.md"), "x");
    assert.deepEqual(trashed(), []);
  });
}

async function dirtyDelete() {
  const s = await mount({ "Docs/a.md": "saved\n" });
  await openNote(s, "Docs/a.md");
  typeInto(s, "typed\n");
  state.shared[ACTION_KEY] = { id: `fs${++requests}`, at: Date.now(), vault, op: "delete", path: "Docs", kind: "dir" };
  s.tree();
  await until(() => s.view.asking, "the banner");
  return s;
}
const press = (s, id) => {
  const node = findById(s.tree(), id);
  return during(s.cx, (live) => node.onClick(null, live));
};

test("a dirty delete, Save: the Trash holds the typed text, and no file comes back (AC57)", async () => {
  const s = await dirtyDelete();
  assert.equal(text("Docs/a.md"), "saved\n", "nothing happens before the answer");
  press(s, "ask-save");
  await until(() => state.toasts.length === 1, "the message");
  assert.equal(readFileSync(`${root}/${FAKE_TRASH}/0-Docs/a.md`, "utf8"), "typed\n");
  assert.equal(s.view.note, null);
  during(s.cx, (live) => s.view.save(true, live));
  await settle();
  assert.ok(!on("Docs"));
});

test("a dirty delete, Discard: the Trash holds the saved text (AC57)", async () => {
  const s = await dirtyDelete();
  press(s, "ask-discard");
  await until(() => state.toasts.length === 1, "the message");
  assert.equal(readFileSync(`${root}/${FAKE_TRASH}/0-Docs/a.md`, "utf8"), "saved\n");
  assert.equal(s.view.note, null);
  assert.ok(!on("Docs"));
});

test("a dirty delete, Cancel: the disk stays and the text stays (AC57)", async () => {
  const s = await dirtyDelete();
  press(s, "ask-cancel");
  await settle();
  assert.equal(text("Docs/a.md"), "saved\n");
  assert.deepEqual(trashed(), []);
  assert.deepEqual([s.view.note, s.view.editor.value(), s.view.dirty], ["Docs/a.md", "typed\n", true]);
});

test("Discard, then a trash that fails: the file stays, the text stays, and it is marked unsaved (AC50)", async () => {
  useHost({ trash: "fail" });
  const s = await dirtyDelete();
  press(s, "ask-discard");
  await until(() => state.toasts.length === 1, "the message");
  assert.equal(text("Docs/a.md"), "saved\n");
  assert.deepEqual([s.view.editor.value(), s.view.dirty], ["typed\n", true]);
});

test("names with dashes, quotes and shell characters are exact on disk, and nothing else changes (AC64)", async () => {
  const s = await mount({ "a.md": "[[a]]\n" });
  await act(s, "rename", "a.md", "note", "$(touch x) *.md");
  assert.deepEqual(readdirSync(vault), ["$(touch x) *.md"]);
  const folders = ["-x", "--help", `it's "quoted"`];
  for (const name of folders) {
    state.shared[ACTION_KEY] = { id: `fs${++requests}`, at: Date.now(), vault, op: "new-folder", path: "", kind: "root", name };
    s.tree();
    await until(() => on(name), name);
  }
  assert.deepEqual(readdirSync(vault).sort(), ["$(touch x) *.md", ...folders].sort());
  await act(s, "delete", "-x", "dir");
  assert.ok(!on("-x"));
  await act(s, "rename", "--help", "dir", "-n");
  assert.ok(on("-n"));
  assert.ok(!on("--help"));
});

test("New note in a folder gone since the dialog creates nothing, not even the parent (AC60)", async () => {
  const s = await mount({ "Docs/a.md": "x" });
  rmSync(`${vault}/Docs`, { recursive: true });
  const message = await act(s, "new-note", "Docs", "dir");
  assert.equal(message.title, "Docs no longer exists");
  assert.ok(!on("Docs"));
});

test("New note and New folder land on disk in the clicked folder (AC9, AC12)", async () => {
  const s = await mount({ "Docs/Untitled.md": "x" });
  s.view.actions.createNote("Docs", s.cx);
  await until(() => s.view.note === "Docs/Untitled 2.md", "the new note");
  assert.equal(text("Docs/Untitled 2.md"), "");
  assert.equal(text("Docs/Untitled.md"), "x");
  state.shared[ACTION_KEY] = { id: `fs${++requests}`, at: Date.now(), vault, op: "new-folder", path: "Docs", kind: "dir", name: "Sub" };
  s.tree();
  await until(() => on("Docs/Sub"), "the new folder");
  assert.deepEqual(readdirSync(`${vault}/Docs/Sub`), []);
});

test("a note gone during the update is not reported, and nothing comes back at its path", async () => {
  const s = await mount({ "Old.md": "", "gone.md": "[[Old]]\n", "fine.md": "[[Old]]\n" });
  state.readTextFile = async (path) => {
    if (path === `${vault}/gone.md`) rmSync(path, { force: true });
    return host.readTextFile(path);
  };
  const message = await act(s, "rename", "Old.md", "note", "New.md");
  assert.deepEqual(message, { title: "1 note updated", level: "success" });
  assert.ok(!on("gone.md"));
  assert.equal(text("fine.md"), "[[New]]\n");
});

test("the guard uses the system stat, even with another stat first on the PATH", async () => {
  const bin = `${root}/bin`, path = process.env.PATH;
  mkdirSync(bin);
  writeFileSync(`${bin}/stat`, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const s = await mount({ "Old.md": "", "a.md": "[[Old]]\n" });
  process.env.PATH = `${bin}:${path}`;
  try {
    const message = await act(s, "rename", "Old.md", "note", "New.md");
    assert.deepEqual(message, { title: "1 note updated", level: "success" });
    assert.equal(text("a.md"), "[[New]]\n");
  } finally {
    process.env.PATH = path;
  }
});

test("a link the app opens stays when it cannot change, and the message says its note was not updated", async () => {
  const s = await mount({ "Old.md": "", "a.md": "[t](Old) [t2](./Old) [[/Old]] [abs](/Old.md) [[https://a.com/Old]]\n" });
  const message = await act(s, "rename", "Old.md", "note", "New.md");
  assert.equal(text("a.md"), "[t](Old) [t2](./Old) [[/Old]] [abs](/Old.md) [[https://a.com/Old]]\n");
  assert.equal(message.title, "0 notes updated, 1 not updated");
  assert.equal(message.level, "warning");
  assert.ok(message.body.includes("a.md"));
  assert.deepEqual(vaultWrites(), []);
});
