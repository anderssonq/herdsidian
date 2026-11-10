// Renders the real mods against stubbed runtimes (tests/support/mod-stubs.js).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { state, fakeCx, settle, findById, svgPaths, walk } from "./support/mod-stubs.js";

const { default: Tabs } = await import("../mods/herdsidian-tabs/main.js");
const { default: Notes } = await import("../mods/herdsidian/main.js");
const { FilesTab } = await import("../mods/herdsidian/files-view.js");

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

const hasCall = (node, name, arg) => node.calls.some(([n, args]) => n === name && (arg === undefined || args[0] === arg));
const SIDEBAR = "herdsidian.sidebar";
// "hidden": no sidebar block shown; "same": shown on `want`; "other": shown on another tab.
const sidebarState = (mode, want) => {
  state.layout = { id: "root", children: [{ id: "herdsidian", hidden: mode === "hidden" }] };
  if (mode === "same") state.shared[SIDEBAR] = { tab: want };
  if (mode === "other") state.shared[SIDEBAR] = { tab: want === "files" ? "changes" : "files" };
};

// V1 Commands, AC-V1.3: the keys and the palette rows run herdsidian-tabs.<tab>.
for (const want of ["files", "changes", "notes"]) {
  test(`the ${want} command shows a hidden sidebar on that tab`, async () => {
    sidebarState("hidden", want);
    state.commands = [want];
    await renderTabs();
    assert.deepEqual(state.runs, [["layout.show", { id: "herdsidian" }]]);
    assert.deepEqual(state.shared[SIDEBAR], { tab: want });
  });

  test(`the ${want} command hides a sidebar already on that tab`, async () => {
    sidebarState("same", want);
    state.commands = [want];
    await renderTabs();
    assert.deepEqual(state.runs, [["layout.hide", { id: "herdsidian" }]]);
    assert.deepEqual(state.shared[SIDEBAR], { tab: want });
  });

  test(`the ${want} command only switches a sidebar shown on another tab`, async () => {
    sidebarState("other", want);
    state.commands = [want];
    await renderTabs();
    assert.deepEqual(state.runs, []);
    assert.deepEqual(state.shared[SIDEBAR], { tab: want });
  });
}

test("a missing sidebar block counts as hidden", async () => {
  state.commands = ["files"];
  await renderTabs();
  assert.deepEqual(state.runs, [["layout.show", { id: "herdsidian" }]]);
  assert.deepEqual(state.shared[SIDEBAR], { tab: "files" });
});

test("with nothing stored the sidebar is on Notes, so the notes command hides a shown one", async () => {
  state.layout = { id: "root", children: [{ id: "herdsidian", hidden: false }] };
  state.commands = ["notes"];
  await renderTabs();
  assert.deepEqual(state.runs, [["layout.hide", { id: "herdsidian" }]]);
});

test("the settings and open-settings commands are gone: they change nothing", async () => {
  for (const command of ["settings", "open-settings"]) {
    for (const mode of ["hidden", "same", "other"]) {
      state.runs = []; state.shared = {};
      sidebarState(mode, "files");
      const stored = state.shared[SIDEBAR];
      state.commands = [command];
      await renderTabs();
      assert.deepEqual(state.runs, [], `${command} ${mode}`);
      assert.deepEqual(state.shared[SIDEBAR], stored, `${command} ${mode}`);
    }
  }
});

test("the toolbar has one sidebar toggle and no Files, Changes or Notes icons, group or dot", async () => {
  const { tree } = await renderTabs();
  assert.ok(findById(tree, "sidebar-toggle"));
  for (const id of ["panel-files", "panel-changes", "panel-notes", "panel-group", "panel-changes-dot"]) assert.equal(findById(tree, id), null, id);
  state.shared["herdsidian.changes"] = { count: 3 };
  assert.equal(findById((await renderTabs()).tree, "panel-changes-dot"), null);
});

test("the sidebar toggle is a 30 px button with the right-panel icon", async () => {
  const node = findById((await renderTabs()).tree, "sidebar-toggle");
  assert.ok(hasCall(node, "h", 30) && hasCall(node, "w", 30));
  assert.deepEqual(svgPaths(node), ["mods/workspace-chrome/panel-right.svg"]);
});

