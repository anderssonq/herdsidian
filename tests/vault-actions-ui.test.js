// The tree's right-click actions, through the real Notes view with an in-memory disk: the menu wiring, the
// request channel, and what the view holds after a create, rename or delete. The real disk is in vault-actions-fs.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, findById, walk, settle, rightClick } from "./support/mod-stubs.js";
import { during } from "./support/live-cx.js";

// Herdr's zoom, which a test can set. The mods capture the function at import, so set it before.
let zoom = 1;
globalThis.__herdsidianStubs.herdr.settings = () => ({ zoom });

const { default: Notes } = await import("../mods/herdsidian/main.js");
const { VaultSurface } = await import("../mods/herdsidian/actions-view.js");
const { Palette } = await import("../mods/herdsidian/palette-main.js");
const { ACTION_KEY } = await import("../mods/herdsidian/actions.js");

const VAULT = "/vault";
const NEXT = "/next";
const CONTEXT = "/state/herdsidian/context.json";
// As in Herdr: a missing file reads as null (the stubs' default rejects).
const realRead = async (path) => (path in state.files ? state.files[path] : null);
const realWrite = state.writeTextFile;

// The in-memory disk behind exec: folders here, file text in state.files. `hooks` run right after the
// operation, while Notes still awaits it. `refuse` makes an operation fail. `gate` holds an answer that
// was already computed, like a slow read that started before something else changed the disk.
let disk;
const ok = (stdout = "") => ({ stdout, stderr: "", code: 0 });
const no = (code, stderr = "") => ({ stdout: "", stderr, code });
const inPath = (p, dir) => p === dir || p.startsWith(`${dir}/`);
const paths = () => [...disk.dirs, ...Object.keys(state.files)];
const on = (p) => paths().includes(p);
const children = (dir) => paths().filter((p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes("/"));

function moveOnDisk(src, dst) {
  const swap = (p) => dst + p.slice(src.length);
  disk.dirs = new Set([...disk.dirs].map((p) => (inPath(p, src) ? swap(p) : p)));
  state.files = Object.fromEntries(Object.entries(state.files).map(([p, text]) => [inPath(p, src) ? swap(p) : p, text]));
  disk.ops.push(["move", src, dst]);
  disk.hooks.move?.();
}

function answer(cmd, args) {
  if (cmd === "awk" || cmd === "git") return ok();
  if (cmd === "sh") {
    const script = args[1];
    if (script.includes("printf %s")) return ok("/state");
    if (script.includes("for p in")) {
      if (!disk.dirs.has(args[3])) return no(1, "no folder");
      return ok(children(args[3]).map((p) => {
        const name = p.slice(args[3].length + 1);
        return disk.dirs.has(p) ? `d\0${name}\0` : /\.md$/i.test(name) ? `f\0${name}\0` : "";
      }).join(""));
    }
    if (script.includes("/bin/mv -n")) {
      if (disk.refuse.move) return no(1, disk.refuse.move);
      if (!on(args[3])) return no(3);
      if (on(args[4])) return no(4);
      moveOnDisk(args[3], args[4]);
      return ok();
    }
    if (script.includes("test -w")) return ok(`${Buffer.byteLength(state.files[args[3]] ?? "")}\n`);
    return on(args[3]) ? ok() : no(1); // exists
  }
  if (cmd === "/bin/mv") {
    moveOnDisk(args[0], args[1]);
    return ok();
  }
  if (cmd === "find") {
    if (args[0] === "-H" && args[2] === "-mindepth") return disk.dirs.has(args[1]) ? ok(children(args[1]).map((p) => `${p}\0`).join("")) : no(1, "no folder");
    if (args[0] === "-H") return disk.refuse.snapshot ? no(1, "cannot read") : ok(Object.keys(state.files).filter((p) => inPath(p, args[1])).map((p) => `${p}\0`).join(""));
    if (disk.refuse.list) return no(1, disk.refuse.list);
    return ok(Object.keys(state.files).filter((p) => inPath(p, args[0]) && /\.md$/i.test(p)).map((p) => `${p}\n`).join(""));
  }
  if (cmd === "mkdir") {
    if (on(args[0])) return no(1, "File exists");
    if (!disk.dirs.has(args[0].slice(0, args[0].lastIndexOf("/")))) return no(1, "No such file or directory");
    disk.dirs.add(args[0]);
    disk.ops.push(["mkdir", args[0]]);
    return ok();
  }
  if (cmd === "/usr/bin/trash") {
    disk.ops.push(["trash", ...args]);
    if (disk.refuse.trash) return no(1, disk.refuse.trash);
    if (disk.refuse.trashStuck) return ok();
    disk.dirs = new Set([...disk.dirs].filter((p) => !inPath(p, args[1])));
    state.files = Object.fromEntries(Object.entries(state.files).filter(([p]) => !inPath(p, args[1])));
    disk.hooks.trash?.();
    return ok();
  }
  return ok();
}

beforeEach(() => {
  zoom = 1;
  Object.assign(state, { shared: {}, runs: [], toasts: [], overlays: [], closed: [], props: {}, files: {}, commands: [], viewport: null,
    layout: { id: "root", children: [] }, readTextFile: realRead, writeTextFile: realWrite });
  disk = { dirs: new Set([VAULT]), ops: [], refuse: {}, hooks: {}, gate: null };
  state.exec = async (cmd, args = []) => {
    const result = answer(cmd, args);
    const held = disk.gate?.(cmd, args);
    if (held) await held;
    return result;
  };
  localStorage.removeItem(`recent:${VAULT}`);
  localStorage.removeItem(`recent:${NEXT}`);
  localStorage.setItem("vault", VAULT);
});

// Puts notes and folders on the disk: { "Docs/a.md": "text", "Docs/Sub": null }. A file's folders appear too.
function seed(tree) {
  for (const [rel, text] of Object.entries(tree)) {
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i++) disk.dirs.add(`${VAULT}/${parts.slice(0, i).join("/")}`);
    if (text === null) disk.dirs.add(`${VAULT}/${rel}`);
    else state.files[`${VAULT}/${rel}`] = text;
  }
}

async function mount(tree = {}, { open = [] } = {}) {
  seed(tree);
  const view = new Notes(), cx = fakeCx();
  cx.sleep = async () => {};
  view.init({}, cx);
  for (const folder of open) view.folders.add(folder);
  view.load(cx);
  await settle();
  // Each render has its own cx, dead when it returns: a handler that kept it throws.
  return { view, cx, tree: () => during(cx, (live) => view.render(live)) };
}

let requests = 0;
const request = (op, path, kind, name, extra = {}) => ({ id: `r${++requests}`, at: Date.now(), vault: VAULT, op, path, kind, ...(name !== undefined && { name }), ...extra });

// Posts a request as a surface does, lets Notes render it, and waits for the work.
async function act(s, ...args) {
  state.shared[ACTION_KEY] = request(...args);
  s.tree();
  await settle();
}

async function openNote(s, path, mode = "read") {
  s.view.open(path, s.cx, mode);
  await settle();
}

function typeInto(s, text) {
  s.view.editor.set_value(text);
  s.view.editor.fire("change", null, s.cx);
}

