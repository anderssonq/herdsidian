// The sidebar tab order as data (AC15, AC16, critical): readOrder, readSidebarLayout and moveTab never
// lose or repeat a tab, the mounted sidebar shows each tab once, and no switch or reorder drops the order or the tab.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  state,
  settle,
  findById,
  walk,
  fakeCx,
  cxWithSleep,
  mountNotes,
  click,
  press,
  move,
  release,
  STORE,
  LAYOUT_STORE,
  TABS,
} from "./support/sidebar-kit.js";

// A namespace import, so a missing export fails each test, not the whole file.
const sidebar = await import("../lib/sidebar.js");
const { default: Tabs } = await import("../mods/herdsidian-tabs/main.js");
const { commandList } = await import("../mods/herdsidian/palette.js");
const { settingSections } = await import("../lib/keys.js");

const CANONICAL = Object.freeze(["notes", "files", "changes", "git"]);
const CUSTOM = Object.freeze(["changes", "git", "notes", "files"]);
const LEFT = { button: "left", pressed_button: "left" };
// A move as GPUI sends it: the left button held, the pointer inside the segment's box (block 380: slot 78 x 26).
const MOVE = {
  position: { x: 200, y: 20 },
  local_position: { x: 39, y: 13 },
  bounds: { x: 161, y: 7, width: 78, height: 26 },
  modifiers: {},
  pressed_button: "left",
};

// Each stored value of AC15 and the order it must read as.
const ORDER_FIXTURES = Object.freeze([
  ["undefined", undefined, CANONICAL],
  ["null", null, CANONICAL],
  ["a string", "git", CANONICAL],
  ["an object", Object.freeze({}), CANONICAL],
  ["an array-like object", Object.freeze({ 0: "git", length: 1 }), CANONICAL],
  ["a number", 3, CANONICAL],
  ["an empty array", Object.freeze([]), CANONICAL],
  ['["git"]', Object.freeze(["git"]), ["git", "notes", "files", "changes"]],
  [
    '["git","git","x"]',
    Object.freeze(["git", "git", "x"]),
    ["git", "notes", "files", "changes"],
  ],
  [
    "5 entries with an unknown id",
    Object.freeze(["changes", "settings", "git", "files", "notes"]),
    ["changes", "git", "files", "notes"],
  ],
  [
    "5 entries with a repeat",
    Object.freeze(["files", "notes", "files", "git", "changes"]),
    ["files", "notes", "git", "changes"],
  ],
  ["a full custom order", CUSTOM, CUSTOM],
  [
    "numbers in the array",
    Object.freeze([3, "changes", 0, "notes"]),
    ["changes", "notes", "files", "git"],
  ],
  [
    "null, objects and another case in the array",
    Object.freeze([null, Object.freeze({}), "Files", "git"]),
    ["git", "notes", "files", "changes"],
  ],
]);

const isPermutation = (order) =>
  Array.isArray(order) &&
  order.length === CANONICAL.length &&
  new Set(order).size === CANONICAL.length &&
  CANONICAL.every((id) => order.includes(id));

const segments = (tree) =>
  walk(tree)
    .map((n) => n.nodeId)
    .filter((id) => id?.startsWith("sidebar-tab-"))
    .map((id) => id.slice("sidebar-tab-".length));
const railIcons = (tree) =>
  walk(tree)
    .map((n) => n.nodeId)
    .filter((id) => id?.startsWith("sidebar-rail-"))
    .map((id) => id.slice("sidebar-rail-".length));

const storedOrder = () => state.shared[LAYOUT_STORE]?.order;

// Renders with a cx whose sleep resolves, so a deferred re-render or store fix runs, then lets it finish.
async function renderSettled(view) {
  const cx = cxWithSleep();
  view.render(cx);
  await settle();
  return view.render(cx);
}

