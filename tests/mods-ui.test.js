// Renders the real mods against stubbed runtimes (tests/support/mod-stubs.js).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { state, fakeCx, settle, findById, svgPaths } from "./support/mod-stubs.js";

const { default: Notes } = await import("../mods/herdsidian/main.js");

const repo = new URL("../", import.meta.url).pathname;

beforeEach(() => {
  state.shared = {}; state.runs = []; state.toasts = []; state.commands = []; state.files = {};
  state.layout = { id: "root", children: [] };
  localStorage.removeItem("vault");
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
