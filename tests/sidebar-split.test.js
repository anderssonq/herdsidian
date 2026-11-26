// The right sidebar's split view (AC20 to AC29): the pure rules of the derived bottom tab, the right-click menu and its
// popup, the two sections, the swap by each way of picking a tab, the rail, persistence, shown-state and reorder.
// Written from the spec and the plan's contracts only. The middle pair is Files over Changes.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  state,
  fakeCx,
  findById,
  walk,
  settle,
  mountNotes,
  cxWithSleep,
  handler,
  press,
  move,
  release,
  click,
  STORE,
  LAYOUT_STORE,
  TABS,
} from "./support/sidebar-kit.js";
import { during } from "./support/live-cx.js";
import * as sidebar from "../lib/sidebar.js";
import { settingSections } from "../lib/keys.js";
import { placeMenu } from "../mods/herdsidian/actions.js";

const { default: Notes } = await import("../mods/herdsidian/main.js");
const { default: Tabs } = await import("../mods/herdsidian-tabs/main.js");
const { FilesTab } = await import("../mods/herdsidian/files-view.js");

const FILES_OVER_CHANGES = { top: "files", below: "changes" };
const ORDER = ["notes", "changes", "files", "git"];
// A custom order and a stored divider, so a write that drops a field shows.
const STORED = { order: ORDER, split: FILES_OVER_CHANGES, splitTop: 240 };

// The element that tells which tab body is drawn.
const MARK = {
  notes: "notes-tree",
  files: "tab-files",
  changes: "tab-changes",
  git: "tab-git",
};
const texts = (node) =>
  walk(node).flatMap((n) => n.kids.filter((k) => typeof k === "string"));
const has = (node, name, ...args) =>
  node.calls.some(
    ([n, a]) => n === name && JSON.stringify(a) === JSON.stringify(args),
  );
const called = (node, name) => node.calls.some(([n]) => n === name);
const bodiesIn = (node) => TABS.filter((tab) => findById(node, MARK[tab]));
const segment = (tree, tab) => findById(tree, `sidebar-tab-${tab}`);
const segmentIds = (tree) =>
  walk(tree)
    .map((n) => n.nodeId)
    .filter((id) => TABS.some((tab) => id === `sidebar-tab-${tab}`));
const layout = () => state.shared[LAYOUT_STORE];
const pointer = { position: { x: 995, y: 695 } };
const VIEWPORT = { width: 1000, height: 700 };

// The two panels of the split group, or [] when no split is drawn.
const panels = (tree) =>
  (findById(tree, "sidebar-split")?.kids ?? []).filter(
    (k) => k?.kind === "resizable-panel",
  );

// Which tab bodies each section draws. bottom is null when no split is drawn.
function sections(tree) {
  const [top, bottom] = panels(tree);
  if (!top) return { top: bodiesIn(tree), bottom: null };
  return { top: bodiesIn(top), bottom: bottom ? bodiesIn(bottom) : null };
}

// No tab body is drawn twice anywhere in the tree.
function eachBodyOnce(tree) {
  for (const tab of TABS) {
    const count = walk(tree).filter((n) => n.nodeId === MARK[tab]).length;
    assert.ok(count <= 1, `${tab} drawn ${count} times`);
  }
}

// A key or a ⌘K row: herdsidian-tabs runs the command `herdsidian-tabs.<tab>` and writes { tab } through route().
async function runTabsCommand(name) {
  state.commands = [name.replace(/^herdsidian-tabs\./, "")];
  const view = new Tabs();
  view.init({}, fakeCx());
  await settle();
}

// The ⌘K → Settings → "Right sidebar tab" row's action while `tab` is the stored tab.
const settingsRow = (tab) =>
  settingSections({
    settings: { keyHints: "modifier", usageInStatus: true },
    sidebarHidden: false,
    sidebarRail: false,
    sidebarTab: tab,
  })[1].rows[1].action.name;

// The popup copy of the herdsidian mod for the tab menu, as Herdr opens it: props, then init.
function mountMenu(sidebarMenu) {
  state.props = { overlay: "menu-1", sidebarMenu };
  const view = new Notes(),
    cx = fakeCx();
  view.init({}, cx);
  const tree = view.render(cx);
  state.props = {};
  return { view, cx, tree };
}

// Renders with a cx whose sleep resolves, then lets the deferred task run.
async function renderAndSettle(view) {
  view.render(cxWithSleep());
  await settle();
}

// Puts the pane in the rail or back to wide, as a drag of the sidebar edge does.
const widthTo = (px) => {
  state.layout = { id: "root", children: [{ id: "herdsidian", size: { px } }] };
};

beforeEach(() => {
  state.props = {};
  state.overlays = [];
  state.closed = [];
  state.viewport = null;
  state.commands = [];
});

