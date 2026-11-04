// The tree's right-click surfaces: the menu, the name prompt and the delete confirmation (AC5, AC12, AC13,
// AC18, AC20, AC47, AC48). VaultSurface is rendered directly, as Notes.init will do for its overlay copy.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, findById, walk, settle } from "./support/mod-stubs.js";
import { during } from "./support/live-cx.js";

const { VaultSurface, PROMPT, CONFIRM } = await import("../mods/herdsidian/actions-view.js");
const { ACTION_KEY, menuSize } =await import("../mods/herdsidian/actions.js");

const VAULT = "/vault";
const ID = "overlay-x";
const OK = { stderr: "", code: 0 };

beforeEach(() => {
  Object.assign(state, { shared: {}, runs: [], toasts: [], overlays: [], closed: [], props: {} });
  state.exec = async () => ({ stdout: "", ...OK });
});

// A `find -print0` answer for the names in a folder, or a failure.
const finds = (names) => async () => ({ stdout: names.map((n) => `${VAULT}/${n}\0`).join(""), ...OK });

// Opens a surface as Notes would: props set, then constructed. As in the app, each host call has its own cx:
// the constructor's, each render's and each handler's die when that call returns. handle() is one handler call.
function open(surface, op, target) {
  state.props = { overlay: ID, vaultSurface: surface, vault: VAULT, op, target };
  const cx = fakeCx();
  const view = during(cx, (live) => new VaultSurface(live));
  return { view, tree: () => during(cx, (live) => view.render(live)), handle: (fn) => during(cx, fn) };
}
const menu = (kind, path = "") => open("menu", undefined, { path, kind });
const prompt = (op, target) => open("prompt", op, target);
const confirm = (target) => open("confirm", "delete", target);

const text = (node) => node.kids.filter((k) => typeof k === "string").join("");
const message = (s) => text(findById(s.tree(), "vault-prompt-message"));
const call = (node, name) => node.calls.find(([n]) => n === name)?.[1];
const press = (s, id) => {
  const node = findById(s.tree(), id);
  return s.handle((cx) => node.onClick({}, cx));
};
const keyDown = (s, key) => {
  const [handler] = call(s.tree(), "on_key_down");
  return s.handle((cx) => handler({ key }, cx));
};
const esc = (s) => keyDown(s, "escape");
const fire = (s, name) => s.handle((cx) => s.view.input.fire(name, {}, cx));
const typeName = (s, value) => s.view.input.set_value(value);
const sent = () => state.shared[ACTION_KEY];
const labels = (s) => walk(s.tree()).filter((n) => n.nodeId?.startsWith("vault-menu-")).map((n) => text(n));

test("the menu has the rows of each target kind", () => {
  assert.deepEqual(labels(menu("dir", "a")), ["New note", "New folder", "Rename", "Delete"]);
  assert.deepEqual(labels(menu("note", "a/b.md")), ["Rename", "Delete"]);
  assert.deepEqual(labels(menu("root")), ["New note", "New folder"]);
});

test("every surface root has an explicit width and height and never size_full", () => {
  const roots = [
    [menu("dir", "a"), menuSize("dir")],
    [menu("root"), menuSize("root")],
    [prompt("new-folder", { path: "", kind: "root" }), PROMPT],
    [confirm({ path: "a", kind: "dir" }), CONFIRM],
  ];
  for (const [s, size] of roots) {
    const root = s.tree();
    assert.deepEqual(call(root, "w"), [size.width]);
    assert.deepEqual(call(root, "h"), [size.height]);
    for (const name of ["size_full", "w_full", "h_full"]) assert.equal(call(root, name), undefined, name);
  }
  assert.deepEqual(menuSize("dir"), { width: 180, height: 130 });
});

test("Esc closes each surface and sends nothing (AC5, AC12, AC47)", () => {
  for (const s of [menu("dir", "a"), prompt("rename", { path: "a", kind: "dir" }), confirm({ path: "a", kind: "dir" })]) {
    esc(s);
  }
  assert.deepEqual(state.closed, [ID, ID, ID]);
  assert.equal(sent(), undefined);
  assert.deepEqual(state.runs, []);
});