// A drag from one segment to another, re-rendering between steps as GPUI does after each notify.
async function reorder(view, from, to) {
  const cx = cxWithSleep();
  press(findById(view.render(cx), `sidebar-tab-${from}`), { ...LEFT }, cx);
  move(
    findById(view.render(cx), `sidebar-tab-${to}`),
    structuredClone(MOVE),
    cx,
  );
  release(findById(view.render(cx), `sidebar-tab-${to}`), { ...LEFT }, cx);
  await settle();
}

// Runs one herdsidian-tabs command through a mounted herdsidian-tabs, as a key, a ⌘K row or a Settings row does.
// Local helper: the kit's mountTabs clears the shared stores, and this test needs them kept.
async function runTabsCommand(action) {
  assert.equal(action.type, "run");
  assert.ok(action.name.startsWith("herdsidian-tabs."), action.name);
  state.commands = [action.name.slice("herdsidian-tabs.".length)];
  new Tabs().init({}, fakeCx());
  await settle();
}

// AC15: the pure rules

test("AC15 readOrder gives a permutation for every fixture", () => {
  for (const [label, value, expected] of ORDER_FIXTURES) {
    const order = sidebar.readOrder(value);
    assert.ok(isPermutation(order), `${label}: ${JSON.stringify(order)}`);
    assert.deepEqual(order, expected, label);
  }
});

test("AC15 readSidebarLayout never throws and always gives a permutation as the order", () => {
  const raws = [
    ...ORDER_FIXTURES.map(([, value]) => value),
    ...ORDER_FIXTURES.map(([, value]) => Object.freeze({ order: value })),
    Object.freeze({ order: CUSTOM, split: "x", splitTop: "y" }),
    Object.freeze({ split: 5, splitTop: -1 }),
  ];
  for (const raw of raws) {
    let layout;
    assert.doesNotThrow(() => {
      layout = sidebar.readSidebarLayout(raw);
    }, JSON.stringify(raw));
    assert.ok(isPermutation(layout.order), JSON.stringify(raw));
  }
  assert.deepEqual(
    sidebar.readSidebarLayout(Object.freeze({ order: CUSTOM })).order,
    CUSTOM,
  );
});

test("AC15 readSidebarLayout never returns a split with an unknown or equal pair", () => {
  const bad = [
    null,
    "files",
    3,
    Object.freeze([]),
    Object.freeze({}),
    Object.freeze({ top: "files" }),
    Object.freeze({ below: "git" }),
    Object.freeze({ top: "git", below: "git" }),
    Object.freeze({ top: "files", below: "nope" }),
    Object.freeze({ top: "nope", below: "files" }),
    Object.freeze({ top: "settings", below: "git" }),
    Object.freeze({ top: "Files", below: "git" }),
    Object.freeze({ top: 1, below: 2 }),
  ];
  for (const split of bad) {
    const layout = sidebar.readSidebarLayout(
      Object.freeze({ order: CUSTOM, split }),
    );
    assert.equal(layout.split, null, JSON.stringify(split));
    assert.deepEqual(layout.order, CUSTOM, JSON.stringify(split));
  }
  const kept = sidebar.readSidebarLayout(
    Object.freeze({
      order: CUSTOM,
      split: Object.freeze({ top: "files", below: "git" }),
    }),
  );
  assert.deepEqual(kept.split, { top: "files", below: "git" });
});

test("AC15 moveTab from the middle and the edges always gives a permutation", () => {
  const order = Object.freeze(["git", "notes", "files", "changes"]);
  const cases = [
    ["index 1 -> 2", "notes", "files", ["git", "files", "notes", "changes"]],
    ["index 2 -> 1", "files", "notes", ["git", "files", "notes", "changes"]],
    ["index 0 -> 3", "git", "changes", ["notes", "files", "changes", "git"]],
    ["index 3 -> 0", "changes", "git", ["changes", "git", "notes", "files"]],
    ["same id", "files", "files", order],
    ["unknown from", "nope", "files", order],
    ["unknown to", "files", "nope", order],
  ];
  for (const [label, from, to, expected] of cases) {
    const next = sidebar.moveTab(order, from, to);
    assert.ok(isPermutation(next), `${label}: ${JSON.stringify(next)}`);
    assert.deepEqual(next, expected, label);
  }
  assert.deepEqual(order, ["git", "notes", "files", "changes"], "input kept");
});

