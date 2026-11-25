// The fourth sidebar tab (AC5 to AC9, AC11): the tab list, the header and rail, the stored choice, the routing, the
// Settings cycle, the tooltip, the key, and no git command while the tab is not the one shown.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { state, fakeCx, settle, findById, walk, reset, fakeRepo, fakeOps, mountGit, commitsOf } from "./support/git-kit.js";
import { svgPaths } from "./support/mod-stubs.js";
import { SIDEBAR_TABS, settingSections } from "../lib/keys.js";
import { readSidebar, routeTab } from "../lib/sidebar.js";

const { default: Notes } = await import("../mods/herdsidian/main.js");
const { default: Tabs } = await import("../mods/herdsidian-tabs/main.js");
const { tabControl, tabTips } = await import("../mods/herdsidian/sidebar-view.js");

const VAULT = "/vault/my notes", STORE = "herdsidian.sidebar";
const TABS = ["notes", "files", "changes", "git"];
const root = new URL("../", import.meta.url).pathname;

beforeEach(() => {
  reset();
  state.runs = []; state.toasts = []; state.commands = []; state.keys = {};
  localStorage.removeItem("vault");
});

const mount = async ({ rail = false } = {}) => {
  localStorage.setItem("vault", VAULT);
  state.layout = { id: "root", children: [{ id: "herdsidian", size: { px: rail ? 44 : 380 } }] };
  const view = new Notes(), cx = fakeCx();
  view.init({}, cx);
  await settle();
  return { view, cx, tree: () => view.render(cx) };
};

const tipOf = (node) => node.calls.find(([name]) => name === "tooltip")?.[1][0];
const idsOf = (tree, prefix) => walk(tree).map((n) => n.nodeId).filter((id) => id?.startsWith(prefix));

// AC5
test("SIDEBAR_TABS lists the four tabs, Git last, in lib/keys.js and in every mod copy", () => {
  assert.deepEqual(SIDEBAR_TABS, TABS);
  const copies = readdirSync(`${root}mods`).filter((d) => existsSync(`${root}mods/${d}/keys.js`));
  assert.ok(copies.length >= 5, "the five copies exist");
  for (const d of copies) assert.equal(readFileSync(`${root}mods/${d}/keys.js`, "utf8"), readFileSync(`${root}lib/keys.js`, "utf8"), d);
});

test("the header has four segments in order, the last labeled Git", async () => {
  const { tree } = await mount();
  assert.deepEqual(idsOf(tree(), "sidebar-tab-"), TABS.map((id) => `sidebar-tab-${id}`));
  const labels = TABS.map((id) => findById(tree(), `sidebar-tab-${id}`).kids.find((k) => typeof k === "string"));
  assert.deepEqual(labels, ["Notes", "Files", "Changes", "Git"]);
});

test("the rail has four icons in order and Git uses git-branch.svg", async () => {
  const { tree } = await mount({ rail: true });
  assert.deepEqual(idsOf(tree(), "sidebar-rail-").filter((id) => TABS.some((t) => id === `sidebar-rail-${t}`)), TABS.map((id) => `sidebar-rail-${id}`));
  assert.deepEqual(svgPaths(findById(tree(), "sidebar-rail-git")), ["mods/workspace-chrome/git-branch.svg"]);
});

// AC6
test("a click on the Git segment stores { tab: git }", async () => {
  const { cx, tree } = await mount();
  findById(tree(), "sidebar-tab-git").onClick(null, cx);
  assert.deepEqual(state.shared[STORE], { tab: "git" });
});

test("a click on the Git rail icon stores { tab: git }", async () => {
  const { cx, tree } = await mount({ rail: true });
  findById(tree(), "sidebar-rail-git").onClick(null, cx);
  assert.deepEqual(state.shared[STORE], { tab: "git" });
});

test("readSidebar keeps git and still reads an unknown tab as notes", () => {
  assert.deepEqual(readSidebar({ tab: "git" }), { tab: "git" });
  assert.deepEqual(readSidebar({ tab: "nope" }), { tab: "notes" });
  assert.deepEqual(readSidebar({ tab: "settings" }), { tab: "notes" });
});

// AC7
test("routeTab handles git in its three cases", () => {
  assert.deepEqual(routeTab({ hidden: true, tab: "notes" }, "git"), { tab: "git", commands: [["layout.show", { id: "herdsidian" }]] });
  assert.deepEqual(routeTab({ hidden: false, tab: "git" }, "git"), { tab: "git", commands: [["layout.hide", { id: "herdsidian" }]] });
  assert.deepEqual(routeTab({ hidden: false, tab: "files" }, "git"), { tab: "git", commands: [] });
});

const renderTabs = async () => {
  const view = new Tabs(), cx = fakeCx();
  view.init({}, cx);
  await settle();
};

test("the git command shows a hidden sidebar on Git", async () => {
  state.layout = { id: "root", children: [{ id: "herdsidian", hidden: true }] };
  state.commands = ["git"];
  await renderTabs();
  assert.deepEqual(state.runs, [["layout.show", { id: "herdsidian" }]]);
  assert.deepEqual(state.shared[STORE], { tab: "git" });
});

test("the git command hides a sidebar already on Git", async () => {
  state.layout = { id: "root", children: [{ id: "herdsidian", hidden: false }] };
  state.shared[STORE] = { tab: "git" };
  state.commands = ["git"];
  await renderTabs();
  assert.deepEqual(state.runs, [["layout.hide", { id: "herdsidian" }]]);
  assert.deepEqual(state.shared[STORE], { tab: "git" });
});

