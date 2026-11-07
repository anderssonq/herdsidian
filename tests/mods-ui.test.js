// Renders the real mods against stubbed runtimes (tests/support/mod-stubs.js).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { state, fakeCx, settle, findById, svgPaths, walk } from "./support/mod-stubs.js";

const { default: Tabs } = await import("../mods/herdsidian-tabs/main.js");
const { default: Notes } = await import("../mods/herdsidian/main.js");
const { default: Files } = await import("../mods/herdsidian-files/main.js");

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
    ["layout.hide", { id: "files" }],
    ["layout.show", { id: "changes" }],
    ["layout.show", { id: "panel" }],
  ]);
});

test("the Files button opens its panel when workspace.panels is empty", async () => {
  state.shared["workspace.panels"] = [];
  const { tree } = await renderTabs();
  findById(tree, "panel-files").onClick();
  assert.deepEqual(state.runs, [
    ["layout.show", { id: "files" }],
    ["layout.hide", { id: "changes" }],
    ["layout.show", { id: "panel" }],
  ]);
});

// The side column with Files on top and Changes below; `hidden` per id.
const panelLayout = ({ panel = false, files = true, changes = true }) => ({ id: "root", children: [
  { id: "panel", hidden: panel, children: [{ id: "files", hidden: files }, { id: "changes", hidden: changes }] },
] });

test("Changes opens beside an open Files, and each button shows its own state", async () => {
  state.layout = panelLayout({ files: false });
  const { tree } = await renderTabs();
  findById(tree, "panel-changes").onClick();
  assert.deepEqual(state.runs, [
    ["layout.show", { id: "files" }],
    ["layout.show", { id: "changes" }],
    ["layout.show", { id: "panel" }],
  ]);
  state.layout = panelLayout({ files: false, changes: false });
  const { tree: both } = await renderTabs();
  for (const id of ["panel-files", "panel-changes"]) {
    assert.ok(findById(both, id).calls.some(([name]) => name === "bg"), `${id} looks pressed`);
  }
});

test("closing the last open panel hides the column", async () => {
  state.layout = panelLayout({ changes: false });
  const { tree } = await renderTabs();
  findById(tree, "panel-changes").onClick();
  assert.deepEqual(state.runs.at(-1), ["layout.hide", { id: "panel" }]);
});

test("Files and Changes sit right of Search, before the Notes toggle", async () => {
  const { tree } = await renderTabs();
  const order = walk(tree).map((n) => n.nodeId).filter((id) => ["tab-bar", "search", "panel-files", "panel-changes", "notes-toggle"].includes(id));
  assert.deepEqual(order, ["tab-bar", "search", "panel-files", "panel-changes", "notes-toggle"]);
});

test("the Files panel draws folders with the vault's folder icon in the accent color", () => {
  const view = new Files();
  Object.assign(view, { root: "/repo", marks: {}, folders: new Set(),
    entries: new Map([["", [{ name: "src", dir: true }, { name: "a.md", dir: false }]]]) });
  const [folder, file] = view.rows("", 0, [], { accent: "accent", muted: "muted", dim: "dim", hover: "hover" });
  const icon = (row) => walk(row).filter((n) => n.kind === "svg").at(-1);
  assert.equal(icon(folder).arg, "mods/herdsidian-files/folder.svg");
  assert.deepEqual(icon(folder).calls.find(([name]) => name === "text_color"), ["text_color", ["accent"]]);
  assert.equal(icon(file).arg, "mods/files/file.svg");
  assert.deepEqual(icon(file).calls.find(([name]) => name === "text_color"), ["text_color", ["muted"]]);
  assert.ok(existsSync(`${repo}mods/herdsidian-files/folder.svg`));
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