// AC15: the mounted sidebar

test("AC15 the tab control and the rail show each tab once for every stored value", async () => {
  for (const [label, value, expected] of ORDER_FIXTURES) {
    const stored = [Object.freeze({ order: value })];
    if (value !== undefined) stored.push(value);
    for (const layout of stored) {
      const name = `${label} as ${layout === value ? "the whole store" : "order"}`;
      const wide = await mountNotes({ layout });
      const shown = segments(wide.tree);
      assert.ok(isPermutation(shown), `tab control, ${name}: ${shown}`);
      assert.deepEqual(shown, layout === value ? CANONICAL : expected, name);
      const rail = await mountNotes({ width: 44, layout });
      const icons = railIcons(rail.tree);
      assert.ok(isPermutation(icons), `rail, ${name}: ${icons}`);
      assert.deepEqual(icons, layout === value ? CANONICAL : expected, name);
    }
  }
});

// AC16: the order survives

test("AC16 a re-mount reads the order back", async () => {
  const layout = Object.freeze({ order: CUSTOM, split: null, splitTop: null });
  const first = await mountNotes({ tab: "notes", layout });
  assert.deepEqual(segments(first.tree), CUSTOM);
  assert.deepEqual(segments(await renderSettled(first.view)), CUSTOM);
  assert.deepEqual(storedOrder(), CUSTOM, "a render keeps the stored order");

  const again = await mountNotes({
    tab: "notes",
    layout: state.shared[LAYOUT_STORE],
  });
  assert.deepEqual(segments(again.tree), CUSTOM);
  const rail = await mountNotes({ width: 44, tab: "notes", layout });
  assert.deepEqual(railIcons(rail.tree), CUSTOM);
});

test("AC16 a re-mount reads back the order a reorder stored", async () => {
  const { view } = await mountNotes({
    tab: "git",
    layout: Object.freeze({ order: CUSTOM }),
  });
  await reorder(view, "git", "notes");
  const saved = storedOrder();
  assert.ok(isPermutation(saved), JSON.stringify(saved));
  assert.notDeepEqual(
    saved,
    CUSTOM,
    "the reorder stored a new order (control)",
  );
  const again = await mountNotes({
    tab: "git",
    layout: structuredClone(state.shared[LAYOUT_STORE]),
  });
  assert.deepEqual(segments(again.tree), saved);
});

test("AC16 a tab switch by a segment click leaves the order", async () => {
  const { view } = await mountNotes({
    tab: "notes",
    layout: Object.freeze({ order: CUSTOM }),
  });
  const cx = cxWithSleep();
  click(findById(view.render(cx), "sidebar-tab-git"), cx);
  await settle();
  assert.deepEqual(
    state.shared[STORE],
    { tab: "git" },
    "the click switched (control)",
  );
  assert.deepEqual(storedOrder(), CUSTOM);
  assert.deepEqual(segments(await renderSettled(view)), CUSTOM);
});

test("AC16 a tab switch by a rail click leaves the order", async () => {
  const { view } = await mountNotes({
    width: 44,
    tab: "notes",
    layout: Object.freeze({ order: CUSTOM }),
  });
  const cx = cxWithSleep();
  findById(view.render(cx), "sidebar-rail-files").onClick(null, cx);
  await settle();
  assert.deepEqual(
    state.shared[STORE],
    { tab: "files" },
    "the rail switched (control)",
  );
  assert.deepEqual(storedOrder(), CUSTOM);
  assert.deepEqual(railIcons(await renderSettled(view)), CUSTOM);
});

