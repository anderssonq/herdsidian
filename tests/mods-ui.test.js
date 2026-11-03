// Renders the real mods against stubbed runtimes (tests/support/mod-stubs.js).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { state, fakeCx, settle, findById, svgPaths } from "./support/mod-stubs.js";

const { default: Tabs } = await import("../mods/herdsidian-tabs/main.js");
const { default: Notes } = await import("../mods/herdsidian/main.js");

const repo = new URL("../", import.meta.url).pathname;

beforeEach(() => {
  state.shared = {}; state.runs = []; state.toasts = []; state.commands = []; state.files = {};
  state.layout = { id: "root", children: [] };
  localStorage.removeItem("vault");
});

const renderTabs = async () => {
  const view = new Tabs(), cx = fakeCx();
  view.init({}, cx);
  await settle();
  return { view, cx, tree: view.render(cx) };
};

// Herdr's welcome leaves [] when no panel is picked; a new install must still show both.
for (const [label, panels] of [["empty", []], ["unset", undefined], ["only changes", ["changes"]]]) {
  test(`toolbar shows Files and Changes when workspace.panels is ${label}`, async () => {
    state.shared["workspace.panels"] = panels;
    const { tree } = await renderTabs();
    assert.ok(findById(tree, "panel-files"), "Files button");
    assert.ok(findById(tree, "panel-changes"), "Changes button");
    assert.ok(svgPaths(tree).includes("mods/files/file.svg"));
    assert.ok(svgPaths(tree).includes("mods/changes/changes.svg"));
  });
}

test("the toolbar keys open their panel when workspace.panels is empty", async () => {
  state.shared["workspace.panels"] = [];
  state.commands = ["changes"];
  await renderTabs();
  assert.deepEqual(state.runs, [
    ["layout.select", { stack: "panel-body", child: "changes" }],
    ["layout.show", { id: "panel" }],
  ]);
});

test("the Files button opens its panel when workspace.panels is empty", async () => {
  state.shared["workspace.panels"] = [];
  const { tree } = await renderTabs();
  findById(tree, "panel-files").onClick();
  assert.deepEqual(state.runs, [
    ["layout.select", { stack: "panel-body", child: "files" }],
    ["layout.show", { id: "panel" }],
  ]);
});

const VAULT = "/vault/my notes", NOTE = "03-Knowledge/Git.md";

const renderNotes = async (open) => {
  localStorage.setItem("vault", VAULT);
  state.files[`${VAULT}/${NOTE}`] = "# Git\n";
  const view = new Notes(), cx = fakeCx();
  view.init({}, cx);
  await settle();
  if (open) { view.open(NOTE, cx); await settle(); assert.equal(view.note, NOTE); }
  return { view, cx, tree: view.render(cx) };
};

test("the copy button copies the open note's full path and confirms it", async () => {
  const { cx, tree } = await renderNotes(true);
  findById(tree, "notes-copy-path").onClick(null, cx);
  assert.deepEqual(cx.clipboard, [`${VAULT}/${NOTE}`]);
  assert.deepEqual(state.toasts, [{ title: "Path copied", level: "success" }]);
});

test("the copy button uses an icon the mod ships", async () => {
  const { tree } = await renderNotes(true);
  const [path] = svgPaths(findById(tree, "notes-copy-path"));
  assert.equal(path, "mods/herdsidian/copy.svg");
  assert.ok(existsSync(`${repo}${path}`));
});

test("no copy button without an open note", async () => {
  const { tree } = await renderNotes(false);
  assert.equal(findById(tree, "notes-copy-path"), null);
});

test("header buttons named by icon still use Herdr's icons", async () => {
  const { tree } = await renderNotes(true);
  assert.deepEqual(svgPaths(findById(tree, "notes-collapse")), ["mods/workspace-chrome/panel-right.svg"]);
});