function holdOnce(match) {
  let release, used = false;
  const held = new Promise((resolve) => { release = resolve; });
  disk.gate = (cmd, args) => {
    if (used || !match(cmd, args)) return null;
    used = true;
    return held;
  };
  return release;
}

const rightHandlers = (tree) => walk(tree).filter((n) => n.calls.some(([name, args]) => name === "on_mouse_down" && args[0] === "right"));
const texts = (tree) => walk(tree).flatMap((n) => n.kids.filter((k) => typeof k === "string"));
const titles = () => state.toasts.map((t) => t.title);
const recents = () => JSON.parse(localStorage.getItem(`recent:${VAULT}`) ?? "[]");
const context = (spaces) => JSON.stringify({ version: 1, spaces });
const notePaths = () => Object.keys(state.files).filter((p) => p.startsWith(`${VAULT}/`));

// ---- The menu ----

const pointer = { position: { x: 995, y: 695 } };

test("right-clicking a folder row opens its menu, kept inside the window, and changes nothing (AC1, AC4, AC6)", async () => {
  state.viewport = { width: 1000, height: 700 };
  const s = await mount({ "Docs/a.md": "" });
  let stopped = 0;
  s.cx.stop_propagation = () => { stopped++; };
  const before = [s.view.note, s.view.selected, [...s.view.folders], s.view.mode];
  rightClick(findById(s.tree(), "note-Docs"), pointer, s.cx);
  assert.deepEqual(state.overlays.map((o) => o.spec), [{
    mod: "herdsidian", kind: "popup", frame: "none", at: { x: 812, y: 562 }, width: 180, height: 130,
    props: { vaultSurface: "menu", vault: VAULT, target: { path: "Docs", kind: "dir" } },
  }]);
  assert.equal(stopped, 1, "the tree behind it does not open its own menu");
  assert.deepEqual([s.view.note, s.view.selected, [...s.view.folders], s.view.mode], before);
});

test("right-clicking a note row opens the note menu and does not open the note (AC2, AC4)", async () => {
  state.viewport = { width: 1000, height: 700 };
  const s = await mount({ "a.md": "" });
  rightClick(findById(s.tree(), "note-a.md"), pointer, s.cx);
  await settle();
  const { at, height, props } = state.overlays[0].spec;
  assert.deepEqual([at, height, props.target], [{ x: 812, y: 622 }, 70, { path: "a.md", kind: "note" }]);
  assert.equal(s.view.note, null);
});

test("right-clicking the tree's empty space opens the root menu (AC3), also in an empty vault", async () => {
  state.viewport = { width: 1000, height: 700 };
  const s = await mount();
  rightClick(findById(s.tree(), "notes-tree"), { position: { x: 100, y: 200 } }, s.cx);
  const { at, height, props } = state.overlays[0].spec;
  assert.deepEqual([at, height, props.target], [{ x: 100, y: 200 }, 70, { path: "", kind: "root" }]);
});

test("right-clicking a search hit opens the note menu; the tree's empty space has no menu then (AC8)", async () => {
  const s = await mount({ "Docs/alpha.md": "" });
  s.view.query = "alpha";
  const tree = s.tree();
  rightClick(findById(tree, "hit-Docs/alpha.md"), pointer, s.cx);
  assert.deepEqual(state.overlays[0].spec.props.target, { path: "Docs/alpha.md", kind: "note" });
  assert.deepEqual(rightHandlers(findById(tree, "notes-tree")).map((n) => n.nodeId), ["hit-Docs/alpha.md"]);
});

test("the menu grows with zoom but its place is not scaled (P0-a)", async () => {
  state.viewport = { width: 1000, height: 700 };
  const s = await mount({ "a.md": "" });
  zoom = 1.1;
  rightClick(findById(s.tree(), "note-a.md"), pointer, s.cx);
  assert.deepEqual(state.overlays[0].spec.at, { x: 1000 - 198 - 8, y: 700 - 77 - 8 });
  assert.equal(state.overlays[0].spec.width, 180);
  rightClick(findById(s.tree(), "note-a.md"), { position: { x: 300, y: 200 } }, s.cx);
  assert.deepEqual(state.overlays[1].spec.at, { x: 300, y: 200 });
});

test("with no usable viewport the menu opens at the pointer (AC6)", async () => {
  const s = await mount({ "a.md": "" });
  rightClick(findById(s.tree(), "note-a.md"), pointer, s.cx);
  assert.equal(state.overlays[0].spec.at, "pointer");
});

test("the rail, no vault, and No note matches have no right-click menu (AC7, AC8)", async () => {
  const s = await mount({ "a.md": "" });
  s.view.query = "zzz";
  const none = s.tree();
  assert.ok(texts(none).includes("No note matches"));
  assert.deepEqual(rightHandlers(none), []);
  s.view.query = "";
  state.layout = { id: "root", children: [{ id: "herdsidian", size: { px: 44 } }] };
  assert.deepEqual(rightHandlers(s.tree()), []);
  state.layout = { id: "root", children: [] };
  localStorage.removeItem("vault");
  assert.deepEqual(rightHandlers((await mount()).tree()), []);
});

// ---- The overlay branch ----

test("a copy with vaultSurface draws VaultSurface and forwards its close hook", () => {
  state.props = { overlay: "o1", vaultSurface: "menu", vault: VAULT, target: { path: "", kind: "root" } };
  const view = new Notes(), cx = fakeCx();
  view.init({}, cx);
  assert.ok(view.overlay instanceof VaultSurface);
  assert.ok(findById(view.render(cx), "vault-menu"));
  assert.equal(view.overlay.dead, false);
  view.close(cx);
  assert.equal(view.overlay.dead, true);
  assert.equal(view.actions, undefined, "an overlay copy starts none of the Notes work");
});

test("a copy with only overlay still draws the palette", () => {
  state.props = { overlay: "o1" };
  const view = new Notes(), cx = fakeCx();
  view.init({}, cx);
  assert.ok(view.overlay instanceof Palette);
  assert.ok(findById(view.render(cx), "palette-root"));
  assert.equal(findById(view.render(cx), "vault-menu"), null);
});

// ---- The channel ----

test("a request found at start is never run, even a fresh one (AC62)", async () => {
  seed({ "a.md": "text" });
  state.shared[ACTION_KEY] = request("delete", "a.md", "note");
  const s = await mount();
  s.tree();
  await settle();
  assert.deepEqual(disk.ops, []);
  assert.ok(on(`${VAULT}/a.md`));
});

test("the same id runs once", async () => {
  const s = await mount({ "a.md": "text" });
  await act(s, "new-folder", "", "root", "Made");
  s.tree();
  s.tree();
  await settle();
  assert.deepEqual(disk.ops, [["mkdir", `${VAULT}/Made`]]);
});

test("a stale request is not run", async () => {
  const s = await mount({ "a.md": "text" });
  state.shared[ACTION_KEY] = request("delete", "a.md", "note", undefined, { at: Date.now() - 6000 });
  s.tree();
  await settle();
  assert.deepEqual(disk.ops, []);
});