// ---- Pure rules: Decision 2, shown, the menu ----

test("AC24 resolveSplit row 1: the stored tab is the top of the pair, nothing to fix", () => {
  assert.deepEqual(sidebar.resolveSplit("files", FILES_OVER_CHANGES), {
    top: "files",
    bottom: "changes",
    fix: undefined,
  });
});

test("AC24 resolveSplit row 2: the stored tab is the bottom of the pair, the two swap and the fix is the swapped pair", () => {
  assert.deepEqual(sidebar.resolveSplit("changes", FILES_OVER_CHANGES), {
    top: "changes",
    bottom: "files",
    fix: { top: "changes", below: "files" },
  });
});

test("AC25 resolveSplit row 3: a third tab goes on top and keeps the bottom", () => {
  assert.deepEqual(sidebar.resolveSplit("git", FILES_OVER_CHANGES), {
    top: "git",
    bottom: "changes",
    fix: { top: "git", below: "changes" },
  });
  assert.deepEqual(sidebar.resolveSplit("notes", FILES_OVER_CHANGES), {
    top: "notes",
    bottom: "changes",
    fix: { top: "notes", below: "changes" },
  });
});

test("AC27 resolveSplit row 4: no pair, or a pair that is not valid, gives no bottom and no fix", () => {
  for (const tab of ["files", "changes", "git"]) {
    assert.deepEqual(
      sidebar.resolveSplit(tab, null),
      { top: tab, bottom: null, fix: undefined },
      `${tab}, null`,
    );
    for (const split of [
      { top: "files", below: "files" },
      { top: "files", below: "nope" },
      { top: "nope", below: "changes" },
    ]) {
      assert.deepEqual(
        sidebar.resolveSplit(tab, split),
        { top: tab, bottom: null, fix: undefined },
        `${tab}, ${JSON.stringify(split)}`,
      );
    }
  }
});

test("AC28 shownTabs gives the top and the bottom, from the two stores", () => {
  const layoutRaw = { split: FILES_OVER_CHANGES };
  assert.deepEqual(sidebar.shownTabs({ tab: "files" }, layoutRaw), [
    "files",
    "changes",
  ]);
  assert.deepEqual(sidebar.shownTabs({ tab: "changes" }, layoutRaw), [
    "changes",
    "files",
  ]);
  assert.deepEqual(sidebar.shownTabs({ tab: "git" }, layoutRaw), [
    "git",
    "changes",
  ]);
  assert.deepEqual(sidebar.shownTabs({ tab: "files" }, undefined), ["files"]);
  assert.deepEqual(sidebar.shownTabs({ tab: "files" }, { split: null }), [
    "files",
  ]);
  assert.deepEqual(
    sidebar.shownTabs(
      { tab: "files" },
      { split: { top: "files", below: "files" } },
    ),
    ["files"],
  );
  assert.deepEqual(sidebar.shownTabs(undefined, undefined), ["notes"]);
});

test("AC20 splitMenu: Open below on a tab not shown, Close below on the bottom tab, none on the top tab", () => {
  assert.deepEqual(sidebar.splitMenu("notes", "files", "changes"), {
    op: "open-below",
    label: "Open below",
  });
  assert.deepEqual(sidebar.splitMenu("git", "files", "changes"), {
    op: "open-below",
    label: "Open below",
  });
  assert.deepEqual(sidebar.splitMenu("changes", "files", null), {
    op: "open-below",
    label: "Open below",
  });
  assert.deepEqual(sidebar.splitMenu("changes", "files", "changes"), {
    op: "close-below",
    label: "Close below",
  });
  assert.equal(sidebar.splitMenu("files", "files", "changes"), null);
  assert.equal(sidebar.splitMenu("files", "files", null), null);
});

// ---- AC20: the right-click menu ----

test("AC20 a right-click on a tab not shown opens a menu with Open below, inside the viewport", async () => {
  state.viewport = VIEWPORT;
  const { cx, tree } = await mountNotes({ tab: "files", layout: STORED });
  const right = handler(segment(tree, "notes"), "on_mouse_down", "right");
  assert.equal(
    typeof right,
    "function",
    "the segment has a right-click handler",
  );
  right(pointer, cx);
  const placed = placeMenu(pointer.position, 1, VIEWPORT, 1);
  assert.deepEqual(
    state.overlays.map((o) => o.spec),
    [
      {
        mod: "herdsidian",
        kind: "popup",
        frame: "none",
        ...placed,
        props: { sidebarMenu: { tab: "notes", op: "open-below" } },
      },
    ],
  );
  const { at, width, height } = state.overlays[0].spec;
  assert.ok(
    at.x >= 0 &&
      at.y >= 0 &&
      at.x + width <= VIEWPORT.width &&
      at.y + height <= VIEWPORT.height,
    "inside the viewport",
  );
});