test("the git command only switches a sidebar shown on another tab", async () => {
  state.layout = { id: "root", children: [{ id: "herdsidian", hidden: false }] };
  state.shared[STORE] = { tab: "files" };
  state.commands = ["git"];
  await renderTabs();
  assert.deepEqual(state.runs, []);
  assert.deepEqual(state.shared[STORE], { tab: "git" });
});

// AC8
test("the Settings cycle goes Notes, Files, Changes, Git, Notes, with the detail Git", () => {
  const base = { settings: { keyHints: "modifier", usageInStatus: true }, sidebarHidden: false, sidebarRail: false };
  const row = (sidebarTab) => settingSections({ ...base, sidebarTab })[1].rows[1];
  assert.equal(row("notes").action.name, "herdsidian-tabs.files");
  assert.equal(row("files").action.name, "herdsidian-tabs.changes");
  assert.equal(row("changes").action.name, "herdsidian-tabs.git");
  assert.equal(row("git").detail, "Git");
  assert.equal(row("git").action.name, "herdsidian-tabs.notes");
});

// AC9
const BINDINGS = [
  { section: "layout:herdsidian", keys: "cmd-shift-e", action: "herdsidian-tabs.files" },
  { section: "layout:herdsidian", keys: "cmd-shift-h", action: "herdsidian-tabs.git" },
];

test("tabTips gives Git with its key, and plain Git when key hints are off or nothing is bound", () => {
  assert.equal(tabTips(BINDINGS, "herdsidian", "modifier").git, "Git  ⇧⌘H");
  assert.equal(tabTips(BINDINGS, "herdsidian", "always").git, "Git  ⇧⌘H");
  assert.equal(tabTips(BINDINGS, "herdsidian", "off").git, "Git");
  assert.equal(tabTips({}, "herdsidian", "modifier").git, "Git");
});

test("tabControl gives the Git segment its tip", () => {
  const t = new Proxy({}, { get: () => "#000" });
  const tree = tabControl(t, new Proxy({}, { get: () => "#000" }), { tab: "notes", count: 0, onSelect() {}, tips: tabTips(BINDINGS, "herdsidian", "modifier") });
  assert.equal(tipOf(findById(tree, "sidebar-tab-git")), "Git  ⇧⌘H");
});

test("the mounted sidebar shows the Git tooltip with the bound key, and without it when key hints are off", async () => {
  state.keys = BINDINGS;
  state.shared.layout = "herdsidian";
  state.shared["herdsidian.settings"] = { keyHints: "always" };
  const always = await mount();
  assert.equal(tipOf(findById(always.tree(), "sidebar-tab-git")), "Git  ⇧⌘H");
  state.shared["herdsidian.settings"] = { keyHints: "off" };
  const off = await mount();
  assert.equal(tipOf(findById(off.tree(), "sidebar-tab-git")), "Git");
});

test("the mounted sidebar shows plain Git when the stub binds no keys", async () => {
  const { tree } = await mount();
  assert.equal(tipOf(findById(tree(), "sidebar-tab-git")), "Git");
});

test("keys.json binds cmd-shift-h to herdsidian-tabs.git", () => {
  const keys = JSON.parse(readFileSync(`${root}keys.json`, "utf8"))["layout:herdsidian"];
  assert.equal(keys["cmd-shift-h"], "herdsidian-tabs.git");
});

// AC11: only the commands that ran before this change.
const OLD_COMMANDS = (args) => (args.includes("rev-parse") && args.includes("--show-toplevel"))
  || (args.includes("status") && args.includes("--porcelain=v1"))
  || (args.includes("diff") && args.includes("--numstat"));

const GRAPH = commitsOf(`
  c3 <- c2 | third | Ann <ann@example.com>
  c2 <- c1 | second | Ann <ann@example.com>
  c1 <- | first | Ann <ann@example.com>
`);

const noNewGit = (repo, ops) => {
  const git = repo.calls.filter(([cmd]) => cmd === "git");
  assert.ok(git.length > 0, "the watch still reads (control)");
  for (const [, args] of git) assert.ok(OLD_COMMANDS(args), `unexpected git call: ${args.join(" ")}`);
  assert.deepEqual(repo.log.writes(), []);
  assert.deepEqual(ops.paths.filter((p) => p.includes("/.git")), [], "no git-dir file is read");
};

for (const tab of ["notes", "files", "changes"]) {
  test(`with the store on ${tab}: a mount, three renders and a watch apply run no new git command`, async () => {
    const repo = fakeRepo({ commits: GRAPH, upstream: { remote: "origin", ref: "refs/heads/main" }, remotes: ["origin"], stash: { hash: "s".repeat(40), message: "wip" }, changed: 2 });
    const ops = fakeOps();
    const g = mountGit({ tab });
    for (let i = 0; i < 3; i++) g.render();
    await g.apply();
    g.render();
    await settle();
    noNewGit(repo, ops);
  });

  test(`with the store on ${tab}: the real sidebar runs no new git command over three renders`, async () => {
    const repo = fakeRepo({ commits: GRAPH, upstream: { remote: "origin", ref: "refs/heads/main" }, remotes: ["origin"], stash: { hash: "s".repeat(40), message: "wip" }, changed: 2 });
    const ops = fakeOps();
    state.shared[STORE] = { tab };
    const { tree } = await mount();
    for (let i = 0; i < 3; i++) tree();
    await settle();
    noNewGit(repo, ops);
  });
}

test("with the store on git, tab-git is drawn and notes-tree is not", async () => {
  fakeRepo({ commits: GRAPH });
  fakeOps();
  state.shared[STORE] = { tab: "git" };
  const { tree } = await mount();
  assert.ok(findById(tree(), "tab-git"));
  assert.equal(findById(tree(), "notes-tree"), null);
});
