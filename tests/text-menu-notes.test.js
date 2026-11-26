// The right-click menu on the open note, read and edit mode, against the stubbed runtimes.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, settle, findById, walk, rightClick } from "./support/mod-stubs.js";

const { default: Notes } = await import("../mods/herdsidian/main.js");

const VAULT = "/vault/menu", NOTE = "n.md", PATH = `${VAULT}/${NOTE}`;
const TEXT = "Some **bold** text\n";

beforeEach(() => {
  state.shared = {}; state.runs = []; state.toasts = []; state.commands = []; state.files = {}; state.overlays = [];
  state.layout = { id: "root", children: [] };
  localStorage.removeItem("vault");
});

const open = async () => {
  localStorage.setItem("vault", VAULT);
  state.files[PATH] = TEXT;
  const view = new Notes(), cx = fakeCx();
  view.init({}, cx);
  await settle();
  view.open(NOTE, cx);
  await settle();
  assert.equal(view.note, NOTE);
  return { view, cx };
};

const lastMenu = () => state.overlays.at(-1)?.spec?.props?.textMenu;
const live = (items) => items.filter((r) => !r.sep && !r.disabled).map((r) => r.id).sort();
// The selection handler the read view's TextView registered.
const onSelection = (tree) => walk(tree).find((n) => n.kind === "text-view").calls.find(([n]) => n === "on_selection_change")[1][0];

test("read mode: the menu copies the selection, its Markdown and the path; it offers Edit", async () => {
  const { view, cx } = await open();
  let tree = view.render(cx);
  onSelection(tree)({ text: "bold", range: { start: 5, end: 13 } }, cx);
  tree = view.render(cx);
  rightClick(findById(tree, "notes-read-menu"), { position: { x: 10, y: 10 } }, cx);
  const menu = lastMenu();
  assert.equal(menu.texts.copy, "bold");
  assert.equal(menu.texts["copy-md"], view.preview.slice(5, 13));
  assert.equal(menu.texts["copy-path"], PATH);
  assert.deepEqual(menu.target, { surface: "read", note: NOTE });
  assert.deepEqual(live(menu.items), ["copy", "copy-md", "copy-path", "edit", "send"]);
});

test("read mode: a cleared selection, or one from another note, copies nothing", async () => {
  const { view, cx } = await open();
  const tree = view.render(cx);
  const select = onSelection(tree);
  select({ text: "bold" }, cx);
  select(null, cx);
  rightClick(findById(view.render(cx), "notes-read-menu"), { position: { x: 1, y: 1 } }, cx);
  assert.equal(lastMenu().texts.copy, undefined);
  select({ text: "bold" }, cx);
  view.readSel.note = "other.md";
  rightClick(findById(view.render(cx), "notes-read-menu"), { position: { x: 1, y: 1 } }, cx);
  assert.equal(lastMenu().texts.copy, undefined);
});

test("read mode: Edit and back, or the marks going, drop the old selection", async () => {
  const { view, cx } = await open();
  onSelection(view.render(cx))({ text: "bold" }, cx);
  view.setMode("edit"); view.setMode("read");
  rightClick(findById(view.render(cx), "notes-read-menu"), { position: { x: 1, y: 1 } }, cx);
  assert.equal(lastMenu().texts.copy, undefined, "after a mode switch");
  onSelection(view.render(cx))({ text: "bold" }, cx);
  view.clearMarks(cx);
  rightClick(findById(view.render(cx), "notes-read-menu"), { position: { x: 1, y: 1 } }, cx);
  assert.equal(lastMenu().texts.copy, undefined, "after the marks go");
});

test("edit mode: the editor's frame opens the edit menu with paste and select all", async () => {
  const { view, cx } = await open();
  view.setMode("edit");
  rightClick(findById(view.render(cx), "notes-edit"), { position: { x: 1, y: 1 } }, cx);
  const menu = lastMenu();
  // The stub editor reports no selection: the cursor at 0. Cut later checks the range and the length.
  assert.deepEqual(menu.target, { surface: "edit", note: NOTE, range: { start: 0, end: 0 }, length: TEXT.length });
  assert.deepEqual(live(menu.items), ["copy-path", "paste", "select-all"]);
});