test("a request from another vault changes nothing and warns (AC62)", async () => {
  const s = await mount({ "a.md": "text" });
  await act(s, "delete", "a.md", "note", undefined, { vault: "/old" });
  assert.deepEqual(disk.ops, []);
  assert.ok(on(`${VAULT}/a.md`));
  assert.equal(state.toasts.length, 1);
  assert.equal(state.toasts[0].level, "warning");
  assert.match(state.toasts[0].title, /old/);
});

// ---- Create ----

test("the header's New note button makes Untitled at the root in edit mode (AC15)", async () => {
  const s = await mount({ "Docs/Untitled.md": "" });
  const button = findById(s.tree(), "notes-new");
  during(s.cx, (live) => button.onClick(null, live));
  await settle();
  assert.equal(state.files[`${VAULT}/Untitled.md`], "");
  assert.deepEqual([s.view.note, s.view.mode], ["Untitled.md", "edit"]);
});

test("the rail's New note button makes the next free name at the root in edit mode (AC10, AC15)", async () => {
  const s = await mount({ "UNTITLED.md": "" });
  state.layout = { id: "root", children: [{ id: "herdsidian", size: { px: 44 } }] };
  const button = findById(s.tree(), "notes-new-rail");
  during(s.cx, (live) => button.onClick(null, live));
  await settle();
  assert.equal(state.files[`${VAULT}/Untitled 2.md`], "");
  assert.deepEqual([s.view.note, s.view.mode], ["Untitled 2.md", "edit"]);
});

test("New note in a closed folder opens it and leaves the other folders, selected and in edit mode (AC9, AC11, AC14)", async () => {
  const s = await mount({ "Docs/a.md": "", "Other/b.md": "" }, { open: ["Other"] });
  await act(s, "new-note", "Docs", "dir");
  assert.equal(state.files[`${VAULT}/Docs/Untitled.md`], "");
  assert.deepEqual([s.view.note, s.view.selected, s.view.mode], ["Docs/Untitled.md", "Docs/Untitled.md", "edit"]);
  assert.deepEqual([...s.view.folders].sort(), ["Docs", "Other"]);
  assert.ok(s.view.entries.get("Docs").some((e) => e.name === "Untitled.md"), "the tree shows it after Back");
  assert.ok(s.view.all.includes("Docs/Untitled.md"));
});

test("New folder makes it closed in the clicked folder, which opens (AC12, AC14)", async () => {
  const s = await mount({ "Docs/a.md": "", "Other/b.md": "" }, { open: ["Other"] });
  await act(s, "new-folder", "Docs", "dir", "Sub folder");
  assert.deepEqual(disk.ops, [["mkdir", `${VAULT}/Docs/Sub folder`]]);
  assert.deepEqual([...s.view.folders].sort(), ["Docs", "Other"]);
  assert.deepEqual(s.view.entries.get("Docs").map((e) => e.name), ["Sub folder", "a.md"]);
});

test("New folder from the empty space makes it at the root (AC12)", async () => {
  const s = await mount();
  await act(s, "new-folder", "", "root", "Made");
  assert.deepEqual(disk.ops, [["mkdir", `${VAULT}/Made`]]);
  assert.ok(s.view.entries.get("").some((e) => e.name === "Made" && e.dir));
});

test("New folder rechecks the name: a bad one or one taken since the dialog creates nothing (AC13, AC61)", async () => {
  const s = await mount({ "photo.png": "x" });
  await act(s, "new-folder", "", "root", "a/b");
  await act(s, "new-folder", "", "root", "PHOTO.png");
  assert.deepEqual(disk.ops, []);
  assert.equal(state.toasts.length, 2);
  assert.match(state.toasts[0].body, /"\/"/);
  assert.match(state.toasts[1].title, /already exists/);
});

test("a create in a folder gone since the dialog says so, reloads and creates nothing (AC60)", async () => {
  const s = await mount({ "Docs/a.md": "" });
  disk.dirs.delete(`${VAULT}/Docs`);
  delete state.files[`${VAULT}/Docs/a.md`];
  await act(s, "new-note", "Docs", "dir");
  await act(s, "new-folder", "Docs", "dir", "Sub");
  assert.deepEqual(titles(), ["Docs no longer exists", "Docs no longer exists"]);
  assert.deepEqual(notePaths(), []);
  assert.deepEqual(disk.ops, []);
  assert.ok(!s.view.entries.get("").some((e) => e.name === "Docs"), "the tree reloaded");
});

test("a failed create states the path and the reason, and the state stays (AC58)", async () => {
  const s = await mount({ "Docs/a.md": "" });
  state.writeTextFile = async () => { throw new Error("no permission"); };
  await act(s, "new-note", "Docs", "dir");
  assert.equal(state.toasts[0].title, "Cannot create a note in Docs");
  assert.equal(state.toasts[0].body, "no permission");
  assert.equal(s.view.note, null);
  assert.deepEqual([...s.view.folders], []);
});

// ---- Rename and the view ----

test("a folder rename moves note, highlight, open folders, lists and recents; a sibling with the same start stays (AC21, AC22)", async () => {
  const s = await mount({ "Old/a.md": "", "Old/Sub/b.md": "", "Olden/c.md": "" }, { open: ["Old", "Old/Sub", "Olden"] });
  await openNote(s, "Olden/c.md");
  await openNote(s, "Old/Sub/b.md");
  await act(s, "rename", "Old", "dir", "New");
  assert.deepEqual([s.view.note, s.view.selected, s.view.mode], ["New/Sub/b.md", "New/Sub/b.md", "read"]);
  assert.deepEqual([...s.view.folders].sort(), ["New", "New/Sub", "Olden"]);
  assert.deepEqual([...s.view.entries.keys()].sort(), ["", "New", "New/Sub", "Olden"]);
  assert.deepEqual(s.view.all, ["New/Sub/b.md", "New/a.md", "Olden/c.md"]);
  assert.deepEqual(recents(), ["New/Sub/b.md", "Olden/c.md"]);
  assert.ok(s.view.entries.get("").some((e) => e.name === "New"), "the tree has the new name");
  assert.equal(s.view.hover, null);
});

test("a rename of the open note keeps it open in the same mode, and the header shows the new path (AC54)", async () => {
  const s = await mount({ "Docs/a.md": "text" });
  await openNote(s, "Docs/a.md", "edit");
  const editor = s.view.editor;
  await act(s, "rename", "Docs/a.md", "note", "b.md");
  assert.equal(s.view.editor, editor, "the same editor stays");
  assert.deepEqual([s.view.note, s.view.mode, s.view.dirty], ["Docs/b.md", "edit", false]);
  const tree = s.tree();
  assert.ok(texts(tree).includes("b"));
  assert.ok(texts(tree).includes("Docs/b.md"));
  during(s.cx, (live) => findById(tree, "notes-copy-path").onClick(null, live));
  assert.deepEqual(s.cx.clipboard, [`${VAULT}/Docs/b.md`]);
});

test("a dirty rename keeps the text and the mark, and the next save goes to the new path (AC55)", async () => {
  const s = await mount({ "Docs/a.md": "text" });
  await openNote(s, "Docs/a.md", "edit");
  typeInto(s, "typed");
  await act(s, "rename", "Docs", "dir", "Papers");
  assert.deepEqual([s.view.note, s.view.editor.value(), s.view.dirty], ["Papers/a.md", "typed", true]);
  assert.equal(state.files[`${VAULT}/Papers/a.md`], "text");
  s.view.save(false, s.cx);
  await settle();
  assert.equal(state.files[`${VAULT}/Papers/a.md`], "typed");
  assert.equal(s.view.dirty, false);
  assert.ok(!on(`${VAULT}/Docs/a.md`));
  assert.ok(!on(`${VAULT}/Docs`));
});