test("AC20 the same with no split: a right-click on another tab offers Open below", async () => {
  const { cx, tree } = await mountNotes({ tab: "files" });
  handler(segment(tree, "changes"), "on_mouse_down", "right")?.(pointer, cx);
  assert.deepEqual(
    state.overlays.map((o) => o.spec.props),
    [{ sidebarMenu: { tab: "changes", op: "open-below" } }],
  );
});

test("AC20 on the bottom tab: Close below", async () => {
  const { cx, tree } = await mountNotes({ tab: "files", layout: STORED });
  handler(segment(tree, "changes"), "on_mouse_down", "right")?.(pointer, cx);
  assert.deepEqual(
    state.overlays.map((o) => o.spec.props),
    [{ sidebarMenu: { tab: "changes", op: "close-below" } }],
  );
});

test("AC20 on the top tab: no menu", async () => {
  const { cx, tree } = await mountNotes({ tab: "files", layout: STORED });
  const right = handler(segment(tree, "files"), "on_mouse_down", "right");
  assert.equal(
    typeof right,
    "function",
    "the top segment has the right-click handler too",
  );
  right(pointer, cx);
  assert.deepEqual(state.overlays, []);
});

test("AC20 a right-click starts no reorder and selects nothing", async () => {
  const { view, cx, tree } = await mountNotes({ tab: "files", layout: STORED });
  let stopped = 0;
  cx.stop_propagation = () => {
    stopped++;
  };
  const right = handler(segment(tree, "notes"), "on_mouse_down", "right");
  assert.equal(
    typeof right,
    "function",
    "the segment has a right-click handler",
  );
  right(pointer, cx);
  assert.equal(stopped, 1, "the right-click stops there");
  // A left move and release on another segment after the right press is not a drop.
  const other = segment(tree, "git");
  move(other, {}, cx);
  release(other, {}, cx);
  assert.deepEqual(state.shared[STORE], { tab: "files" }, "no tab selected");
  assert.deepEqual(layout(), STORED, "the order and the split are the same");
  const next = view.render(cx);
  assert.equal(findById(next, "sidebar-tabs-drop"), null, "no drop bar");
  assert.deepEqual(sections(next), { top: ["files"], bottom: ["changes"] });
});

// ---- The popup menu (props.sidebarMenu) ----

test("AC22 Open below on a third tab replaces the bottom one", async () => {
  await mountNotes({ tab: "files", layout: STORED });
  const menu = mountMenu({ tab: "git", op: "open-below" });
  const row = findById(menu.tree, "sidebar-menu-open-below");
  assert.ok(row, "the Open below row");
  assert.ok(texts(row).includes("Open below"));
  assert.equal(findById(menu.tree, "sidebar-menu-close-below"), null);
  row.onClick({}, menu.cx);
  assert.deepEqual(layout(), {
    ...STORED,
    split: { top: "files", below: "git" },
  });
  assert.deepEqual(state.closed, ["menu-1"], "the menu closes");
  assert.deepEqual(state.shared[STORE], { tab: "files" });
  const { view } = await mountNotes({ tab: "files", layout: layout() });
  const tree = view.render(fakeCx());
  assert.deepEqual(sections(tree), { top: ["files"], bottom: ["git"] });
  assert.equal(
    findById(tree, MARK.changes),
    null,
    "the old bottom tab is gone",
  );
});

test("AC21 the menu has an explicit size and Open below opens the split with the stored order kept", async () => {
  await mountNotes({ tab: "files", layout: { order: ORDER } });
  const menu = mountMenu({ tab: "changes", op: "open-below" });
  const root = findById(menu.tree, "sidebar-menu");
  assert.ok(root, "the sidebar-menu root");
  assert.ok(called(root, "w") && called(root, "h"), "explicit w and h");
  findById(menu.tree, "sidebar-menu-open-below").onClick({}, menu.cx);
  assert.deepEqual(layout(), {
    order: ORDER,
    split: FILES_OVER_CHANGES,
    splitTop: null,
  });
});

test("AC20 a stale Open below for the tab that is now on top writes nothing and closes", async () => {
  await mountNotes({ tab: "changes", layout: { order: ORDER } });
  const menu = mountMenu({ tab: "changes", op: "open-below" });
  const row = findById(menu.tree, "sidebar-menu-open-below");
  assert.ok(row, "the Open below row");
  row.onClick({}, menu.cx);
  assert.deepEqual(layout(), { order: ORDER });
  assert.deepEqual(state.closed, ["menu-1"]);
});