test("the sidebar toggle shows or hides the block with layout.toggle, whatever the tab", async () => {
  for (const mode of ["hidden", "same", "other"]) {
    state.runs = []; state.shared = {};
    sidebarState(mode, "files");
    const stored = state.shared[SIDEBAR];
    findById((await renderTabs()).tree, "sidebar-toggle").onClick();
    assert.deepEqual(state.runs, [["layout.toggle", { id: "herdsidian" }]], mode);
    assert.deepEqual(state.shared[SIDEBAR], stored, `${mode}: the tab is left alone`);
  }
});

test("the sidebar toggle looks pressed only while the block is shown", async () => {
  sidebarState("hidden", "files");
  assert.ok(!hasCall(findById((await renderTabs()).tree, "sidebar-toggle"), "bg"), "idle while hidden");
  state.layout = { id: "root", children: [] };
  assert.ok(!hasCall(findById((await renderTabs()).tree, "sidebar-toggle"), "bg"), "idle with no block");
  for (const tab of ["files", "changes", "notes"]) {
    state.layout = { id: "root", children: [{ id: "herdsidian", hidden: false }] };
    state.shared[SIDEBAR] = { tab };
    const node = findById((await renderTabs()).tree, "sidebar-toggle");
    assert.ok(hasCall(node, "bg"), `${tab} pressed`);
  }
});

test("the toolbar order is tabs, +, Search, the sidebar toggle", async () => {
  const { tree } = await renderTabs();
  const order = walk(tree).map((n) => n.nodeId).filter((id) => ["tab-bar", "tab-new", "search", "sidebar-toggle"].includes(id));
  assert.deepEqual(order, ["tab-bar", "tab-new", "search", "sidebar-toggle"]);
  const search = findById(tree, "search");
  assert.ok(hasCall(search, "w", 220));
});

test("the toolbar has no Usage control, no segmented pill and no Notes toggle", async () => {
  const { tree } = await renderTabs();
  const ids = walk(tree).map((n) => n.nodeId).filter(Boolean);
  assert.deepEqual(ids.filter((id) => /usage/i.test(id)), []);
  for (const id of ["panels", "notes-toggle"]) assert.equal(findById(tree, id), null, id);
  const texts = walk(tree).flatMap((n) => n.kids).filter((k) => typeof k === "string");
  assert.ok(!texts.includes("Usage"));
});

test("the sidebar toggle's tooltip is Right sidebar, with no key", async () => {
  const { tree } = await renderTabs();
  const tip = (id) => findById(tree, id).calls.find(([n]) => n === "tooltip")?.[1][0];
  assert.equal(tip("sidebar-toggle"), "Right sidebar");
});

test("herdsidian-tabs.js never asks for a key on the sidebar toggle", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../mods/herdsidian-tabs/main.js", import.meta.url), "utf8");
  assert.ok(!/tipFor\("Right sidebar"/.test(src));
  assert.ok(!/open-settings|"settings"/.test(src));
});

test("the Files panel draws folders with the vault's folder icon in the accent color", () => {
  const view = new FilesTab({});
  Object.assign(view, { root: "/repo", marks: {}, folders: new Set(),
    entries: new Map([["", [{ name: "src", dir: true }, { name: "a.md", dir: false }]]]) });
  const [folder, file] = view.rows("", 0, [], { accent: "accent", muted: "muted", dim: "dim", hover: "hover" });
  const icon = (row) => walk(row).filter((n) => n.kind === "svg").at(-1);
  assert.equal(icon(folder).arg, "mods/herdsidian/folder.svg");
  assert.deepEqual(icon(folder).calls.find(([name]) => name === "text_color"), ["text_color", ["accent"]]);
  assert.equal(icon(file).arg, "mods/files/file.svg");
  assert.deepEqual(icon(file).calls.find(([name]) => name === "text_color"), ["text_color", ["muted"]]);
  assert.ok(existsSync(`${repo}mods/herdsidian/folder.svg`));
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
