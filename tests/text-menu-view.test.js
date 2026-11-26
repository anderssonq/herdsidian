// The right-click menu on text: the popup (TextMenu), the Notes controller (TextMenus), and the right-clicks of the
// Changes diff and the Files preview that open it.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mount, fakeGit, fakeFiles, reset, world, state, during, findById, walk, settle, fakeCx } from "./support/changes-kit.js";

const { TextMenu } = await import("../mods/herdsidian/text-menu-view.js");
const { TextMenus } = await import("../mods/herdsidian/text-menu-main.js");
const { TEXT_ACTION_KEY, textMenuItems, editorMenu } = await import("../mods/herdsidian/text-menu.js");

const ROOT = "/work/repo";
const THEME = { foreground: "#eeeeee", background: "#111111", chrome: "#222222", canvas: "#333333", raised: "#2a2a2a", accent: "#ff00aa",
  muted: "#999999", dim: "#555555", hover: "#444444", blocked: "#ffaa00", ansi1: "#ff0001", ansi2: "#00ff02", border: "#333333", popover: "#222222" };

beforeEach(() => { reset(); state.closed = []; state.overlays = []; state.toasts = []; state.runs = []; state.props = {}; });

const patch = (path, ...body) => [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`, ...body, ""].join("\n");

async function until(fn, what) {
  for (let i = 0; i < 100; i++) {
    const value = fn();
    if (value) return value;
    await settle();
  }
  return assert.fail(`timed out waiting for ${what}`);
}

// A Changes tab with one file's diff open; `opened` records every model the host's textMenu gets.
async function openDiff({ stat, nums, path, body }) {
  Object.assign(world, { spaces: [{ id: "s1", active: true, folder: ROOT }], panes: [{ pane: "p1", cwd: ROOT }], focused: { pane: "p1" } });
  state.shared["herdsidian.sidebar"] = { tab: "changes" };
  fakeGit({ status: stat, numstat: nums, patches: { [path]: body } });
  fakeFiles({});
  const m = mount({ theme: THEME });
  const opened = [];
  m.host.textMenu = (event, cx, model) => opened.push(model);
  m.render();
  const list = await until(() => { const t = m.render(); return findById(t, `change-${path}`) && t; }, "the list");
  m.resize(list, 400);
  m.click(findById(m.render(), `change-${path}`));
  const tree = await until(() => { const t = m.render(); return findById(t, "diff-code") && t; }, "the diff");
  return { m, tree, opened };
}

const rightClickRow = (m, tree, key, event = { local_position: { x: 10, y: 4 }, bounds: { width: 400, height: 20 } }) => {
  const list = walk(tree).find((n) => n.kind === "vlist");
  const handler = list.calls.find(([n]) => n === "on_item_secondary_click")[1][0];
  during(m.cx, (c) => handler(String(key), event, c));
};

// Changes diff
test("a right-click on a diff line opens the diff menu for that line", async () => {
  const s = await openDiff({ stat: "## main\0 M src/a.js\0", nums: "1\t1\tsrc/a.js\0", path: "src/a.js",
    body: patch("src/a.js", "@@ -1,3 +1,3 @@", " keep", "-old line", "+new line", " tail") });
  // Unified rows: the hunk title, keep, old line, new line, tail.
  rightClickRow(s.m, s.tree, 3);
  assert.equal(s.opened.length, 1);
  const model = s.opened[0];
  assert.equal(model.texts["copy-line"], "new line");
  assert.equal(model.texts["copy-ref"], "src/a.js:2");
  assert.equal(model.texts["copy-path"], `${ROOT}/src/a.js`);
  assert.ok(model.texts["copy-hunk"].includes("@@ -1,3 +1,3 @@\n keep\n-old line\n+new line\n tail"));
  assert.deepEqual(model.target, { surface: "diff", root: ROOT, path: "src/a.js" });
  assert.ok(model.items.some((r) => r.id === "open-files" && !r.disabled));
});

test("the rename banner is not a row: keys after it are shifted, the banner itself opens nothing", async () => {
  const s = await openDiff({ stat: "## main\0R  new.txt\0old.txt\0", nums: "1\t0\t\0old.txt\0new.txt\0", path: "new.txt",
    body: patch("new.txt", "@@ -1 +1,2 @@", " same", "+more") });
  rightClickRow(s.m, s.tree, 0);
  assert.equal(s.opened.length, 0, "the banner");
  rightClickRow(s.m, s.tree, 3);
  assert.equal(s.opened[0].texts["copy-line"], "more");
  assert.ok(s.opened[0].texts["copy-hunk"].startsWith("--- a/old.txt\n+++ b/new.txt"));
});

// Files preview
test("a right-click on the Files preview opens the file menu with path:line", () => {
  const m = mount({ theme: THEME });
  const opened = [];
  m.host.textMenu = (event, cx, model) => opened.push(model);
  Object.assign(m.files, { root: ROOT, file: "src/a.ts", full: null,
    code: { value: () => "l1\nl2\nl3", selected_range: () => ({ start: 3, end: 5 }) } });
  during(m.cx, (c) => m.files.menu({ position: { x: 1, y: 1 } }, c));
  const model = opened[0];
  assert.equal(model.texts["copy-ref"], "src/a.ts:2");
  assert.equal(model.texts["copy-rel"], "src/a.ts");
  assert.equal(model.texts["copy-path"], `${ROOT}/src/a.ts`);
  assert.equal(model.texts.send, "src/a.ts:2\n```ts\nl2\n```");
  assert.deepEqual(model.target, { surface: "file", root: ROOT, file: "src/a.ts", full: null });
});

// The popup
const popup = (model) => {
  state.props = { overlay: "o1", textMenu: model };
  const cx = fakeCx();
  const menu = new TextMenu(cx);
  return { cx, menu, tree: menu.render() };
};

test("a copy row writes its text and closes; no request", () => {
  const model = editorMenu({ surface: "file", value: "abc", range: { start: 0, end: 3 }, path: "/r/a", rel: "a" });
  const { cx, tree } = popup({ ...model, target: { surface: "file", file: "a", full: null } });
  findById(tree, "text-menu-copy-ref").onClick({}, cx);
  assert.deepEqual(cx.clipboard, ["a:1"]);
  assert.deepEqual(state.closed, ["o1"]);
  assert.equal(state.shared[TEXT_ACTION_KEY], undefined);
});

test("Cut and Send copy here; the request carries no text (shared() is saved to disk)", () => {
  const model = editorMenu({ surface: "edit", value: "one two", range: { start: 4, end: 7 }, path: "/v/n.md" });
  const target = { surface: "edit", note: "n.md", range: { start: 4, end: 7 }, length: 7 };
  const first = popup({ ...model, target });
  findById(first.tree, "text-menu-cut").onClick({}, first.cx);
  assert.deepEqual(first.cx.clipboard, ["two"]);
  const request = state.shared[TEXT_ACTION_KEY];
  assert.equal(request.op, "cut");
  assert.deepEqual(request.target, target);
  assert.ok(Number.isFinite(request.at) && typeof request.id === "string");
  assert.deepEqual(Object.keys(request).sort(), ["at", "id", "op", "target"]);
  const second = popup({ ...model, target });
  findById(second.tree, "text-menu-send").onClick({}, second.cx);
  assert.deepEqual(second.cx.clipboard, ["From /v/n.md:1:\n\ntwo"]);
  const sent = state.shared[TEXT_ACTION_KEY];
  assert.equal(sent.op, "send");
  assert.equal(JSON.stringify(sent).includes("two"), false, "no selection text in the store");
  assert.notEqual(sent.id, request.id);
});

test("a disabled row has no click; Escape closes; a second click does nothing", () => {
  const { cx, menu, tree } = popup({ items: textMenuItems("read", ["copy-path"]), texts: { "copy-path": "/v/n.md" }, target: null });
  assert.equal(findById(tree, "text-menu-copy").onClick, null);
  const stops = [];
  menu.key({ key: "escape" }, { ...cx, stop_propagation: () => stops.push(1) });
  assert.deepEqual(state.closed, ["o1"]);
  assert.equal(stops.length, 1);
  findById(tree, "text-menu-copy-path").onClick({}, cx);
  assert.deepEqual(cx.clipboard, [], "closed already");
});

// The Notes controller
function editorStub(value, range = { start: 0, end: 0 }) {
  const calls = [];
  return {
    calls,
    value: () => value,
    selected_range: () => range,
    replace: (text) => { calls.push(["replace", text]); },
    set_selected_range: (r) => { calls.push(["set_selected_range", r]); },
    focus: () => { calls.push(["focus"]); },
  };
}

const notesView = (extra = {}) => ({ note: "n.md", mode: "edit", editor: editorStub("hello world"), filesTab: null, setMode(m) { this.mode = m; }, ...extra });
const post = (op, target, extra = {}) => { state.shared[TEXT_ACTION_KEY] = { id: `r-${op}-${Math.random()}`, at: Date.now(), op, target, ...extra }; };

// fakeCx's sleep never resolves (timers are a test's choice); consume() waits one tick before it runs.
const tickCx = () => Object.assign(fakeCx(), { sleep: () => Promise.resolve() });
// The popup copied the text before the request (Cut, Send): these cx read it back.
const clipCx = (text) => Object.assign(tickCx(), { read_from_clipboard: () => text });

async function consume(menus, cx = tickCx()) {
  menus.consume(cx);
  await settle();
  return cx;
}

test("a request found at start never runs", async () => {
  post("select-all", { surface: "edit", note: "n.md" });
  const view = notesView();
  const menus = new TextMenus(view);
  await consume(menus);
  assert.deepEqual(view.editor.calls, []);
});

test("Paste puts the clipboard into the note editor; Select all selects everything; both give the keyboard back", async () => {
  const view = notesView(), menus = new TextMenus(view);
  post("paste", { surface: "edit", note: "n.md" });
  const cx = tickCx();
  cx.read_from_clipboard = () => "pasted";
  await consume(menus, cx);
  assert.deepEqual(view.editor.calls, [["replace", "pasted"], ["focus"]]);
  post("select-all", { surface: "edit", note: "n.md" });
  await consume(menus);
  assert.deepEqual(view.editor.calls.slice(2), [["set_selected_range", { start: 0, end: 11 }], ["focus"]]);
  // Each request runs once.
  await consume(menus);
  assert.equal(view.editor.calls.length, 4);
});

test("Cut removes the range the popup copied; a changed note or one no longer in edit mode is left alone, and says so", async () => {
  const view = notesView(), menus = new TextMenus(view);
  const range = { start: 6, end: 11 };
  // The popup copied "world" (the range of "hello world") before the request.
  post("cut", { surface: "edit", note: "n.md", range, length: 11 });
  await consume(menus, clipCx("world"));
  assert.deepEqual(view.editor.calls, [["set_selected_range", range], ["replace", ""], ["focus"]]);
  post("cut", { surface: "edit", note: "n.md", range, length: 12 });
  await consume(menus, clipCx("world"));
  assert.equal(view.editor.calls.length, 3, "the note's length changed since the menu opened");
  post("cut", { surface: "edit", note: "n.md", range, length: 11 });
  await consume(menus, clipCx("worlD"));
  assert.equal(view.editor.calls.length, 3, "same length, other text: an outside write is not deleted");
  view.mode = "read";
  post("cut", { surface: "edit", note: "n.md", range, length: 11 });
  await consume(menus, clipCx("world"));
  assert.equal(view.editor.calls.length, 3);
  assert.equal(state.toasts.filter((t) => /note changed since the menu opened/.test(t.title)).length, 2, "length, then text");
  assert.equal(state.toasts.filter((t) => /no longer open/.test(t.title)).length, 1, "not in edit mode");
});

test("Select all in the Files preview acts only on the file the menu was opened on", async () => {
  const code = editorStub("abc");
  const view = notesView({ filesTab: { root: ROOT, file: "a.js", full: null, code } }), menus = new TextMenus(view);
  post("select-all", { surface: "file", root: ROOT, file: "b.js", full: null });
  await consume(menus);
  post("select-all", { surface: "file", root: "/other/repo", file: "a.js", full: null });
  await consume(menus);
  assert.deepEqual(code.calls, [], "another file, then the same file in another folder");
  post("select-all", { surface: "file", root: ROOT, file: "a.js", full: null });
  await consume(menus);
  assert.deepEqual(code.calls, [["set_selected_range", { start: 0, end: 3 }], ["focus"]]);
});

test("Edit note switches the open note to edit; Open in Files opens the diff's file", async () => {
  const opens = [];
  const view = notesView({ mode: "read", tabBody: () => ({ open: (root, path) => opens.push([root, path]) }) }), menus = new TextMenus(view);
  post("edit", { surface: "read", note: "other.md" });
  await consume(menus);
  assert.equal(view.mode, "read", "another note");
  post("edit", { surface: "read", note: "n.md" });
  await consume(menus);
  assert.equal(view.mode, "edit");
  post("open-files", { surface: "diff", root: ROOT, path: "src/a.js" });
  await consume(menus);
  assert.deepEqual(opens, [[ROOT, "src/a.js"]]);
});

test("Send with no agent focused leaves the text copied and says how to paste it", async () => {
  const view = notesView({ scene: () => ({ agent: null }) }), menus = new TextMenus(view);
  post("send", { surface: "edit", note: "n.md" });
  const cx = await consume(menus, clipCx("From x:\n\nhi"));
  assert.deepEqual(cx.clipboard, [], "nothing written over it");
  assert.ok(state.toasts.some((t) => /No agent focused/.test(t.title)));
  assert.equal(state.runs.length, 0);
});

test("Send pastes the copied text into the focused agent through sendText, and never submits", async () => {
  const view = notesView({ scene: () => ({ agent: { address: "t1", program: { name: "Claude" } } }) }), menus = new TextMenus(view);
  post("send", { surface: "edit", note: "n.md" });
  const cx = await consume(menus, clipCx("hi"));
  assert.deepEqual(cx.clipboard, ["hi"]);
  assert.ok(state.runs.some(([name, args]) => name === "pane.focus" && args.terminal === "t1"));
  assert.ok(!state.runs.some(([name]) => /submit|enter|send_keys/i.test(name)));
});

test("Send while another send runs says so and keeps the text copied", async () => {
  const view = notesView({ sending: true, scene: () => ({ agent: { address: "t1", program: { name: "Claude" } } }) }), menus = new TextMenus(view);
  post("send", { surface: "edit", note: "n.md" });
  await consume(menus, clipCx("hi"));
  assert.ok(state.toasts.some((t) => /Wait for the current send/.test(t.title)));
  assert.equal(state.runs.length, 0);
});

test("open() places the popup at the pointer with the menu's own size", () => {
  const menus = new TextMenus(notesView());
  state.viewport = { width: 1440, height: 900 };
  const model = { items: textMenuItems("read", []), texts: {}, target: null };
  menus.open({ position: { x: 100, y: 120 } }, fakeCx(), model);
  const o = state.overlays.at(-1).spec;
  assert.deepEqual(o.at, { x: 100, y: 120 });
  assert.equal(o.kind, "popup");
  assert.deepEqual(o.props.textMenu, model);
  state.viewport = null;
  const before = state.overlays.length;
  menus.open({ position: { x: 1, y: 1 } }, fakeCx(), { items: [], texts: {}, target: null });
  assert.equal(state.overlays.length, before, "an empty menu opens nothing");
});