test("a rename updates a link and posts one result message (AC24, AC36)", async () => {
  const s = await mount({ "Docs/a.md": "", "b.md": "See [[Docs/a]]." });
  await act(s, "rename", "Docs/a.md", "note", "c.md");
  assert.equal(state.files[`${VAULT}/b.md`], "See [[Docs/c]].");
  assert.deepEqual(state.toasts, [{ title: "1 note updated", level: "success" }]);
});

test("a clean open note shows the text the update wrote (AC34)", async () => {
  const s = await mount({ "Old.md": "", "b.md": "See [[Old]]." });
  await openNote(s, "b.md", "edit");
  await act(s, "rename", "Old.md", "note", "New.md");
  assert.equal(s.view.editor.value(), "See [[New]].");
  assert.equal(s.view.loaded, "See [[New]].");
});

test("a case-only rename writes no note and posts 0 updated (AC19, AC38)", async () => {
  const s = await mount({ "foo.md": "", "b.md": "See [[foo]]." });
  await act(s, "rename", "foo.md", "note", "Foo.md");
  assert.deepEqual(disk.ops, [["move", `${VAULT}/foo.md`, `${VAULT}/Foo.md`]]);
  assert.equal(state.files[`${VAULT}/b.md`], "See [[foo]].");
  assert.deepEqual(state.toasts, [{ title: "0 notes updated", level: "success" }]);
  assert.ok(s.view.all.includes("Foo.md"));
});

test("a request with the same name does nothing and says nothing (AC20, AC38)", async () => {
  const s = await mount({ "foo.md": "" });
  await act(s, "rename", "foo.md", "note", "foo.md");
  assert.deepEqual(disk.ops, []);
  assert.deepEqual(state.toasts, []);
});

test("a folder rename with an unreadable disk still moves, and says attachments were not checked (AC46)", async () => {
  const s = await mount({ "att/x.md": "", "b.md": "![](att/shot.png)" });
  disk.refuse.snapshot = true;
  await act(s, "rename", "att", "dir", "media");
  assert.ok(on(`${VAULT}/media/x.md`));
  assert.equal(state.files[`${VAULT}/b.md`], "![](att/shot.png)");
  assert.match(state.toasts[0].body, /Attachment links were not checked/);
});

test("if the note list cannot be read, the rename does not happen (AC58)", async () => {
  const s = await mount({ "a.md": "" });
  disk.refuse.list = "cannot list";
  await act(s, "rename", "a.md", "note", "b.md");
  assert.deepEqual(disk.ops, []);
  assert.equal(state.toasts[0].title, "Cannot rename a.md");
  assert.equal(state.toasts[0].body, "cannot list");
  assert.equal(s.view.actions.busy, false);
});

test("the context file follows a rename in this vault only (AC22)", async () => {
  state.files[CONTEXT] = context([
    { space: "s", vault: VAULT, notes: ["Old/a.md", "Olden/b.md"], excluded: ["Old/x.md"], agents: { p: ["Old/a.md"] } },
    { space: "o", vault: "/other", notes: ["Old/a.md"], excluded: [], agents: {} },
  ]);
  const s = await mount({ "Old/a.md": "" });
  await act(s, "rename", "Old", "dir", "New");
  const doc = JSON.parse(state.files[CONTEXT]);
  assert.deepEqual(doc.spaces[0].notes, ["New/a.md", "Olden/b.md"]);
  assert.deepEqual(doc.spaces[0].excluded, ["New/x.md"]);
  assert.deepEqual(doc.spaces[0].agents, { p: ["New/a.md"] });
  assert.deepEqual(doc.spaces[1].notes, ["Old/a.md"]);
  assert.deepEqual(s.view.ctx.doc, doc);
});

test("an unwritable context file leaves the rename done and shows the context error (AC59)", async () => {
  const bad = '{"version":99,"spaces":[]}';
  state.files[CONTEXT] = bad;
  const s = await mount({ "a.md": "" });
  await act(s, "rename", "a.md", "note", "b.md");
  assert.equal(s.view.note, null);
  assert.ok(on(`${VAULT}/b.md`));
  assert.ok(s.view.all.includes("b.md"));
  assert.match(s.view.ctxError, /newer Herdsidian/);
  assert.equal(state.files[CONTEXT], bad, "a newer file is not rewritten");
});

test("an invalid context file leaves the delete done, is not rewritten, and shows the error (AC59)", async () => {
  state.files[CONTEXT] = "not json";
  const s = await mount({ "a.md": "" });
  await act(s, "delete", "a.md", "note");
  assert.ok(!on(`${VAULT}/a.md`));
  assert.match(s.view.ctxError, /invalid/);
  assert.equal(state.files[CONTEXT], "not json");
});

// ---- Busy ----

test("during a reference update a second rename or delete only posts a message; a create still works (AC39)", async () => {
  const s = await mount({ "Old.md": "", "b.md": "See [[Old]].", "c.md": "" });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  state.readTextFile = async (path) => {
    if (path === `${VAULT}/b.md`) await held;
    return realRead(path);
  };
  await act(s, "rename", "Old.md", "note", "New.md");
  assert.equal(s.view.actions.busy, true);
  disk.ops = [];
  await act(s, "rename", "c.md", "note", "d.md");
  await act(s, "delete", "c.md", "note");
  assert.deepEqual(disk.ops, []);
  assert.deepEqual(titles(), ["Wait for the current rename or delete to finish", "Wait for the current rename or delete to finish"]);
  await act(s, "new-folder", "", "root", "Made");
  assert.deepEqual(disk.ops, [["mkdir", `${VAULT}/Made`]]);
  release();
  await settle();
  assert.equal(s.view.actions.busy, false);
  await act(s, "delete", "c.md", "note");
  assert.ok(!on(`${VAULT}/c.md`));
});

test("a vault switch during the update: writes stay in the old vault and the new view is untouched (AC39)", async () => {
  const s = await mount({ "Old.md": "", "b.md": "See [[Old]]." });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  state.readTextFile = async (path) => {
    if (path === `${VAULT}/b.md`) await held;
    return realRead(path);
  };
  await act(s, "rename", "Old.md", "note", "New.md");
  disk.dirs.add("/next");
  state.files["/next/b.md"] = "See [[Old]].";
  s.view.setVault("/next", s.cx);
  await settle();
  release();
  await settle();
  assert.equal(state.files[`${VAULT}/b.md`], "See [[New]].");
  assert.equal(state.files["/next/b.md"], "See [[Old]].");
  assert.deepEqual(s.view.all, ["b.md"]);
});

// ---- Delete ----