test("AC23 Close below in the menu removes the split and keeps the top tab and the order", async () => {
  await mountNotes({ tab: "files", layout: STORED });
  const menu = mountMenu({ tab: "changes", op: "close-below" });
  const row = findById(menu.tree, "sidebar-menu-close-below");
  assert.ok(row, "the Close below row");
  assert.ok(texts(row).includes("Close below"));
  row.onClick({}, menu.cx);
  assert.deepEqual(layout(), { ...STORED, split: null });
  assert.deepEqual(state.shared[STORE], { tab: "files" });
  assert.deepEqual(state.closed, ["menu-1"]);
});

test("AC20 Escape closes the tab menu and writes nothing", async () => {
  await mountNotes({ tab: "files", layout: STORED });
  const menu = mountMenu({ tab: "git", op: "open-below" });
  const key = handler(findById(menu.tree, "sidebar-menu"), "on_key_down");
  assert.equal(typeof key, "function", "the menu listens to keys");
  key({ key: "escape" }, menu.cx);
  assert.deepEqual(state.closed, ["menu-1"]);
  assert.deepEqual(layout(), STORED);
});

// ---- AC21: the two sections ----

test("AC21 Open below draws the group, two panels of at least 120 and the bottom header", async () => {
  const { view } = await mountNotes({
    tab: "files",
    layout: { split: FILES_OVER_CHANGES },
  });
  const tree = view.render(fakeCx());
  const group = findById(tree, "sidebar-split");
  assert.ok(group, "the sidebar-split group");
  assert.equal(group.kind, "resizable", "built with v_resizable");
  assert.ok(
    called(group, "flex_1") && has(group, "min_h", 0),
    "the group fills",
  );
  assert.equal(
    typeof handler(group, "on_resize"),
    "function",
    "the divider reports its sizes",
  );
  const [top, bottom] = panels(tree);
  assert.equal(panels(tree).length, 2, "two panels");
  for (const panel of [top, bottom])
    assert.ok(
      panel.calls.some(([n, a]) => n === "size_range" && a[0] === 120),
      "each panel is at least 120",
    );
  assert.equal(
    called(top, "size"),
    false,
    "no stored divider: first drawn 50/50",
  );
  assert.equal(called(bottom, "size"), false);
  assert.deepEqual(sections(tree), { top: ["files"], bottom: ["changes"] });
  const below = findById(bottom, "sidebar-below");
  assert.ok(below, "the bottom section is in the second panel");
  const header = findById(below, "sidebar-below-header");
  assert.ok(header, "the bottom header");
  assert.ok(has(header, "h", 28), "a 28 px header");
  assert.ok(texts(header).includes("Changes"), "the tab's label");
  assert.ok(
    walk(header).some((n) => n.kind === "svg"),
    "the tab's icon",
  );
  const close = findById(below, "sidebar-below-close");
  assert.ok(close, "the X");
  assert.ok(
    close.calls.some(([n, a]) => n === "tooltip" && a[0] === "Close"),
    "the X says Close",
  );
  const order = walk(bottom).map((n) => n.nodeId);
  assert.ok(
    order.indexOf("sidebar-below-header") < order.indexOf(MARK.changes),
    "the header comes before the body",
  );
  eachBodyOnce(tree);
});

test("AC21 on_resize stores splitTop and the next mount passes it to .size() of the top panel", async () => {
  const { view, cx } = await mountNotes({
    tab: "files",
    layout: { order: ORDER, split: FILES_OVER_CHANGES },
  });
  const group = findById(view.render(cx), "sidebar-split");
  const resize = handler(group, "on_resize");
  assert.equal(typeof resize, "function", "on_resize on the group");
  resize([200, 300], cx);
  assert.deepEqual(layout(), {
    order: ORDER,
    split: FILES_OVER_CHANGES,
    splitTop: 200,
  });
  const again = await mountNotes({ tab: "files", layout: layout() });
  const [top, bottom] = panels(again.view.render(fakeCx()));
  assert.ok(top, "the split is back");
  assert.ok(has(top, "size", 200), "the top panel starts at the stored height");
  assert.equal(called(bottom, "size"), false, "the bottom takes the rest");
});

test("AC21 no split is drawn with no stored pair", async () => {
  const { tree } = await mountNotes({ tab: "files", layout: { order: ORDER } });
  assert.equal(findById(tree, "sidebar-split"), null);
  assert.equal(findById(tree, "sidebar-below"), null);
  assert.deepEqual(sections(tree), { top: ["files"], bottom: null });
  // Control: the layout store was read (its order is drawn), so no split is not a store that was ignored.
  assert.deepEqual(
    segmentIds(tree),
    ORDER.map((tab) => `sidebar-tab-${tab}`),
  );
});