test("Cancel closes the prompt and the confirm and sends nothing (AC12, AC47)", () => {
  press(prompt("new-folder", { path: "", kind: "root" }), "vault-prompt-cancel");
  press(confirm({ path: "a", kind: "dir" }), "vault-confirm-cancel");
  assert.deepEqual(state.closed, [ID, ID]);
  assert.equal(sent(), undefined);
  assert.deepEqual(state.runs, []);
});

test("New note sends one request and closes", () => {
  const s = menu("dir", "notes");
  press(s, "vault-menu-new-note");
  press(s, "vault-menu-new-note");
  const request = sent();
  assert.deepEqual({ ...request, id: undefined, at: undefined }, { id: undefined, at: undefined, vault: VAULT, op: "new-note", path: "notes", kind: "dir" });
  assert.equal(typeof request.id, "string");
  assert.equal(typeof request.at, "number");
  assert.deepEqual(state.runs, [["layout.show", { id: "herdsidian" }]]);
  assert.deepEqual(state.closed, [ID]);
  assert.deepEqual(state.overlays, []);
});

test("New folder, Rename and Delete close the menu and open a dialog copy", () => {
  const target = { path: "notes", kind: "dir" };
  press(menu("dir", "notes"), "vault-menu-new-folder");
  press(menu("dir", "notes"), "vault-menu-rename");
  press(menu("dir", "notes"), "vault-menu-delete");
  assert.deepEqual(state.closed, [ID, ID, ID]);
  assert.equal(sent(), undefined);
  const [folder, rename, remove] = state.overlays.map((o) => o.spec);
  const common = { mod: "herdsidian", kind: "dialog", frame: "none" };
  assert.deepEqual(folder, { ...common, ...PROMPT, props: { vaultSurface: "prompt", vault: VAULT, target, op: "new-folder" } });
  assert.deepEqual(rename, { ...common, ...PROMPT, props: { vaultSurface: "prompt", vault: VAULT, target, op: "rename" } });
  assert.deepEqual(remove, { ...common, ...CONFIRM, props: { vaultSurface: "confirm", vault: VAULT, target, op: "delete" } });
});

test("each refused name keeps the dialog open and sends nothing (AC13)", async () => {
  const bad = ["", "   ", "a/b", ".", "..", ".hidden", "node_modules", "a\u0007b"];
  for (const name of bad) {
    const s = prompt("new-folder", { path: "", kind: "root" });
    typeName(s, name);
    press(s, "vault-prompt-save");
    await settle();
    assert.notEqual(message(s), "", JSON.stringify(name));
  }
  assert.equal(sent(), undefined);
  assert.deepEqual(state.closed, []);
  assert.deepEqual(state.runs, []);
});

