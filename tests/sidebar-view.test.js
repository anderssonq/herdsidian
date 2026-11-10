// The right sidebar shell (V1): the 3-tab header, the tab bodies, the rail icons and the key bindings.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { state, fakeCx, settle, findById, svgPaths, walk } from "./support/mod-stubs.js";

const { default: Notes } = await import("../mods/herdsidian/main.js");
const { tabControl, tabTips } = await import("../mods/herdsidian/sidebar-view.js");

const VAULT = "/vault/my notes", NOTE = "03-Knowledge/Git.md", STORE = "herdsidian.sidebar";
const TABS = ["notes", "files", "changes"];

beforeEach(() => {
  state.shared = {}; state.runs = []; state.toasts = []; state.commands = []; state.files = {};
  state.layout = { id: "root", children: [] };
  localStorage.removeItem("vault");
});

const mount = async ({ rail = false, open = false } = {}) => {
  localStorage.setItem("vault", VAULT);
  state.files[`${VAULT}/${NOTE}`] = "# Git\n";
  state.layout = { id: "root", children: [{ id: "herdsidian", size: { px: rail ? 44 : 380 } }] };
  const view = new Notes(), cx = fakeCx();
  view.init({}, cx);
  await settle();
  if (open) { view.open(NOTE, cx); await settle(); }
  return { view, cx, tree: () => view.render(cx) };
};

const selectedSegments = (tree) => TABS.filter((id) => findById(tree, `sidebar-tab-${id}`)?.calls.some(([name, args]) => name === "font_weight" && args[0] === 500));
const pressed = (tree, prefix) => TABS.filter((id) => findById(tree, `${prefix}${id}`)?.calls.some(([name]) => name === "bg"));

test("the header has the three segments, in order, and no Settings segment", async () => {
  const { tree } = await mount();
  const order = walk(tree()).map((n) => n.nodeId).filter((id) => id?.startsWith("sidebar-tab-"));
  assert.deepEqual(order, TABS.map((id) => `sidebar-tab-${id}`));
  assert.equal(findById(tree(), "sidebar-tab-settings"), null);
});

test("the segments say Notes, Files and Changes", async () => {
  const { tree } = await mount();
  const labels = TABS.map((id) => findById(tree(), `sidebar-tab-${id}`).kids.find((k) => typeof k === "string"));
  assert.deepEqual(labels, ["Notes", "Files", "Changes"]);
});

const tipOf = (node) => node.calls.find(([name]) => name === "tooltip")?.[1][0];

test("each segment has a tooltip with its name (the stub binds no keys)", async () => {
  const { tree } = await mount();
  for (const [id, label] of [["notes", "Notes"], ["files", "Files"], ["changes", "Changes"]]) {
    assert.equal(tipOf(findById(tree(), `sidebar-tab-${id}`)), label, id);
  }
});

const BINDINGS = [
  { section: "layout:herdsidian", keys: "cmd-shift-o", action: "herdsidian-tabs.notes" },
  { section: "layout:herdsidian", keys: "cmd-shift-e", action: "herdsidian-tabs.files" },
  { section: "layout:herdsidian", keys: "cmd-shift-g", action: "herdsidian-tabs.changes" },
];

test("tabTips puts the key in each tooltip", () => {
  assert.deepEqual(tabTips(BINDINGS, "herdsidian", "modifier"), {
    notes: "Notes  ⇧⌘O", files: "Files  ⇧⌘E", changes: "Changes  ⇧⌘G",
  });
  assert.equal(tabTips(BINDINGS, "herdsidian", "always").files, "Files  ⇧⌘E");
});

test("tabTips has no key when key hints are off or nothing is bound", () => {
  assert.deepEqual(tabTips(BINDINGS, "herdsidian", "off"), { notes: "Notes", files: "Files", changes: "Changes" });
  assert.deepEqual(tabTips({}, "herdsidian", "modifier"), { notes: "Notes", files: "Files", changes: "Changes" });
});

test("the mounted Notes mod puts the bound key in the Files tooltip, unless key hints are off", async () => {
  state.keys = BINDINGS;
  state.shared.layout = "herdsidian";
  try {
    state.shared["herdsidian.settings"] = { keyHints: "always" };
    const always = await mount();
    assert.equal(tipOf(findById(always.tree(), "sidebar-tab-files")), "Files  ⇧⌘E");
    state.shared["herdsidian.settings"] = { keyHints: "off" };
    const off = await mount();
    assert.equal(tipOf(findById(off.tree(), "sidebar-tab-files")), "Files");
  } finally { state.keys = {}; }
});

test("tabControl gives each segment its tip", () => {
  const t = new Proxy({}, { get: () => "#000" });
  const tree = tabControl(t, new Proxy({}, { get: () => "#000" }), { tab: "notes", count: 0, onSelect() {}, tips: tabTips(BINDINGS, "herdsidian", "modifier") });
  assert.equal(tipOf(findById(tree, "sidebar-tab-changes")), "Changes  ⇧⌘G");
});

test("a stored settings tab shows Notes", async () => {
  state.shared[STORE] = { tab: "settings" };
  const { tree } = await mount();
  assert.deepEqual(selectedSegments(tree()), ["notes"]);
  assert.ok(findById(tree(), "notes-tree"));
});

test("without a stored tab, Notes is selected", async () => {
  const { tree } = await mount();
  assert.deepEqual(selectedSegments(tree()), ["notes"]);
});

test("the selected segment comes from shared state", async () => {
  state.shared[STORE] = { tab: "changes" };
  const { tree } = await mount();
  assert.deepEqual(selectedSegments(tree()), ["changes"]);
});