for (const tab of TABS) {
  test(`AC16 a tab switch by the key herdsidian-tabs.${tab} leaves the order`, async () => {
    const from = tab === "changes" ? "files" : "changes";
    const { view } = await mountNotes({
      tab: from,
      layout: Object.freeze({ order: CUSTOM }),
    });
    await runTabsCommand({
      type: "run",
      name: `herdsidian-tabs.${tab}`,
      args: {},
    });
    assert.deepEqual(
      state.shared[STORE],
      { tab },
      "the key switched (control)",
    );
    assert.deepEqual(segments(await renderSettled(view)), CUSTOM);
    assert.deepEqual(storedOrder(), CUSTOM);
  });
}

test("AC16 a tab switch by the ⌘K Notes row leaves the order", async () => {
  const { view } = await mountNotes({
    tab: "files",
    layout: Object.freeze({ order: CUSTOM }),
  });
  const row = commandList({
    vault: "/vault/my notes",
    sidebarHidden: false,
    sidebarTab: "files",
    space: { id: "s1", name: "work", folder: "/r/work" },
    starter: { name: "Claude Code", run: ["claude"] },
    bindings: [],
    layoutName: "herdsidian",
  }).find((c) => c.id === "notes");
  await runTabsCommand(row.action);
  assert.deepEqual(
    state.shared[STORE],
    { tab: "notes" },
    "the row switched (control)",
  );
  assert.deepEqual(segments(await renderSettled(view)), CUSTOM);
  assert.deepEqual(storedOrder(), CUSTOM);
});

test("AC16 a tab switch by the Settings row leaves the order", async () => {
  const { view } = await mountNotes({
    tab: "files",
    layout: Object.freeze({ order: CUSTOM }),
  });
  const row = settingSections({
    settings: { keyHints: "modifier", usageInStatus: true },
    sidebarHidden: false,
    sidebarRail: false,
    sidebarTab: "files",
  })
    .flatMap((s) => s.rows)
    .find((r) => r.id === "sidebar-tab");
  await runTabsCommand(row.action);
  assert.deepEqual(
    state.shared[STORE],
    { tab: "changes" },
    "the row switched (control)",
  );
  assert.deepEqual(segments(await renderSettled(view)), CUSTOM);
  assert.deepEqual(storedOrder(), CUSTOM);
});

test("AC16 a write of { tab } as route() does leaves the order", async () => {
  const { view } = await mountNotes({
    tab: "notes",
    layout: Object.freeze({ order: CUSTOM }),
  });
  state.shared[STORE] = { tab: "files" };
  assert.deepEqual(segments(await renderSettled(view)), CUSTOM);
  assert.deepEqual(storedOrder(), CUSTOM);
});

test("AC16 a reorder leaves the stored tab", async () => {
  const { view } = await mountNotes({
    tab: "git",
    layout: Object.freeze({ order: CANONICAL }),
  });
  const before = structuredClone(state.shared[STORE]);
  await reorder(view, "files", "changes");
  assert.notDeepEqual(storedOrder(), CANONICAL, "the reorder ran (control)");
  assert.ok(isPermutation(storedOrder()), JSON.stringify(storedOrder()));
  assert.deepEqual(state.shared[STORE], before);
  await renderSettled(view);
  assert.deepEqual(state.shared[STORE], before);
});

test("AC16 a reorder leaves the stored tab when it was never set", async () => {
  const { view } = await mountNotes({
    layout: Object.freeze({ order: CANONICAL }),
  });
  const before = structuredClone(state.shared[STORE]);
  await reorder(view, "changes", "files");
  assert.notDeepEqual(storedOrder(), CANONICAL, "the reorder ran (control)");
  assert.ok(isPermutation(storedOrder()), JSON.stringify(storedOrder()));
  assert.deepEqual(state.shared[STORE], before);
  await renderSettled(view);
  assert.deepEqual(state.shared[STORE], before);
});