test("deleting a clean open note closes it and clears the highlight, recents and context (AC49, AC53, AC56)", async () => {
  state.files[CONTEXT] = context([{ space: "s", vault: VAULT, notes: ["Docs/a.md", "b.md"], excluded: [], agents: {} }]);
  const s = await mount({ "Docs/a.md": "text", "b.md": "See [[Docs/a]]." }, { open: ["Docs"] });
  await openNote(s, "b.md");
  await openNote(s, "Docs/a.md");
  await act(s, "delete", "Docs", "dir");
  assert.deepEqual(disk.ops, [["trash", "-s", `${VAULT}/Docs`]]);
  assert.deepEqual([s.view.note, s.view.selected, s.view.editor], [null, null, null]);
  assert.deepEqual([...s.view.folders], []);
  assert.ok(!s.view.entries.has("Docs"));
  assert.deepEqual(s.view.all, ["b.md"]);
  assert.deepEqual(recents(), ["b.md"]);
  assert.deepEqual(JSON.parse(state.files[CONTEXT]).spaces[0].notes, ["b.md"]);
  assert.equal(state.files[`${VAULT}/b.md`], "See [[Docs/a]].", "a delete changes no reference");
  assert.equal(state.toasts.length, 1);
  assert.ok(findById(s.tree(), "notes-tree"), "the tree shows");
});

test("deleting something else leaves the open dirty note alone, with no banner", async () => {
  const s = await mount({ "a.md": "text", "b.md": "" });
  await openNote(s, "a.md", "edit");
  typeInto(s, "typed");
  await act(s, "delete", "b.md", "note");
  assert.deepEqual([s.view.note, s.view.editor.value(), s.view.dirty, s.view.asking ?? null], ["a.md", "typed", true, null]);
  assert.ok(!on(`${VAULT}/b.md`));
});

async function dirtyDelete() {
  const s = await mount({ "Docs/a.md": "text" });
  await openNote(s, "Docs/a.md", "edit");
  typeInto(s, "typed");
  await act(s, "delete", "Docs", "dir");
  return s;
}
const banner = (s, id) => {
  const node = findById(s.tree(), id);
  return during(s.cx, (live) => node.onClick(null, live));
};

test("reopening the note being edited asks first: the typed text stays until the banner is answered", async () => {
  const s = await mount({ "Docs/a.md": "text" });
  await openNote(s, "Docs/a.md", "edit");
  typeInto(s, "typed");
  await openNote(s, "Docs/a.md");
  assert.deepEqual([s.view.editor.value(), s.view.dirty], ["typed", true]);
  assert.ok(texts(s.tree()).includes("Unsaved changes."));
  banner(s, "ask-cancel");
  await settle();
  assert.deepEqual([s.view.editor.value(), s.view.dirty, s.view.asking ?? null], ["typed", true, null]);
});

test("reopening the note being edited, Discard: the note reloads from disk", async () => {
  const s = await mount({ "Docs/a.md": "text" });
  await openNote(s, "Docs/a.md", "edit");
  typeInto(s, "typed");
  await openNote(s, "Docs/a.md");
  banner(s, "ask-discard");
  await settle();
  assert.deepEqual([s.view.editor.value(), s.view.dirty], ["text", false]);
});

test("reopening the note being edited, Save: the typed text is written", async () => {
  const s = await mount({ "Docs/a.md": "text" });
  await openNote(s, "Docs/a.md", "edit");
  typeInto(s, "typed");
  await openNote(s, "Docs/a.md");
  banner(s, "ask-save");
  await settle();
  assert.equal(state.files[`${VAULT}/Docs/a.md`], "typed");
  assert.deepEqual([s.view.editor.value(), s.view.dirty], ["typed", false]);
});

test("Discard followed by a failed read keeps the typed text marked as unsaved", async () => {
  const s = await mount({ "Docs/a.md": "text" });
  await openNote(s, "Docs/a.md", "edit");
  typeInto(s, "typed");
  await openNote(s, "Docs/a.md");
  delete state.files[`${VAULT}/Docs/a.md`];
  banner(s, "ask-discard");
  await settle();
  assert.deepEqual([s.view.editor.value(), s.view.dirty], ["typed", true]);
  assert.match(s.view.error, /Cannot read/);
});

test("Reload drops a pending question: no Unsaved changes banner on the clean note", async () => {
  const s = await mount({ "Docs/a.md": "text", "Docs/b.md": "other" });
  await openNote(s, "Docs/a.md", "edit");
  typeInto(s, "typed");
  await openNote(s, "Docs/b.md");
  assert.equal(typeof s.view.asking, "function");
  state.files[`${VAULT}/Docs/a.md`] = "outside";
  s.view.conflict = true;
  banner(s, "reload");
  await settle();
  assert.deepEqual([s.view.note, s.view.editor.value(), s.view.dirty, s.view.asking ?? null], ["Docs/a.md", "outside", false, null]);
  assert.ok(!texts(s.tree()).includes("Unsaved changes."));
});

test("reopening a clean note reads it again with no banner", async () => {
  const s = await mount({ "Docs/a.md": "text" });
  await openNote(s, "Docs/a.md");
  state.files[`${VAULT}/Docs/a.md`] = "newer";
  await openNote(s, "Docs/a.md");
  assert.equal(s.view.editor.value(), "newer");
  assert.ok(!texts(s.tree()).includes("Unsaved changes."));
});

test("Reload on the conflict banner discards on purpose, with no second question", async () => {
  const s = await mount({ "Docs/a.md": "text" });
  await openNote(s, "Docs/a.md", "edit");
  typeInto(s, "typed");
  state.files[`${VAULT}/Docs/a.md`] = "outside";
  s.view.conflict = true;
  banner(s, "reload");
  await settle();
  assert.deepEqual([s.view.editor.value(), s.view.dirty, s.view.conflict], ["outside", false, false]);
  assert.equal(s.view.asking ?? null, null);
});

test("a dirty delete only asks: nothing is trashed until the banner is answered (AC57)", async () => {
  const s = await dirtyDelete();
  assert.equal(typeof s.view.asking, "function");
  assert.deepEqual(disk.ops, []);
  assert.deepEqual([s.view.note, s.view.editor.value(), s.view.dirty], ["Docs/a.md", "typed", true]);
  assert.ok(texts(s.tree()).includes("Unsaved changes."));
});

test("a dirty delete, Save: the text is written, then the item goes to the Trash (AC57)", async () => {
  const s = await dirtyDelete();
  const seen = [];
  disk.hooks.trash = () => seen.push(s.view.loaded);
  banner(s, "ask-save");
  await settle();
  assert.deepEqual(seen, ["typed"], "the text was saved before the trash ran");
  assert.deepEqual(disk.ops, [["trash", "-s", `${VAULT}/Docs`]]);
  assert.equal(s.view.note, null);
  assert.ok(!on(`${VAULT}/Docs/a.md`));
});

test("a dirty delete, Discard: the item goes to the Trash without the text (AC57)", async () => {
  const s = await dirtyDelete();
  const trashed = [];
  disk.hooks.trash = () => trashed.push(true);
  const writes = [];
  state.writeTextFile = async (...args) => { writes.push(args[0]); return realWrite(...args); };
  banner(s, "ask-discard");
  await settle();
  assert.deepEqual(trashed, [true]);
  assert.deepEqual(writes.filter((p) => p.startsWith(VAULT)), []);
  assert.equal(s.view.note, null);
});