// ---- AC23: close ----

test("AC23 the X and Close below remove the bottom section and keep the top tab object", async () => {
  const { view, cx } = await mountNotes({ tab: "files", layout: STORED });
  const tree = view.render(cx);
  const filesTab = view.filesTab;
  assert.ok(filesTab, "the top tab object");
  const x = findById(tree, "sidebar-below-close");
  assert.ok(x, "the X");
  x.onClick({}, cx);
  assert.deepEqual(layout(), { ...STORED, split: null });
  assert.deepEqual(state.shared[STORE], { tab: "files" });
  const after = view.render(cx);
  assert.equal(findById(after, "sidebar-split"), null);
  assert.equal(findById(after, "sidebar-below"), null);
  assert.deepEqual(sections(after), { top: ["files"], bottom: null });
  assert.equal(view.filesTab, filesTab, "the same Files tab object");
});

// ---- AC24: swap ----

const SWAPPED = { ...STORED, split: { top: "changes", below: "files" } };

test("AC24 picking the bottom tab swaps the two (click): the pane writes the fix at once", async () => {
  const { view, cx, tree } = await mountNotes({ tab: "files", layout: STORED });
  click(segment(tree, "changes"), cx);
  assert.deepEqual(state.shared[STORE], { tab: "changes" });
  assert.deepEqual(
    layout(),
    SWAPPED,
    "the pair, the order and the divider in one write",
  );
  const after = view.render(cx);
  assert.deepEqual(sections(after), { top: ["changes"], bottom: ["files"] });
  eachBodyOnce(after);
});

test("AC24 picking the bottom tab swaps the two (rail): the fix is written at once and the swap shows back wide", async () => {
  const { view, cx } = await mountNotes({
    width: 44,
    tab: "files",
    layout: STORED,
  });
  const icon = findById(view.render(cx), "sidebar-rail-changes");
  assert.ok(icon, "the rail icon");
  icon.onClick(null, cx);
  assert.deepEqual(state.shared[STORE], { tab: "changes" });
  assert.deepEqual(layout(), SWAPPED);
  widthTo(380);
  const after = view.render(cx);
  assert.deepEqual(sections(after), { top: ["changes"], bottom: ["files"] });
  eachBodyOnce(after);
});

test("AC24 picking the bottom tab swaps the two (key): the same render shows the swap, the deferred task writes the fix", async () => {
  const { view, cx } = await mountNotes({ tab: "files", layout: STORED });
  await runTabsCommand("herdsidian-tabs.changes");
  assert.deepEqual(state.shared[STORE], { tab: "changes" });
  const first = view.render(cx);
  assert.deepEqual(
    sections(first),
    { top: ["changes"], bottom: ["files"] },
    "derived in the same render",
  );
  eachBodyOnce(first);
  await renderAndSettle(view);
  assert.deepEqual(layout(), SWAPPED);
  const after = view.render(cx);
  assert.deepEqual(sections(after), { top: ["changes"], bottom: ["files"] });
  eachBodyOnce(after);
});

test("AC24 picking the bottom tab swaps the two (⌘K Settings row)", async () => {
  const { view, cx } = await mountNotes({ tab: "files", layout: STORED });
  const action = settingsRow("files");
  assert.equal(
    action,
    "herdsidian-tabs.changes",
    "the row picks the next tab in the fixed order",
  );
  await runTabsCommand(action);
  assert.deepEqual(sections(view.render(cx)), {
    top: ["changes"],
    bottom: ["files"],
  });
  await renderAndSettle(view);
  assert.deepEqual(layout(), SWAPPED);
});

test("AC24 render does not write the fix itself, and with a sleep that never ends nothing is written", async () => {
  const { view, cx } = await mountNotes({ tab: "files", layout: STORED });
  await runTabsCommand("herdsidian-tabs.changes");
  view.render(cx);
  assert.deepEqual(layout(), STORED, "render wrote nothing");
  await settle();
  assert.deepEqual(layout(), STORED, "the fake sleep never resolves");
  assert.deepEqual(
    sections(view.render(cx)),
    { top: ["changes"], bottom: ["files"] },
    "the drawn sections do not wait for the fix",
  );
});

test("AC24 the deferred fix reads the stores again: a tab switched back before it runs writes nothing", async () => {
  const { view } = await mountNotes({ tab: "files", layout: STORED });
  await runTabsCommand("herdsidian-tabs.changes");
  const tree = view.render(cxWithSleep());
  assert.deepEqual(
    sections(tree),
    { top: ["changes"], bottom: ["files"] },
    "control: the render saw the swap",
  );
  // As route() does: { tab } written again before the deferred task runs.
  state.shared[STORE] = { tab: "files" };
  await settle();
  assert.deepEqual(layout(), STORED);
});