test("an unknown stored tab falls back to Notes", async () => {
  state.shared[STORE] = { tab: "nope" };
  const { tree } = await mount();
  assert.deepEqual(selectedSegments(tree()), ["notes"]);
});

for (const id of TABS) {
  test(`clicking ${id} stores it in herdsidian.sidebar`, async () => {
    const { cx, tree } = await mount();
    findById(tree(), `sidebar-tab-${id}`).onClick(null, cx);
    assert.deepEqual(state.shared[STORE], { tab: id });
    assert.deepEqual(selectedSegments(tree()), [id]);
  });
}

test("the Changes badge shows the count when it is above 0", async () => {
  const { tree } = await mount();
  state.shared["herdsidian.changes"] = { count: 3 };
  assert.deepEqual(findById(tree(), "sidebar-changes-badge").kids, ["3"]);
});

for (const [label, value] of [["0", { count: 0 }], ["unset", undefined], ["not a number", { count: "x" }]]) {
  test(`no Changes badge when the count is ${label}`, async () => {
    const { tree } = await mount();
    state.shared["herdsidian.changes"] = value;
    assert.equal(findById(tree(), "sidebar-changes-badge"), null);
  });
}

test("the collapse button says it collapses to the rail (⌘⇧O no longer collapses)", async () => {
  const { tree } = await mount();
  const tip = findById(tree(), "notes-collapse").calls.find(([name]) => name === "tooltip");
  assert.deepEqual(tip[1], ["Collapse to rail"]);
});

test("the send command runs the Send to agent action", async () => {
  const sends = [], original = Notes.prototype.send;
  Notes.prototype.send = function (cx) { sends.push(cx); };
  try {
    state.commands = ["send"];
    await mount();
    assert.equal(sends.length, 1);
  } finally { Notes.prototype.send = original; }
});

test("keys.json binds cmd-enter to herdsidian.send for the Notes pane only", () => {
  const keys = JSON.parse(readFileSync(new URL("../keys.json", import.meta.url), "utf8"));
  assert.equal(keys["mod:herdsidian"]["cmd-enter"], "herdsidian.send");
  assert.equal(keys["layout:herdsidian"]["cmd-enter"], undefined);
});

test("the Notes tab shows the tree and the Notes sub-header, without the key cap", async () => {
  const { tree } = await mount();
  assert.ok(findById(tree(), "notes-tree"));
  for (const id of ["notes-search", "notes-new", "notes-vault"]) assert.ok(findById(tree(), id), id);
  assert.ok(!walk(tree()).some((n) => n.kids.includes("⌘⇧O")), "no ⌘⇧O key cap");
});

test("the Notes tab shows the reader for an open note", async () => {
  const { tree } = await mount({ open: true });
  assert.ok(findById(tree(), "notes-read"));
  assert.ok(findById(tree(), "notes-copy-path"));
});

for (const id of ["files", "changes"]) {
  test(`the ${id} tab renders its own body and not the tree`, async () => {
    state.shared[STORE] = { tab: id };
    const { tree } = await mount();
    assert.ok(findById(tree(), `tab-${id}`), `tab-${id}`);
    assert.equal(findById(tree(), "notes-tree"), null);
    assert.equal(findById(tree(), "notes-search"), null);
  });
}

test("a tab body is made once and reused", async () => {
  state.shared[STORE] = { tab: "files" };
  const { view, tree } = await mount();
  tree();
  const first = view.filesTab;
  assert.ok(first);
  tree();
  assert.equal(view.filesTab, first);
  assert.equal(view.changesTab, undefined);
});

test("the rail has one icon per tab, in order", async () => {
  const { tree } = await mount({ rail: true });
  const order = walk(tree()).map((n) => n.nodeId).filter((id) => id?.startsWith("sidebar-rail-"));
  assert.deepEqual(order, TABS.map((id) => `sidebar-rail-${id}`));
  for (const id of TABS) assert.equal(svgPaths(findById(tree(), `sidebar-rail-${id}`)).length, 1, id);
});

test("the rail marks the selected tab", async () => {
  const { tree } = await mount({ rail: true });
  assert.deepEqual(pressed(tree(), "sidebar-rail-"), ["notes"]);
  state.shared[STORE] = { tab: "changes" };
  assert.deepEqual(pressed(tree(), "sidebar-rail-"), ["changes"]);
});

test("clicking a rail icon selects the tab and expands the rail", async () => {
  const { cx, tree } = await mount({ rail: true });
  findById(tree(), "sidebar-rail-files").onClick(null, cx);
  assert.deepEqual(state.shared[STORE], { tab: "files" });
  assert.deepEqual(state.runs.at(-1), ["layout.resize", { id: "herdsidian", px: 380 }]);
});

test("the Notes buttons stay in the rail below the tab icons", async () => {
  const { tree } = await mount({ rail: true });
  const order = walk(tree()).map((n) => n.nodeId).filter((id) => id === "sidebar-rail-changes" || id === "notes-search-rail" || id === "notes-new-rail");
  assert.deepEqual(order, ["sidebar-rail-changes", "notes-search-rail", "notes-new-rail"]);
  assert.equal(findById(tree(), "sidebar-rail-settings"), null);
});

test("keys.json binds the sidebar keys", () => {
  const keys = JSON.parse(readFileSync(new URL("../keys.json", import.meta.url), "utf8"))["layout:herdsidian"];
  assert.equal(keys["cmd-shift-o"], "herdsidian-tabs.notes");
  assert.equal(keys["cmd-shift-e"], "herdsidian-tabs.files");
  assert.equal(keys["cmd-shift-g"], "herdsidian-tabs.changes");
  assert.equal(keys["cmd-j"], "guide-agents.next-blocked");
});