test("a dirty delete, Cancel: the note stays, the disk stays, and a later rename is not refused (AC57)", async () => {
  const s = await dirtyDelete();
  banner(s, "ask-cancel");
  await settle();
  assert.deepEqual(disk.ops, []);
  assert.deepEqual([s.view.note, s.view.editor.value(), s.view.dirty, s.view.asking], ["Docs/a.md", "typed", true, null]);
  assert.equal(state.files[`${VAULT}/Docs/a.md`], "text");
  await act(s, "rename", "Docs", "dir", "Papers");
  assert.deepEqual(state.toasts.filter((t) => /Wait/.test(t.title)), []);
  assert.ok(on(`${VAULT}/Papers/a.md`));
});

test("Discard followed by a failed trash puts the unsaved mark back and keeps the text (AC50)", async () => {
  const s = await dirtyDelete();
  disk.refuse.trash = "trash failed";
  banner(s, "ask-discard");
  await settle();
  assert.deepEqual([s.view.note, s.view.editor.value(), s.view.dirty], ["Docs/a.md", "typed", true]);
  assert.equal(state.toasts[0].title, "Cannot delete Docs");
  assert.equal(state.toasts[0].body, "trash failed");
  assert.equal(state.files[`${VAULT}/Docs/a.md`], "text");
});

test("Discard while another rename runs is refused, and the unsaved mark comes back (AC39, AC50)", async () => {
  const s = await dirtyDelete();
  s.view.actions.busy = true;
  banner(s, "ask-discard");
  await settle();
  assert.deepEqual(disk.ops, []);
  assert.deepEqual([s.view.note, s.view.editor.value(), s.view.dirty], ["Docs/a.md", "typed", true]);
  assert.match(state.toasts[0].title, /Wait/);
});

test("a save while the trash runs writes nothing: the file cannot come back at the old path (AC57)", async () => {
  const s = await dirtyDelete();
  state.readTextFile = async (path) => (path in state.files ? state.files[path] : null);
  disk.hooks.trash = () => {
    s.view.dirty = true;
    s.view.save(true, s.cx);
  };
  banner(s, "ask-discard");
  await settle();
  assert.ok(!on(`${VAULT}/Docs/a.md`));
});

// ---- Failures ----

function snapshot(view) {
  return { note: view.note, selected: view.selected, mode: view.mode, folders: [...view.folders], keys: [...view.entries.keys()], all: [...view.all], recent: [...view.recent] };
}

test("a failed move changes no state and states the path and reason (AC58)", async () => {
  state.files[CONTEXT] = context([{ space: "s", vault: VAULT, notes: ["Docs/a.md"], excluded: [], agents: {} }]);
  const s = await mount({ "Docs/a.md": "text", "b.md": "See [[Docs/a]]." }, { open: ["Docs"] });
  await openNote(s, "Docs/a.md");
  const before = snapshot(s.view), epoch = s.view.pathEpoch;
  disk.refuse.move = "Operation not permitted";
  await act(s, "rename", "Docs", "dir", "Papers");
  assert.deepEqual(snapshot(s.view), before);
  assert.equal(s.view.pathEpoch, epoch);
  assert.equal(state.toasts[0].title, "Cannot rename Docs");
  assert.equal(state.toasts[0].body, "Operation not permitted");
  assert.equal(state.toasts.length, 1);
  assert.equal(state.files[`${VAULT}/b.md`], "See [[Docs/a]].");
  assert.deepEqual(JSON.parse(state.files[CONTEXT]).spaces[0].notes, ["Docs/a.md"]);
  assert.equal(s.view.actions.busy, false);
});

for (const [name, refuse] of [["fails", { trash: "trash failed" }], ["exits 0 and leaves the item", { trashStuck: true }]]) {
  test(`a trash that ${name} changes no state (AC50)`, async () => {
    state.files[CONTEXT] = context([{ space: "s", vault: VAULT, notes: ["Docs/a.md"], excluded: [], agents: {} }]);
    const s = await mount({ "Docs/a.md": "text" }, { open: ["Docs"] });
    await openNote(s, "Docs/a.md");
    const before = snapshot(s.view);
    disk.refuse = refuse;
    await act(s, "delete", "Docs", "dir");
    assert.deepEqual(snapshot(s.view), before);
    assert.equal(state.toasts.at(-1).title, "Cannot delete Docs");
    assert.equal(state.toasts.at(-1).level, "error");
    assert.ok(on(`${VAULT}/Docs/a.md`));
    assert.deepEqual(JSON.parse(state.files[CONTEXT]).spaces[0].notes, ["Docs/a.md"]);
  });
}

test("a rename or delete of an item gone since the dialog says so, reloads and creates nothing (AC60)", async () => {
  const s = await mount({ "a.md": "text", "b.md": "text" });
  delete state.files[`${VAULT}/a.md`];
  await act(s, "rename", "a.md", "note", "c.md");
  assert.deepEqual(titles(), ["a.md no longer exists"]);
  assert.ok(!s.view.entries.get("").some((e) => e.name === "a.md"), "the tree reloaded");
  assert.ok(!on(`${VAULT}/c.md`));
  delete state.files[`${VAULT}/b.md`];
  await act(s, "delete", "b.md", "note");
  assert.deepEqual(titles(), ["a.md no longer exists", "b.md no longer exists"]);
  assert.deepEqual(disk.ops, []);
});

test("an item gone between the check and the move says so, and the tree reloads (AC60)", async () => {
  const s = await mount({ "a.md": "text" });
  disk.gate = (cmd, args) => {
    if (cmd === "find" && args.includes("-iname")) delete state.files[`${VAULT}/a.md`];
    return null;
  };
  await act(s, "rename", "a.md", "note", "c.md");
  assert.equal(state.toasts[0].title, "Cannot rename a.md");
  assert.equal(state.toasts[0].body, "The item no longer exists");
  assert.ok(!s.view.entries.get("").some((e) => e.name === "a.md"));
  assert.ok(!on(`${VAULT}/c.md`));
});

test("a name taken since the dialog is refused, ignoring case, also by a file the tree hides (AC18, AC61)", async () => {
  const s = await mount({ "a.md": "text", "PHOTO.png": "x" });
  await act(s, "rename", "a.md", "note", "photo.png");
  assert.deepEqual(disk.ops, []);
  assert.equal(state.toasts[0].title, '"photo.png" already exists in this folder');
  assert.equal(state.files[`${VAULT}/a.md`], "text");
  assert.equal(state.files[`${VAULT}/PHOTO.png`], "x");
});

test("a name taken in the last moment before the move is refused the same way (AC61)", async () => {
  const s = await mount({ "a.md": "text" });
  disk.gate = (cmd, args) => {
    if (cmd === "find" && args.includes("-iname")) state.files[`${VAULT}/b.md`] = "other";
    return null;
  };
  await act(s, "rename", "a.md", "note", "b.md");
  assert.deepEqual(disk.ops, []);
  assert.equal(state.toasts[0].title, '"b.md" already exists in this folder');
  assert.equal(state.files[`${VAULT}/b.md`], "other");
});