test("AC24 the top tab bar selects the top tab: a click on it keeps the pair", async () => {
  const { view, cx, tree } = await mountNotes({ tab: "files", layout: STORED });
  click(segment(tree, "files"), cx);
  assert.deepEqual(state.shared[STORE], { tab: "files" });
  assert.deepEqual(layout(), STORED);
  assert.deepEqual(sections(view.render(cx)), {
    top: ["files"],
    bottom: ["changes"],
  });
});

test("AC24 no tab is drawn in both sections, for every stored tab with the pair", async () => {
  for (const tab of TABS) {
    const { view, cx } = await mountNotes({ tab, layout: STORED });
    const tree = view.render(cx);
    eachBodyOnce(tree);
    const { top, bottom } = sections(tree);
    assert.ok(bottom, `${tab}: split drawn`);
    assert.deepEqual(top, [tab], `${tab} on top`);
    assert.equal(bottom.length, 1, `${tab}: one body below`);
    assert.ok(!top.includes(bottom[0]), `${tab}: not in both`);
  }
});

test("AC24 the stored divider is kept on a swap", async () => {
  const { view, cx, tree } = await mountNotes({ tab: "files", layout: STORED });
  click(segment(tree, "changes"), cx);
  assert.equal(layout().splitTop, 240);
  const [top] = panels(view.render(cx));
  assert.ok(
    top && has(top, "size", 240),
    "the top panel keeps the stored height",
  );
});

// ---- AC25: keys with a split ----

test("AC25 the top tab's key hides the sidebar", async () => {
  const { view, cx } = await mountNotes({ tab: "files", layout: STORED });
  assert.deepEqual(
    sections(view.render(cx)),
    { top: ["files"], bottom: ["changes"] },
    "control: split",
  );
  await runTabsCommand("herdsidian-tabs.files");
  assert.deepEqual(state.runs, [["layout.hide", { id: "herdsidian" }]]);
  assert.deepEqual(state.shared[STORE], { tab: "files" });
  assert.deepEqual(layout(), STORED);
});

test("AC25 the bottom tab's key swaps", async () => {
  const { view, cx } = await mountNotes({ tab: "files", layout: STORED });
  await runTabsCommand("herdsidian-tabs.changes");
  assert.deepEqual(state.runs, [], "the sidebar stays shown");
  assert.deepEqual(sections(view.render(cx)), {
    top: ["changes"],
    bottom: ["files"],
  });
  await renderAndSettle(view);
  assert.deepEqual(layout(), SWAPPED);
});

test("AC25 a third tab's key goes on top and keeps the bottom", async () => {
  const { view, cx } = await mountNotes({ tab: "files", layout: STORED });
  await runTabsCommand("herdsidian-tabs.git");
  assert.deepEqual(state.runs, []);
  assert.deepEqual(state.shared[STORE], { tab: "git" });
  const first = view.render(cx);
  assert.deepEqual(sections(first), { top: ["git"], bottom: ["changes"] });
  assert.equal(findById(first, MARK.files), null, "the old top is gone");
  await renderAndSettle(view);
  assert.deepEqual(layout(), {
    ...STORED,
    split: { top: "git", below: "changes" },
  });
});

test("AC25 a third tab by click goes on top and keeps the bottom, fixed at once", async () => {
  const { view, cx, tree } = await mountNotes({ tab: "files", layout: STORED });
  click(segment(tree, "notes"), cx);
  assert.deepEqual(layout(), {
    ...STORED,
    split: { top: "notes", below: "changes" },
  });
  assert.deepEqual(sections(view.render(cx)), {
    top: ["notes"],
    bottom: ["changes"],
  });
});

// ---- AC26: the rail ----

test("AC26 the rail draws no split and marks the top tab", async () => {
  const { view, cx } = await mountNotes({ tab: "files", layout: STORED });
  assert.deepEqual(
    sections(view.render(cx)),
    { top: ["files"], bottom: ["changes"] },
    "control: split while wide",
  );
  widthTo(44);
  const tree = view.render(cx);
  assert.ok(findById(tree, "sidebar-rail-files"), "the rail is drawn");
  assert.equal(findById(tree, "sidebar-split"), null);
  assert.equal(findById(tree, "sidebar-below"), null);
  const marked = TABS.filter((tab) =>
    called(findById(tree, `sidebar-rail-${tab}`), "bg"),
  );
  assert.deepEqual(marked, ["files"]);
  assert.deepEqual(layout(), STORED, "the rail does not touch the store");
});