test("a rename is refused too, and the message clears on the next edit (AC13)", () => {
  const s = prompt("rename", { path: "a/b.md", kind: "note" });
  typeName(s, "x/y");
  press(s, "vault-prompt-save");
  assert.match(message(s), /\//);
  fire(s, "change");
  assert.equal(message(s), "");
  assert.equal(sent(), undefined);
});

test("a name taken on disk is refused, ignoring case and files the tree hides (AC18)", async () => {
  const calls = [];
  state.exec = async (cmd, args) => { calls.push([cmd, args]); return finds(["Photo.png", "Other"])(); };
  const s = prompt("new-folder", { path: "pics", kind: "dir" });
  typeName(s, "photo.PNG");
  press(s, "vault-prompt-save");
  await settle();
  assert.match(message(s), /photo\.PNG.*already exists/);
  assert.equal(sent(), undefined);
  assert.deepEqual(state.closed, []);
  assert.deepEqual(calls[0], ["find", ["-H", `${VAULT}/pics`, "-mindepth", "1", "-maxdepth", "1", "-print0"]]);
});

test("a rename to a taken name in the parent folder is refused (AC18)", async () => {
  const listing = finds(["a/Taken.md", "a/Mine.md"]);
  state.exec = async (cmd, args) => (args[1] === `${VAULT}/a` ? listing() : { stdout: "", code: 1, stderr: "wrong folder" });
  const s = prompt("rename", { path: "a/Mine.md", kind: "note" });
  typeName(s, "taken");
  press(s, "vault-prompt-save");
  await settle();
  assert.match(message(s), /"taken\.md" already exists/);
  assert.equal(sent(), undefined);
});

test("the same name closes with no request and no message (AC20)", async () => {
  const cases = [["a/Foo.md", "note", "Foo"], ["a/Foo.md", "note", " Foo.md "], ["a/Dir", "dir", "Dir"], ["a/.foo", "dir", ".foo"]];
  for (const [path, kind, name] of cases) {
    const s = prompt("rename", { path, kind });
    typeName(s, name);
    press(s, "vault-prompt-save");
    await settle();
    assert.equal(message(s), "", path);
  }
  assert.deepEqual(state.closed, [ID, ID, ID, ID]);
  assert.equal(sent(), undefined);
  assert.deepEqual(state.runs, []);
});

test("a valid new folder name sends one request with the trimmed name", async () => {
  const s = prompt("new-folder", { path: "notes", kind: "dir" });
  typeName(s, "  Ideas ");
  press(s, "vault-prompt-save");
  press(s, "vault-prompt-save"); // a second submit while the check runs does nothing
  fire(s, "submit");
  await settle();
  assert.equal(state.runs.length, 1);
  assert.equal(sent().name, "Ideas");
  assert.equal(sent().op, "new-folder");
  assert.equal(sent().path, "notes");
  assert.equal(sent().kind, "dir");
  assert.equal(sent().vault, VAULT);
  assert.deepEqual(state.runs, [["layout.show", { id: "herdsidian" }]]);
  assert.deepEqual(state.closed, [ID]);
});

test("a note rename sends the final file name from noteFileName (AC16)", async () => {
  const s = prompt("rename", { path: "a/Foo.md", kind: "note" });
  assert.equal(s.view.input.value(), "Foo");
  typeName(s, "Bar");
  fire(s, "submit");
  await settle();
  assert.deepEqual({ ...sent(), id: undefined, at: undefined }, { id: undefined, at: undefined, vault: VAULT, op: "rename", path: "a/Foo.md", kind: "note", name: "Bar.md" });
});

test("a typed .md is not doubled, and a case-only rename is not taken by itself", async () => {
  state.exec = async () => ({ stdout: `${VAULT}/a/Foo.md\0`, ...OK });
  const s = prompt("rename", { path: "a/Foo.md", kind: "note" });
  typeName(s, "foo.md");
  fire(s, "submit");
  await settle();
  assert.equal(sent().name, "foo.md");
});

test("the prompt starts with the name selected and refocuses itself", () => {
  const timers = [];
  state.props = { overlay: ID, vaultSurface: "prompt", vault: VAULT, op: "rename", target: { path: "a/Foo.md", kind: "note" } };
  const cx = fakeCx();
  cx.timer.after = (ms, fn) => timers.push([ms, fn]);
  const view = new VaultSurface(cx);
  assert.ok(view.input.calls.some(([n, r]) => n === "set_selected_range" && r.start === 0 && r.end === 3));
  assert.equal(timers[0][0], 600);
  const before = view.input.calls.filter(([n]) => n === "focus").length;
  timers[0][1]();
  assert.equal(view.input.calls.filter(([n]) => n === "focus").length, before + 1);
  view.closed(cx);
  timers[0][1]();
  assert.equal(view.input.calls.filter(([n]) => n === "focus").length, before + 1);
});

test("a failed listing still sends the request, and Notes reports the failure", async () => {
  state.exec = async () => ({ stdout: "", stderr: "denied", code: 1 });
  const s = prompt("new-folder", { path: "", kind: "root" });
  typeName(s, "Ideas");
  press(s, "vault-prompt-save");
  await settle();
  assert.equal(sent().name, "Ideas");
  assert.equal(sent().path, "");
});

test("closing while the check runs sends nothing", async () => {
  const s = prompt("new-folder", { path: "", kind: "root" });
  typeName(s, "Ideas");
  press(s, "vault-prompt-save");
  s.handle((cx) => s.view.closed(cx));
  await settle();
  assert.equal(sent(), undefined);
});

test("the delete text for a note names it and says Trash (AC47)", () => {
  const s = confirm({ path: "a/Foo.md", kind: "note" });
  assert.equal(text(s.tree().kids[0].kids[0]), 'Delete "Foo.md"?');
  assert.equal(text(findById(s.tree(), "vault-confirm-detail")), '"Foo.md" It goes to the Trash.');
  assert.equal(findById(s.tree(), "vault-confirm-delete").kids[0], "Move to Trash");
  assert.equal(findById(s.tree(), "vault-confirm-cancel").kids[0], "Cancel");
});

test("a folder shows Counting, then the counts (AC48)", async () => {
  state.exec = async () => ({ stdout: ["Dir/a.md", "Dir/b.md", "Dir/pic.png"].map((p) => `${VAULT}/${p}\0`).join(""), ...OK });
  const s = confirm({ path: "Dir", kind: "dir" });
  assert.equal(text(findById(s.tree(), "vault-confirm-detail")), "Counting…");
  await settle();
  assert.equal(text(findById(s.tree(), "vault-confirm-detail")), '"Dir" has 3 files, 1 not shown in the tree. It goes to the Trash.');
});

test("an empty folder is stated as empty (AC48)", async () => {
  const s = confirm({ path: "Dir", kind: "dir" });
  await settle();
  assert.equal(text(findById(s.tree(), "vault-confirm-detail")), '"Dir" is empty. It goes to the Trash.');
});

test("a failed count says it is not known and delete stays possible (AC48)", async () => {
  state.exec = async () => ({ stdout: "", stderr: "denied", code: 1 });
  const s = confirm({ path: "Dir", kind: "dir" });
  await settle();
  assert.match(text(findById(s.tree(), "vault-confirm-detail")), /not known/);
  press(s, "vault-confirm-delete");
  assert.equal(sent().op, "delete");
});

test("Move to Trash sends one delete request, even while counting", () => {
  const s = confirm({ path: "Dir", kind: "dir" });
  assert.equal(text(findById(s.tree(), "vault-confirm-detail")), "Counting…");
  press(s, "vault-confirm-delete");
  press(s, "vault-confirm-delete");
  assert.deepEqual({ ...sent(), id: undefined, at: undefined }, { id: undefined, at: undefined, vault: VAULT, op: "delete", path: "Dir", kind: "dir" });
  assert.deepEqual(state.runs, [["layout.show", { id: "herdsidian" }]]);
  assert.deepEqual(state.closed, [ID]);
});

test("a key other than Esc does nothing on the delete dialog", () => {
  const s = confirm({ path: "a/Foo.md", kind: "note" });
  keyDown(s, "return");
  assert.equal(sent(), undefined);
  assert.deepEqual(state.closed, []);
});

test("a context kept past its call throws, as in the real app", () => {
  let kept;
  during(fakeCx(), (cx) => { kept = cx; kept.notify(); });
  assert.throws(() => kept.notify(), /stale context: cx\.notify/);
});

test("the Save button runs on the click's context, because the render's is dead by then", async () => {
  const s = prompt("new-folder", { path: "", kind: "root" });
  const save = findById(s.tree(), "vault-prompt-save");
  typeName(s, "a/b");
  s.handle((cx) => save.onClick({}, cx));
  assert.match(message(s), /\//);
  typeName(s, "Ideas");
  s.handle((cx) => save.onClick({}, cx));
  await settle();
  assert.equal(sent().name, "Ideas");
});