for (const bad of ["", ".", "..", "/etc/passwd", "a/../..", "../outside"]) {
  test(`a rename or delete of the path "${bad}" is refused and changes nothing (AC63)`, async () => {
    const s = await mount({ "a.md": "text" });
    await act(s, "rename", bad, "note", "b.md");
    await act(s, "delete", bad, "note");
    assert.deepEqual(disk.ops, []);
    assert.equal(state.toasts.length, 2);
    assert.equal(state.toasts[0].level, "error");
  });
}

for (const bad of [".", "..", "/etc", "a/../.."]) {
  test(`a create in the path "${bad}" is refused and changes nothing (AC63)`, async () => {
    const s = await mount({ "a.md": "text" });
    await act(s, "new-note", bad, "dir");
    await act(s, "new-folder", bad, "dir", "x");
    assert.deepEqual(disk.ops, []);
    assert.deepEqual(notePaths(), [`${VAULT}/a.md`]);
    assert.equal(state.toasts.length, 2);
  });
}

// ---- The guards that protect text ----

test("a save during the move writes nothing at any path, and the text stays (AC55)", async () => {
  const s = await mount({ "Docs/a.md": "text" });
  await openNote(s, "Docs/a.md", "edit");
  typeInto(s, "typed");
  // As in Herdr: a missing file reads as null, and null as the expected text makes the file.
  state.readTextFile = async (path) => (path in state.files ? state.files[path] : null);
  const writes = [];
  state.writeTextFile = async (...args) => { writes.push(args[0]); return realWrite(...args); };
  disk.hooks.move = () => { s.view.save(true, s.cx); s.view.save(false, s.cx); };
  await act(s, "rename", "Docs", "dir", "Papers");
  assert.deepEqual(writes.filter((p) => p.startsWith(VAULT)), []);
  assert.ok(!on(`${VAULT}/Docs/a.md`), "no file at the old path");
  assert.ok(!on(`${VAULT}/Docs`), "no folder at the old path");
  assert.deepEqual([s.view.note, s.view.editor.value(), s.view.dirty], ["Papers/a.md", "typed", true]);
  assert.equal(state.files[`${VAULT}/Papers/a.md`], "text");
  assert.ok(titles().some((t) => /moving/.test(t)));
});

const isList = (cmd, args) => cmd === "find" && args.includes("-iname");
const isRoot = (cmd, args) => cmd === "sh" && args[1].includes("for p in") && args[3] === VAULT;

test("a load whose note list was read before the rename does not bring old paths back", async () => {
  const s = await mount({ "Docs/a.md": "" }, { open: ["Docs"] });
  const release = holdOnce(isList);
  s.view.load(s.cx);
  await settle();
  await act(s, "rename", "Docs", "dir", "Papers");
  assert.deepEqual(s.view.all, ["Papers/a.md"]);
  release();
  await settle();
  assert.deepEqual(s.view.all, ["Papers/a.md"]);
});

test("a load whose root list was read before the rename does not bring the old name back", async () => {
  const s = await mount({ "Docs/a.md": "" }, { open: ["Docs"] });
  const release = holdOnce(isRoot);
  s.view.load(s.cx);
  await settle();
  await act(s, "rename", "Docs", "dir", "Papers");
  release();
  await settle();
  assert.deepEqual(s.view.entries.get("").map((e) => e.name), ["Papers"]);
  assert.deepEqual([...s.view.folders], ["Papers"]);
  assert.deepEqual(s.view.entries.get("Papers").map((e) => e.name), ["a.md"]);
});

test("a load that started before a delete does not bring the item back (AC53)", async () => {
  const s = await mount({ "a.md": "", "b.md": "" });
  const release = holdOnce(isList);
  s.view.load(s.cx);
  await settle();
  await act(s, "delete", "a.md", "note");
  release();
  await settle();
  assert.deepEqual(s.view.all, ["b.md"]);
});

test("a load restarted by a rename keeps the watcher's list of changed paths", async () => {
  const s = await mount({ "a.md": "" });
  const seen = [], reindex = s.view.reindex;
  s.view.reindex = function (cx, changed) { seen.push(changed); return reindex.call(this, cx, changed); };
  const release = holdOnce(isRoot);
  const changed = [`${VAULT}/a.md`];
  s.view.load(s.cx, changed);
  await settle();
  await act(s, "rename", "a.md", "note", "b.md");
  release();
  await settle();
  assert.ok(seen.includes(changed), "the restarted load passes the list on");
});

test("a read that started before the rename does not open a note at the dead path", async () => {
  const s = await mount({ "Docs/a.md": "text" });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  state.readTextFile = async (path) => {
    const text = await realRead(path);
    if (path === `${VAULT}/Docs/a.md`) await held;
    return text;
  };
  s.view.open("Docs/a.md", s.cx);
  await settle();
  state.readTextFile = realRead;
  await act(s, "rename", "Docs", "dir", "Papers");
  release();
  await settle();
  assert.equal(s.view.note, null);
  assert.equal(s.view.editor ?? null, null);
  assert.deepEqual(recents(), []);
});

test("a read that started before a delete does not open the deleted note", async () => {
  const s = await mount({ "a.md": "text" });
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  state.readTextFile = async (path) => {
    const text = await realRead(path);
    if (path === `${VAULT}/a.md`) await held;
    return text;
  };
  s.view.open("a.md", s.cx);
  await settle();
  state.readTextFile = realRead;
  await act(s, "delete", "a.md", "note");
  release();
  await settle();
  assert.equal(s.view.note, null);
});

// ---- A vault switch

// Runs `change` at the first sleep: consume()'s tick between the render that read the request and its work.
function atNextTick(s, change) {
  s.cx.sleep = async () => {
    s.cx.sleep = async () => {};
    change();
  };
}

for (const [op, path, kind, name] of [["delete", "x.md", "note"], ["rename", "x.md", "note", "y.md"], ["new-note", "", "root"], ["new-folder", "", "root", "Made"]]) {
  test(`a vault switch in the tick before a ${op} drops it with a message, and the other vault's same path stays (AC62)`, async () => {
    const s = await mount({ "x.md": "mine" });
    disk.dirs.add(NEXT);
    state.files[`${NEXT}/x.md`] = "theirs";
    atNextTick(s, () => s.view.setVault(NEXT, s.cx));
    await act(s, op, path, kind, name);
    assert.deepEqual(disk.ops, []);
    assert.deepEqual(Object.keys(state.files).filter((p) => p.startsWith(`${NEXT}/`)), [`${NEXT}/x.md`]);
    assert.equal(state.files[`${NEXT}/x.md`], "theirs");
    assert.equal(state.files[`${VAULT}/x.md`], "mine");
    assert.equal(state.toasts.length, 1);
    assert.equal(state.toasts[0].level, "warning");
    assert.match(state.toasts[0].title, /vault/);
  });
}