test("AC26 back to wide the split and the stored divider return", async () => {
  const { view, cx } = await mountNotes({
    width: 44,
    tab: "files",
    layout: STORED,
  });
  view.render(cx);
  widthTo(380);
  const tree = view.render(cx);
  assert.deepEqual(sections(tree), { top: ["files"], bottom: ["changes"] });
  const [top] = panels(tree);
  assert.ok(has(top, "size", 240), "the top panel starts at the stored height");
  assert.deepEqual(layout(), STORED);
});

test("AC26 wide, then the rail, then wide again keeps the split", async () => {
  const { view, cx } = await mountNotes({ tab: "files", layout: STORED });
  assert.deepEqual(sections(view.render(cx)), {
    top: ["files"],
    bottom: ["changes"],
  });
  widthTo(44);
  assert.equal(findById(view.render(cx), "sidebar-split"), null);
  widthTo(380);
  assert.deepEqual(sections(view.render(cx)), {
    top: ["files"],
    bottom: ["changes"],
  });
  assert.deepEqual(layout(), STORED);
});

// ---- AC27: persistence ----

test("AC27 the bottom tab survives a re-mount", async () => {
  await mountNotes({ tab: "files", layout: { order: ORDER } });
  const menu = mountMenu({ tab: "changes", op: "open-below" });
  findById(menu.tree, "sidebar-menu-open-below")?.onClick({}, menu.cx);
  const saved = layout();
  const { view, cx } = await mountNotes({ tab: "files", layout: saved });
  assert.deepEqual(sections(view.render(cx)), {
    top: ["files"],
    bottom: ["changes"],
  });
});

test("AC27 a swapped pair survives a re-mount", async () => {
  const first = await mountNotes({ tab: "files", layout: STORED });
  click(segment(first.tree, "changes"), first.cx);
  const saved = layout();
  const { view, cx } = await mountNotes({ tab: "changes", layout: saved });
  assert.deepEqual(sections(view.render(cx)), {
    top: ["changes"],
    bottom: ["files"],
  });
});

for (const [label, split] of [
  ["unknown", { top: "files", below: "nope" }],
  ["equal to the top", { top: "files", below: "files" }],
  ["not an object", "changes"],
]) {
  test(`AC27 a stored bottom tab that is ${label} gives no split`, async () => {
    const { view, cx } = await mountNotes({
      tab: "files",
      layout: { order: ORDER, split },
    });
    const tree = view.render(cx);
    assert.equal(findById(tree, "sidebar-split"), null);
    assert.equal(findById(tree, "sidebar-below"), null);
    assert.deepEqual(sections(tree), { top: ["files"], bottom: null });
    // Control: the order is still read, so the layout store was read at all.
    assert.deepEqual(
      segmentIds(tree),
      ORDER.map((tab) => `sidebar-tab-${tab}`),
    );
  });
}

test("AC27 a bad stored pair is not drawn after a re-mount on its own top either", async () => {
  const { view, cx } = await mountNotes({
    tab: "changes",
    layout: { order: ORDER, split: { top: "changes", below: "changes" } },
  });
  const tree = view.render(cx);
  assert.deepEqual(sections(tree), { top: ["changes"], bottom: null });
  assert.deepEqual(
    segmentIds(tree),
    ORDER.map((tab) => `sidebar-tab-${tab}`),
    "control: the layout store was read",
  );
});

// ---- AC28: shown-state ----

// Mounts Changes over Git and counts the Git tab's left() calls from here on.
async function gitBelow() {
  const m = await mountNotes({
    tab: "changes",
    layout: { order: ORDER, split: { top: "changes", below: "git" } },
  });
  assert.deepEqual(
    sections(m.view.render(m.cx)),
    { top: ["changes"], bottom: ["git"] },
    "Git is drawn below",
  );
  assert.ok(m.view.gitTab, "Git below is built");
  const counter = { left: 0 };
  const left = m.view.gitTab.left.bind(m.view.gitTab);
  m.view.gitTab.left = (...args) => {
    counter.left++;
    return left(...args);
  };
  return { ...m, counter };
}

test("AC28 Git below is not told it left", async () => {
  const m = await gitBelow();
  for (let i = 0; i < 3; i++) m.view.render(m.cx);
  assert.deepEqual(sections(m.view.render(m.cx)), {
    top: ["changes"],
    bottom: ["git"],
  });
  assert.equal(m.counter.left, 0);
});

test("AC28 a swap is not a leave (click)", async () => {
  const m = await gitBelow();
  click(segment(m.view.render(m.cx), "git"), m.cx);
  m.view.render(m.cx);
  assert.deepEqual(sections(m.view.render(m.cx)), {
    top: ["git"],
    bottom: ["changes"],
  });
  assert.equal(m.counter.left, 0);
});

