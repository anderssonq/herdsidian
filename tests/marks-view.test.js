// The Notes view with change marks, against the stubbed runtimes: when marks appear and go away,
// and the shape of the read view with and without marks.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, settle, findById, walk } from "./support/mod-stubs.js";

const { default: Notes } = await import("../mods/herdsidian/main.js");

const VAULT = "/vault/marks", NOTE = "n.md", PATH = `${VAULT}/${NOTE}`;
const TEXT = "# Title\n\nFirst\n\nSecond\n\nThird\n";

beforeEach(() => {
  state.shared = {}; state.runs = []; state.toasts = []; state.commands = []; state.files = {};
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

// An outside program writes the file; the watcher reports it.
const outside = async (view, cx, text) => {
  state.files[PATH] = text;
  view.refreshNote(cx, [PATH]);
  await settle();
};

const textViews = (tree) => walk(tree).filter((n) => n.kind === "text-view");
const reader = (view, cx) => findById(view.render(cx), "notes-read");
const handlers = (node) => node.calls.map(([name, args]) => (name === "on_mouse_down" || name === "on_mouse_up" ? `${name}:${args[0]}` : name));
const markedIds = (tree) => walk(tree).filter((n) => n.calls?.some(([name]) => name === "relative"))
  .flatMap((n) => textViews(n).map((v) => v.arg.id));

// AC23
test("without marks the read view is the one selectable TextView, as before", async () => {
  const { view, cx } = await open();
  const node = reader(view, cx);
  const views = textViews(node);
  assert.equal(views.length, 1);
  assert.equal(views[0].arg.id, `md-${NOTE}`);
  assert.equal(views[0].arg.markdown, "# Title\n\nFirst\n\nSecond\n\nThird\n");
  const names = views[0].calls.map(([name]) => name);
  assert.ok(names.includes("selectable") && names.includes("on_link_click"));
  assert.equal(handlers(node).some((h) => /^(on_scroll_wheel|on_key_down|on_mouse_down:.*|on_mouse_up:.*|track_focus)$/.test(h)), false);
});

// AC1
test("an outside change in read mode marks the changed block and splits the view", async () => {
  const { view, cx } = await open();
  await outside(view, cx, TEXT.replace("Second", "Second, edited"));
  const node = reader(view, cx);
  assert.deepEqual(textViews(node).map((v) => v.arg.id), [0, 1, 2, 3].map((i) => `md-${NOTE}-${i}`));
  assert.deepEqual(textViews(node).map((v) => v.arg.markdown), ["# Title", "First", "Second, edited", "Third"]);
  assert.deepEqual(markedIds(node), [`md-${NOTE}-2`]);
});

// AC2
test("saving from the editor records no mark", async () => {
  const { view, cx } = await open();
  view.setMode("edit");
  view.editor.set_value("# Title\n\nFirst\n\nSecond saved\n\nThird\n");
  view.dirty = true;
  view.save(false, cx);
  await settle();
  assert.equal(view.dirty, false);
  assert.equal(view.marks, null);
  view.setMode("read");
  // The file watcher then reports our own write: the text equals what was saved.
  view.refreshNote(cx, [PATH]);
  await settle();
  assert.equal(view.marks, null);
  assert.equal(textViews(reader(view, cx)).length, 1);
});

// AC3
test("a change in edit mode records no mark, also after switching to read", async () => {
  const { view, cx } = await open();
  view.setMode("edit");
  await outside(view, cx, TEXT.replace("First", "First!"));
  assert.equal(view.marks, null);
  view.setMode("read");
  assert.equal(view.marks, null);
  assert.equal(textViews(reader(view, cx)).length, 1);
  assert.match(textViews(reader(view, cx))[0].arg.markdown, /First!/);
});

// AC4
test("a change while the note has unsaved edits records no mark", async () => {
  const { view, cx } = await open();
  view.dirty = true;
  await outside(view, cx, TEXT.replace("First", "First!"));
  assert.equal(view.marks, null);
  assert.equal(view.loaded, TEXT);
});

// AC5
test("a second outside change diffs the same baseline; an undone change loses its mark", async () => {
  const { view, cx } = await open();
  await outside(view, cx, TEXT.replace("First", "First!"));
  assert.deepEqual(markedIds(reader(view, cx)), [`md-${NOTE}-1`]);
  await outside(view, cx, TEXT.replace("First", "First!").replace("Third", "Third!"));
  assert.deepEqual(markedIds(reader(view, cx)), [`md-${NOTE}-1`, `md-${NOTE}-3`]);
  await outside(view, cx, TEXT.replace("Third", "Third!"));
  assert.deepEqual(markedIds(reader(view, cx)), [`md-${NOTE}-3`]);
  await outside(view, cx, TEXT);
  assert.equal(view.marks, null);
  assert.equal(textViews(reader(view, cx)).length, 1);
});

// AC8, AC9, AC10 (what the handlers do; whether Herdr delivers them is a live check)
test("the marked read view listens for scroll, any mouse button and keys, and each clears the marks", async () => {
  for (const [name, args] of [["on_scroll_wheel", []], ["on_key_down", []], ["on_mouse_up", ["left"]], ["on_mouse_up", ["right"]], ["on_mouse_up", ["middle"]]]) {
    const { view, cx } = await open();
    await outside(view, cx, TEXT.replace("First", "First!"));
    const node = reader(view, cx);
    assert.ok(handlers(node).includes("track_focus"));
    const call = node.calls.find(([n, a]) => n === name && (!args.length || a[0] === args[0]));
    assert.ok(call, `${name} ${args}`);
    call[1].at(-1)({}, cx);
    assert.equal(view.marks, null, `${name} ${args}`);
    assert.equal(view.baseline, null);
    assert.equal(textViews(reader(view, cx)).length, 1);
  }
});

// AC9: a press must not swap the TextViews before the click on a link is done
test("a mouse press does not clear the marks; only the release does", async () => {
  const { view, cx } = await open();
  await outside(view, cx, TEXT.replace("First", "First!"));
  const node = reader(view, cx);
  assert.equal(node.calls.some(([n]) => n === "on_mouse_down"), false);
  assert.equal(view.marks !== null, true);
});

// the rendered Markdown of each block is made once when the marks are set, not on every render
test("a re-render reuses the block Markdown made when the marks were set", async () => {
  const { view, cx } = await open();
  await outside(view, cx, TEXT.replace("First", "First!"));
  assert.deepEqual(view.marks.rendered, ["# Title", "First!", "Second", "Third"]);
  view.marks.rendered[2] = "SENTINEL";
  assert.equal(textViews(reader(view, cx))[2].arg.markdown, "SENTINEL");
});

// AC11
test("marks stay with no interaction: re-rendering and other work do not clear them", async () => {
  const { view, cx } = await open();
  await outside(view, cx, TEXT.replace("First", "First!"));
  await settle();
  view.render(cx); view.render(cx);
  assert.deepEqual(markedIds(reader(view, cx)), [`md-${NOTE}-1`]);
});

// AC12
test("switching to edit clears the marks and they do not come back in read", async () => {
  const { view, cx } = await open();
  await outside(view, cx, TEXT.replace("First", "First!"));
  assert.ok(view.marks);
  view.setMode("edit");
  assert.equal(view.marks, null);
  view.setMode("read");
  assert.equal(view.marks, null);
  assert.equal(textViews(reader(view, cx)).length, 1);
});

// AC13
test("opening a note, the same note again, a vault change or closing clears the marks", async () => {
  for (const clear of [
    (view, cx) => view.open(NOTE, cx),
    (view) => view.close(),
    (view, cx) => view.setVault("/vault/other", cx),
  ]) {
    const { view, cx } = await open();
    await outside(view, cx, TEXT.replace("First", "First!"));
    assert.ok(view.marks);
    clear(view, cx);
    await settle();
    assert.equal(view.marks, null);
    assert.equal(view.baseline, null);
  }
});

test("the next note opens with no marks", async () => {
  const { view, cx } = await open();
  state.files[`${VAULT}/other.md`] = "Other\n";
  await outside(view, cx, TEXT.replace("First", "First!"));
  view.open("other.md", cx);
  await settle();
  assert.equal(view.note, "other.md");
  assert.equal(view.marks, null);
  assert.equal(textViews(reader(view, cx)).length, 1);
});

// AC20 (the tint and the bar of a marked block)
test("a marked block is tinted with changeMark and has a 2 px accent bar that floats", async () => {
  const { view, cx } = await open();
  await outside(view, cx, TEXT.replace("First", "First!"));
  const wrapper = walk(reader(view, cx)).find((n) => n.calls?.some(([name]) => name === "relative"));
  assert.ok(wrapper.calls.some(([name, args]) => name === "bg" && /^#[0-9a-f]{6}1f$/.test(args[0])));
  const bar = wrapper.kids.find((k) => k.calls?.some(([name]) => name === "absolute"));
  assert.deepEqual(bar.calls.find(([name]) => name === "w")[1], [2]);
});