// The held check is the last wait before the work, so the switch lands in the pre-checks, not in the tick before.
test("a vault switch during a rename's pre-checks drops it with a message and the disk does not change", async () => {
  const s = await mount({ "x.md": "mine" });
  disk.dirs.add(NEXT);
  const release = holdOnce((cmd, args) => cmd === "find" && args.includes("-iname"));
  await act(s, "rename", "x.md", "note", "y.md");
  s.view.setVault(NEXT, s.cx);
  await settle();
  release();
  await settle();
  assert.deepEqual(disk.ops, []);
  assert.equal(state.files[`${VAULT}/x.md`], "mine");
  assert.ok(!(`${VAULT}/y.md` in state.files));
  assert.equal(state.toasts.length, 1);
  assert.equal(state.toasts[0].level, "warning");
  assert.match(state.toasts[0].title, /Nothing changed/);
  assert.equal(s.view.actions.busy, false);
});

test("a vault switch during a delete's pre-check drops it with a message and the disk does not change", async () => {
  const s = await mount({ "x.md": "mine" });
  disk.dirs.add(NEXT);
  const release = holdOnce((cmd, args) => cmd === "sh" && args[3] === `${VAULT}/x.md`);
  await act(s, "delete", "x.md", "note");
  s.view.setVault(NEXT, s.cx);
  await settle();
  release();
  await settle();
  assert.deepEqual(disk.ops, []);
  assert.equal(state.files[`${VAULT}/x.md`], "mine");
  assert.equal(state.toasts.length, 1);
  assert.equal(state.toasts[0].level, "warning");
  assert.match(state.toasts[0].title, /Nothing changed/);
  assert.equal(s.view.actions.busy, false);
});

const stored = (vault) => JSON.parse(localStorage.getItem(`recent:${vault}`) ?? "[]");
const isTrash = (cmd) => cmd === "/usr/bin/trash";
const isMove = (cmd, args) => cmd === "sh" && args[1].includes("/bin/mv -n");

test("a vault switch during a delete: the old vault's stored recents lose the path, and the new vault's stay", async () => {
  const s = await mount({ "a.md": "", "b.md": "" });
  await openNote(s, "a.md");
  await openNote(s, "b.md");
  disk.dirs.add(NEXT);
  localStorage.setItem(`recent:${NEXT}`, JSON.stringify(["a.md"]));
  const release = holdOnce(isTrash);
  await act(s, "delete", "a.md", "note");
  s.view.setVault(NEXT, s.cx);
  await settle();
  release();
  await settle();
  assert.deepEqual(stored(VAULT), ["b.md"]);
  assert.deepEqual(stored(NEXT), ["a.md"]);
  assert.deepEqual(s.view.recent, ["a.md"]);
});

test("a vault switch during a rename: the old vault's stored recents follow the move, and the new vault's stay", async () => {
  const s = await mount({ "Old/a.md": "", "Olden/b.md": "" });
  await openNote(s, "Olden/b.md");
  await openNote(s, "Old/a.md");
  s.view.close();
  disk.dirs.add(NEXT);
  localStorage.setItem(`recent:${NEXT}`, JSON.stringify(["Old/a.md"]));
  const release = holdOnce(isMove);
  await act(s, "rename", "Old", "dir", "New");
  s.view.setVault(NEXT, s.cx);
  await settle();
  release();
  await settle();
  assert.deepEqual(stored(VAULT), ["New/a.md", "Olden/b.md"]);
  assert.deepEqual(stored(NEXT), ["Old/a.md"]);
  assert.deepEqual(s.view.recent, ["Old/a.md"]);
});

test("a throw after the trash does not leave the view busy or moving", async () => {
  const s = await mount({ "a.md": "", "b.md": "" });
  s.view.load = () => { throw new Error("cannot load"); };
  await act(s, "delete", "a.md", "note");
  assert.ok(!on(`${VAULT}/a.md`));
  assert.equal(s.view.actions.busy, false);
  assert.equal(s.view.moving, false);
});

// ---- A save that crosses a rename

// A dirty open note, and a hook that holds the host's call for that path until release().
async function dirtyOpen() {
  const s = await mount({ "Docs/a.md": "text" });
  await openNote(s, "Docs/a.md", "edit");
  typeInto(s, "typed");
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  return { s, old: `${VAULT}/Docs/a.md`, held, release };
}

test("a forced save whose read ends after a rename writes nothing, so the file cannot come back at the old path", async () => {
  const { s, old, held, release } = await dirtyOpen();
  state.readTextFile = async (path) => {
    if (path === old) await held;
    return realRead(path);
  };
  s.view.save(true, s.cx);
  await settle();
  await act(s, "rename", "Docs", "dir", "Papers");
  release();
  await settle();
  assert.ok(!on(old), "no file at the old path");
  assert.equal(state.files[`${VAULT}/Papers/a.md`], "text");
  assert.deepEqual([s.view.note, s.view.editor.value(), s.view.dirty], ["Papers/a.md", "typed", true]);
  assert.ok(titles().some((t) => /moving/.test(t)));
});

test("a forced save whose read ends during the move writes nothing, before the view knows the new path", async () => {
  const { s, old, held, release } = await dirtyOpen();
  state.readTextFile = async (path) => {
    if (path === old) await held;
    return realRead(path);
  };
  s.view.save(true, s.cx);
  await settle();
  const moved = holdOnce(isMove);
  await act(s, "rename", "Docs", "dir", "Papers");
  assert.equal(s.view.moving, true);
  release();
  await settle();
  assert.ok(!on(old), "no file at the old path");
  moved();
  await settle();
  assert.ok(!on(old));
  assert.deepEqual([s.view.note, s.view.editor.value(), s.view.dirty], ["Papers/a.md", "typed", true]);
  assert.ok(titles().some((t) => /moving/.test(t)));
});

test("a save rejected because the note moved while it ran says so, and the note stays dirty with its text", async () => {
  const { s, old, held, release } = await dirtyOpen();
  state.writeTextFile = async (...args) => {
    if (args[0] === old) await held;
    return realWrite(...args);
  };
  s.view.save(false, s.cx);
  await settle();
  await act(s, "rename", "Docs", "dir", "Papers");
  state.toasts.length = 0;
  release();
  await settle();
  assert.deepEqual(titles().filter((t) => /moved/.test(t)).length, 1);
  assert.deepEqual([s.view.note, s.view.editor.value(), s.view.dirty], ["Papers/a.md", "typed", true]);
  assert.equal(state.files[`${VAULT}/Papers/a.md`], "text");
  assert.ok(!on(old));
});

test("a save that landed before the move counts as saved at the new path, with no later false conflict", async () => {
  const { s, old, held, release } = await dirtyOpen();
  state.writeTextFile = async (...args) => {
    await realWrite(...args);
    if (args[0] === old) await held;
  };
  s.view.save(false, s.cx);
  await settle();
  await act(s, "rename", "Docs", "dir", "Papers");
  release();
  await settle();
  assert.equal(state.files[`${VAULT}/Papers/a.md`], "typed");
  assert.deepEqual([s.view.note, s.view.dirty, s.view.loaded], ["Papers/a.md", false, "typed"]);
  assert.equal(s.view.conflict, false);
});

test("a save rejected for a closed note says nothing about a move", async () => {
  const { s, old, held, release } = await dirtyOpen();
  state.writeTextFile = async (...args) => {
    if (args[0] === old) await held;
    throw new Error("disk full");
  };
  s.view.save(false, s.cx);
  await settle();
  s.view.close();
  release();
  await settle();
  assert.deepEqual(titles().filter((t) => /moved/.test(t)), []);
});