test("AC28 a swap is not a leave (key, before and after the deferred fix)", async () => {
  const m = await gitBelow();
  await runTabsCommand("herdsidian-tabs.git");
  m.view.render(m.cx);
  assert.equal(m.counter.left, 0, "the render with the stale pair");
  await renderAndSettle(m.view);
  m.view.render(m.cx);
  assert.equal(m.counter.left, 0);
  assert.deepEqual(layout().split, { top: "git", below: "changes" });
});

test("AC28 a third tab on top with Git below is not a leave", async () => {
  const m = await gitBelow();
  click(segment(m.view.render(m.cx), "files"), m.cx);
  const tree = m.view.render(m.cx);
  assert.deepEqual(sections(tree), { top: ["files"], bottom: ["git"] });
  assert.equal(m.counter.left, 0);
});

test("AC28 a tab out of both sections is told it left: Close below", async () => {
  const m = await gitBelow();
  const menu = mountMenu({ tab: "git", op: "close-below" });
  const row = findById(menu.tree, "sidebar-menu-close-below");
  assert.ok(row, "the Close below row");
  row.onClick({}, menu.cx);
  m.view.render(m.cx);
  assert.equal(m.counter.left, 1);
});

test("AC28 a tab out of both sections is told it left: the X", async () => {
  const m = await gitBelow();
  findById(m.view.render(m.cx), "sidebar-below-close")?.onClick({}, m.cx);
  assert.equal(layout().split, null);
  m.view.render(m.cx);
  assert.equal(m.counter.left, 1);
});

test("AC28 a tab out of both sections is told it left: the rail", async () => {
  const m = await gitBelow();
  widthTo(44);
  m.view.render(m.cx);
  assert.equal(m.counter.left, 1);
});

// The Files tab as main.js builds it: its 10 s timer, with refresh() counted.
function filesTab() {
  const cx = fakeCx(),
    timers = [];
  cx.timer.every = (ms, fn) => {
    timers.push([ms, fn]);
  };
  const host = { cx: null };
  let tab;
  during(cx, (scoped) => {
    host.cx = scoped;
    tab = new FilesTab(host);
  });
  const counter = { refreshed: 0 };
  tab.refresh = () => {
    counter.refreshed++;
  };
  return { tick: () => timers[0][1](cx), counter };
}

test("AC28 Files and Changes below do their work: the Files timer refreshes while Files is below", () => {
  const files = filesTab();
  state.shared[STORE] = { tab: "changes" };
  state.shared[LAYOUT_STORE] = { split: { top: "changes", below: "files" } };
  files.tick();
  assert.equal(files.counter.refreshed, 1, "Files below counts as shown");
  state.shared[LAYOUT_STORE] = { split: null };
  files.tick();
  assert.equal(
    files.counter.refreshed,
    1,
    "Files in neither section does not refresh",
  );
});

test("AC28 Files and Changes below do their work: Changes below is built and drawn in the bottom panel", async () => {
  const { view, cx } = await mountNotes({
    tab: "files",
    layout: { split: FILES_OVER_CHANGES },
  });
  const tree = view.render(cx);
  assert.ok(view.changesTab, "the Changes tab object exists");
  const [, bottom] = panels(tree);
  assert.ok(
    bottom && findById(bottom, MARK.changes),
    "the Changes body is in the bottom panel",
  );
});

// ---- AC29: reorder while split ----

test("AC29 a reorder works while split and the badge stays on Changes", async () => {
  const { view, cx, tree } = await mountNotes({
    tab: "files",
    layout: { order: TABS, split: FILES_OVER_CHANGES, splitTop: 240 },
  });
  // Set after the mount, which clears the stores.
  state.shared["herdsidian.changes"] = { count: 3 };
  // Middle pair: Files (index 1) dropped on Changes (index 2).
  press(segment(tree, "files"), {}, cx);
  move(segment(tree, "changes"), {}, cx);
  release(segment(tree, "changes"), {}, cx);
  assert.deepEqual(layout(), {
    order: ["notes", "changes", "files", "git"],
    split: FILES_OVER_CHANGES,
    splitTop: 240,
  });
  assert.deepEqual(
    state.shared[STORE],
    { tab: "files" },
    "the top tab does not change",
  );
  const after = view.render(cx);
  assert.deepEqual(
    segmentIds(after),
    ["notes", "changes", "files", "git"].map((tab) => `sidebar-tab-${tab}`),
  );
  assert.deepEqual(sections(after), { top: ["files"], bottom: ["changes"] });
  const badge = findById(after, "sidebar-changes-badge");
  assert.ok(badge, "the badge");
  assert.ok(
    walk(segment(after, "changes")).includes(badge),
    "the badge is on the Changes segment",
  );
  assert.deepEqual(badge.kids, ["3"]);
});
