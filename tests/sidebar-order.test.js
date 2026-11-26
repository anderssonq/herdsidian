// Reorder of the sidebar tabs (AC12 to AC14, AC17 to AC19): the pure drag machine, then the mounted tab
// control and rail. Handlers are called straight from the recorded tree, as the drag tests of the other files do.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  state,
  fakeCx,
  findById,
  walk,
  settle,
  mountNotes,
  press,
  move,
  release,
  click,
  handler,
  transitionOf,
  styleOf,
  STORE,
  LAYOUT_STORE,
  TABS,
} from "./support/sidebar-kit.js";

// A missing module or export must fail each test on its own, not the whole file.
const dragMod = await import("../mods/herdsidian/sidebar-drag.js").catch(
  () => ({}),
);
const viewMod = await import("../mods/herdsidian/sidebar-view.js").catch(
  () => ({}),
);
const { dragStep, dropSide, outside } = dragMod;
const { tabControl, tabTips } = viewMod;

const call = (fn, name) => {
  assert.equal(typeof fn, "function", `${name} is exported`);
  return fn;
};

// Segment, rail icon and control of a recorded tree.
const seg = (tree, id) => findById(tree, `sidebar-tab-${id}`);
const control = (tree) => findById(tree, "sidebar-tabs");
const shownOrder = (tree) =>
  walk(tree)
    .map((n) => n.nodeId)
    .filter(
      (id) =>
        id?.startsWith("sidebar-tab-") &&
        TABS.includes(id.slice("sidebar-tab-".length)),
    )
    .map((id) => id.slice("sidebar-tab-".length));
const railOrder = (tree) =>
  walk(tree)
    .map((n) => n.nodeId)
    .filter((id) => id?.startsWith("sidebar-rail-"))
    .map((id) => id.slice("sidebar-rail-".length));
const storedOrder = () => state.shared[LAYOUT_STORE]?.order ?? TABS;
const bars = (tree) =>
  walk(tree).filter((n) => n.nodeId === "sidebar-tabs-drop");
const selectedSegments = (tree) =>
  TABS.filter((id) =>
    seg(tree, id)?.calls.some(
      ([name, args]) => name === "font_weight" && args[0] === 500,
    ),
  );
const num = (v) => Number.parseFloat(String(v));
const hasCall = (node, name) => node.calls.some(([n]) => n === name);

// Pointer events: the control is 324 wide and 32 tall (block 380 minus the 56 px header).
const BOUNDS = { width: 324, height: 32 };
const at = (x, y = 10) => ({ position: { x, y }, local_position: { x, y } });
const win = (x, y, button = "left") => ({
  pressed_button: button,
  local_position: { x, y },
  bounds: BOUNDS,
});

const mount = async (opts = {}) => {
  const { view, cx } = await mountNotes(opts);
  const tree = () => view.render(cx);
  return { view, cx, tree, runs: [...state.runs] };
};

// The tree after a switch has settled: the first render of a switch draws the old pill slot.
const settledTree = (mounted) => {
  mounted.tree();
  return mounted.tree();
};

const CUSTOM = ["git", "notes", "files", "changes"];

// Every segment takes a left press, a move and a left release: the drag is wired.
const assertWired = (tree) => {
  for (const id of TABS) {
    assert.equal(
      typeof handler(seg(tree, id), "on_mouse_down", "left"),
      "function",
      `${id} has a left press`,
    );
    assert.equal(
      typeof handler(seg(tree, id), "on_mouse_move"),
      "function",
      `${id} has a move`,
    );
    assert.equal(
      typeof handler(seg(tree, id), "on_mouse_up", "left"),
      "function",
      `${id} has a left release`,
    );
  }
};

// ---------------------------------------------------------------------------------------------------------------
// dragStep, dropSide, outside (pure)

test("AC12 dragStep: press starts a drag on the pressed segment", () => {
  const step = call(dragStep, "dragStep")(null, { type: "press", id: "files" });
  assert.equal(step.move, null);
  assert.equal(step.state.from, "files");
  assert.deepEqual(dropSide(TABS, step.state, "files"), null);
});

test("AC14 dragStep: a move over another segment sets where the pointer is", () => {
  const start = call(dragStep, "dragStep")(null, {
    type: "press",
    id: "files",
  }).state;
  const step = dragStep(start, { type: "move", id: "changes" });
  assert.equal(step.move, null);
  assert.deepEqual(
    { from: step.state.from, over: step.state.over },
    { from: "files", over: "changes" },
  );
});

test("AC12 dragStep: a move with no drag does nothing", () => {
  assert.deepEqual(
    call(dragStep, "dragStep")(null, { type: "move", id: "changes" }),
    { state: null, move: null },
  );
});

test("AC12 dragStep: a release on another segment moves and ends the drag", () => {
  const start = call(dragStep, "dragStep")(null, {
    type: "press",
    id: "files",
  }).state;
  const over = dragStep(start, { type: "move", id: "changes" }).state;
  assert.deepEqual(dragStep(over, { type: "release", id: "changes" }), {
    state: null,
    move: { from: "files", to: "changes" },
  });
});

test("AC12 dragStep: a release on another segment with no move before it still moves", () => {
  const start = call(dragStep, "dragStep")(null, {
    type: "press",
    id: "files",
  }).state;
  assert.deepEqual(dragStep(start, { type: "release", id: "git" }), {
    state: null,
    move: { from: "files", to: "git" },
  });
});

test("AC13 dragStep: a release on the pressed segment is no move", () => {
  const start = call(dragStep, "dragStep")(null, {
    type: "press",
    id: "files",
  }).state;
  const away = dragStep(
    dragStep(start, { type: "move", id: "changes" }).state,
    { type: "move", id: "files" },
  ).state;
  assert.deepEqual(dragStep(away, { type: "release", id: "files" }), {
    state: null,
    move: null,
  });
});

test("AC12 dragStep: a release with no drag does nothing", () => {
  assert.deepEqual(
    call(dragStep, "dragStep")(null, { type: "release", id: "changes" }),
    { state: null, move: null },
  );
});

test("AC12 dragStep: a second press replaces the first (a lost release)", () => {
  const first = call(dragStep, "dragStep")(null, {
    type: "press",
    id: "files",
  }).state;
  const second = dragStep(first, { type: "press", id: "changes" });
  assert.equal(second.state.from, "changes");
  assert.deepEqual(
    dragStep(second.state, { type: "release", id: "git" }).move,
    { from: "changes", to: "git" },
  );
});

test("AC14 dragStep: up and leave clear the drag and move nothing", () => {
  const start = call(dragStep, "dragStep")(null, {
    type: "press",
    id: "files",
  }).state;
  const over = dragStep(start, { type: "move", id: "changes" }).state;
  assert.deepEqual(dragStep(over, { type: "up" }), { state: null, move: null });
  assert.deepEqual(dragStep(over, { type: "leave" }), {
    state: null,
    move: null,
  });
  assert.deepEqual(dragStep(null, { type: "up" }), { state: null, move: null });
});

test("AC14 dragStep does not change the state it is given", () => {
  const start = call(dragStep, "dragStep")(null, {
    type: "press",
    id: "files",
  }).state;
  const frozen = JSON.stringify(start);
  dragStep(start, { type: "move", id: "changes" });
  dragStep(start, { type: "release", id: "changes" });
  assert.equal(JSON.stringify(start), frozen);
});

test("AC14 dropSide: the bar is on the right when the pressed tab moves later, on the left when earlier", () => {
  const side = call(dropSide, "dropSide");
  assert.equal(
    side(TABS, { from: "files", over: "changes" }, "changes"),
    "right",
  );
  assert.equal(side(TABS, { from: "changes", over: "files" }, "files"), "left");
  assert.equal(side(TABS, { from: "notes", over: "git" }, "git"), "right");
  assert.equal(side(TABS, { from: "git", over: "notes" }, "notes"), "left");
});

test("AC14 dropSide follows the given order, not the canonical one", () => {
  // In CUSTOM, files (2) over notes (1) is a move to an earlier slot; canonical would say later.
  assert.equal(
    call(dropSide, "dropSide")(
      CUSTOM,
      { from: "files", over: "notes" },
      "notes",
    ),
    "left",
  );
  assert.equal(
    dropSide(CUSTOM, { from: "notes", over: "files" }, "files"),
    "right",
  );
});

test("AC14 dropSide: no bar on the pressed segment, on a segment that is not under the pointer, or with no drag", () => {
  const side = call(dropSide, "dropSide");
  assert.equal(side(TABS, { from: "files", over: "files" }, "files"), null);
  assert.equal(side(TABS, { from: "files", over: "changes" }, "files"), null);
  assert.equal(side(TABS, { from: "files", over: "changes" }, "git"), null);
  assert.equal(side(TABS, null, "changes"), null);
});

test("AC14 outside: a move inside the box with the left button held is not outside", () => {
  assert.equal(
    call(
      outside,
      "outside",
    )({
      pressed_button: "left",
      local_position: { x: 120, y: 16 },
      bounds: BOUNDS,
    }),
    false,
  );
});

test("AC14 outside: a position past any edge of the box is outside", () => {
  const out = call(outside, "outside");
  assert.equal(out(win(-20, 16)), true);
  assert.equal(out(win(400, 16)), true);
  assert.equal(out(win(120, -20)), true);
  assert.equal(out(win(120, 90)), true);
});

test("AC14 outside: another button than left is outside", () => {
  assert.equal(call(outside, "outside")(win(120, 16, "right")), true);
  assert.equal(outside(win(120, 16, "middle")), true);
});

test("AC14 outside: a missing position or bounds is not outside", () => {
  const out = call(outside, "outside");
  assert.equal(out({ pressed_button: "left", bounds: BOUNDS }), false);
  assert.equal(
    out({ pressed_button: "left", local_position: { x: 900, y: 900 } }),
    false,
  );
});

// ---------------------------------------------------------------------------------------------------------------
// The twelve interleavings, on the mounted control. A is files (index 1), B is changes (index 2), C is git (3).

test("AC13 interleaving 1: press A, release A, click A selects A and keeps the order", async () => {
  const m = await mount();
  assertWired(m.tree());
  const e = at(100);
  press(seg(m.tree(), "changes"), e, m.cx);
  release(seg(m.tree(), "changes"), e, m.cx);
  seg(m.tree(), "changes").onClick(e, m.cx);
  assert.deepEqual(state.shared[STORE], { tab: "changes" });
  assert.deepEqual(shownOrder(m.tree()), TABS);
  assert.deepEqual(storedOrder(), TABS);
  assert.deepEqual(selectedSegments(m.tree()), ["changes"]);
});

test("AC12 interleaving 2: press A, move B, release B moves the tab", async () => {
  const m = await mount();
  press(seg(m.tree(), "files"), at(100), m.cx);
  move(seg(m.tree(), "git"), at(270), m.cx);
  release(seg(m.tree(), "git"), at(270), m.cx);
  assert.deepEqual(shownOrder(m.tree()), ["notes", "changes", "git", "files"]);
  assert.deepEqual(storedOrder(), ["notes", "changes", "git", "files"]);
});

test("AC12 interleaving 2: a tab moved to an earlier slot shifts the ones between to the right", async () => {
  const m = await mount();
  press(seg(m.tree(), "git"), at(270), m.cx);
  move(seg(m.tree(), "files"), at(100), m.cx);
  release(seg(m.tree(), "files"), at(100), m.cx);
  assert.deepEqual(shownOrder(m.tree()), ["notes", "git", "files", "changes"]);
  assert.deepEqual(storedOrder(), ["notes", "git", "files", "changes"]);
});

test("AC12 interleaving 3: press A, release B with no move moves the tab", async () => {
  const m = await mount();
  press(seg(m.tree(), "files"), at(100), m.cx);
  release(seg(m.tree(), "changes"), at(190), m.cx);
  assert.deepEqual(shownOrder(m.tree()), ["notes", "changes", "files", "git"]);
  assert.deepEqual(storedOrder(), ["notes", "changes", "files", "git"]);
});

test("AC13 interleaving 4: press A, move B, move A, release A, click A selects A and does not move", async () => {
  const m = await mount();
  assertWired(m.tree());
  press(seg(m.tree(), "files"), at(100), m.cx);
  move(seg(m.tree(), "changes"), at(190), m.cx);
  move(seg(m.tree(), "files"), at(100), m.cx);
  release(seg(m.tree(), "files"), at(100), m.cx);
  seg(m.tree(), "files").onClick(at(100), m.cx);
  assert.deepEqual(state.shared[STORE], { tab: "files" });
  assert.deepEqual(shownOrder(m.tree()), TABS);
  assert.deepEqual(storedOrder(), TABS);
  assert.equal(bars(m.tree()).length, 0);
});

test("AC14 interleaving 5: press A, move B, move outside the box, move B, release B changes nothing and clears the feedback", async () => {
  const m = await mount();
  press(seg(m.tree(), "files"), at(100), m.cx);
  move(seg(m.tree(), "changes"), at(190), m.cx);
  assert.equal(
    bars(m.tree()).length,
    1,
    "the bar shows before the pointer leaves",
  );
  const windowMove = handler(control(m.tree()), "on_window_mouse_move");
  assert.equal(
    typeof windowMove,
    "function",
    "the control listens to window moves",
  );
  windowMove(win(-40, 16), m.cx);
  assert.equal(bars(m.tree()).length, 0);
  move(seg(m.tree(), "changes"), at(190), m.cx);
  assert.equal(bars(m.tree()).length, 0, "the drag is cancelled for good");
  assert.equal(hasCall(seg(m.tree(), "files"), "opacity"), false);
  release(seg(m.tree(), "changes"), at(190), m.cx);
  assert.deepEqual(shownOrder(m.tree()), TABS);
  assert.deepEqual(storedOrder(), TABS);
});

test("AC14 interleaving 6: press A, move B, release in a gap changes nothing and clears the feedback", async () => {
  const m = await mount();
  press(seg(m.tree(), "files"), at(100), m.cx);
  move(seg(m.tree(), "changes"), at(190), m.cx);
  assert.equal(bars(m.tree()).length, 1);
  assert.equal(
    typeof (
      handler(control(m.tree()), "on_mouse_up", "left") ??
      handler(control(m.tree()), "on_mouse_up")
    ),
    "function",
    "the control has its own mouse up",
  );
  release(control(m.tree()), at(300), m.cx);
  assert.equal(bars(m.tree()).length, 0);
  assert.equal(hasCall(seg(m.tree(), "files"), "opacity"), false);
  release(seg(m.tree(), "changes"), at(190), m.cx);
  assert.deepEqual(shownOrder(m.tree()), TABS);
  assert.deepEqual(storedOrder(), TABS);
});

test("AC14 interleaving 7: press A, a window move with no button held cancels the drag", async () => {
  const m = await mount();
  press(seg(m.tree(), "files"), at(100), m.cx);
  move(seg(m.tree(), "changes"), at(190), m.cx);
  const windowMove = handler(control(m.tree()), "on_window_mouse_move");
  assert.equal(
    typeof windowMove,
    "function",
    "the control listens to window moves",
  );
  windowMove(win(120, 16, null), m.cx);
  assert.equal(bars(m.tree()).length, 0);
  assert.equal(hasCall(seg(m.tree(), "files"), "opacity"), false);
  release(seg(m.tree(), "changes"), at(190), m.cx);
  assert.deepEqual(shownOrder(m.tree()), TABS);
  assert.deepEqual(storedOrder(), TABS);
});

test("AC12 interleaving 8: a right press on A then a left release on B reorders nothing", async () => {
  const m = await mount();
  assert.equal(
    typeof handler(seg(m.tree(), "changes"), "on_mouse_up", "left"),
    "function",
    "a segment has a left mouse up",
  );
  handler(seg(m.tree(), "files"), "on_mouse_down", "right")?.(at(100), m.cx);
  release(seg(m.tree(), "changes"), at(190), m.cx);
  assert.deepEqual(shownOrder(m.tree()), TABS);
  assert.deepEqual(storedOrder(), TABS);
  assert.equal(bars(m.tree()).length, 0);
});

test("AC12 interleaving 9: a release on B with no press reorders nothing", async () => {
  const m = await mount();
  assert.equal(
    typeof handler(seg(m.tree(), "changes"), "on_mouse_up", "left"),
    "function",
    "a segment has a left mouse up",
  );
  release(seg(m.tree(), "changes"), at(190), m.cx);
  assert.deepEqual(shownOrder(m.tree()), TABS);
  assert.deepEqual(storedOrder(), TABS);
  assert.equal(bars(m.tree()).length, 0);
});

test("AC12 interleaving 10: press A, press B (a lost release), release C moves B", async () => {
  const m = await mount();
  press(seg(m.tree(), "files"), at(100), m.cx);
  press(seg(m.tree(), "changes"), at(190), m.cx);
  release(seg(m.tree(), "git"), at(270), m.cx);
  assert.deepEqual(shownOrder(m.tree()), ["notes", "files", "git", "changes"]);
  assert.deepEqual(storedOrder(), ["notes", "files", "git", "changes"]);
});

test("AC12 interleaving 11: press A, move B, release B, release B again makes one move", async () => {
  const m = await mount();
  press(seg(m.tree(), "files"), at(100), m.cx);
  move(seg(m.tree(), "changes"), at(190), m.cx);
  const staleUp =
    handler(seg(m.tree(), "changes"), "on_mouse_up", "left") ??
    handler(seg(m.tree(), "changes"), "on_mouse_up");
  release(seg(m.tree(), "changes"), at(190), m.cx);
  assert.deepEqual(shownOrder(m.tree()), ["notes", "changes", "files", "git"]);
  staleUp?.(at(190), m.cx);
  release(seg(m.tree(), "changes"), at(190), m.cx);
  assert.deepEqual(shownOrder(m.tree()), ["notes", "changes", "files", "git"]);
  assert.deepEqual(storedOrder(), ["notes", "changes", "files", "git"]);
});

test("AC12 interleaving 12: the pressed tab is the selected one, so { tab } stays and the pill follows with no slide", async () => {
  const m = await mount({ tab: "files" });
  const before = structuredClone(state.shared[STORE]);
  press(seg(m.tree(), "files"), at(100), m.cx);
  move(seg(m.tree(), "changes"), at(190), m.cx);
  release(seg(m.tree(), "changes"), at(190), m.cx);
  const after = m.tree();
  assert.deepEqual(state.shared[STORE], before);
  assert.deepEqual(state.shared[STORE], { tab: "files" });
  assert.deepEqual(shownOrder(after), ["notes", "changes", "files", "git"]);
  assert.deepEqual(selectedSegments(after), ["files"]);
  const pill = findById(after, "sidebar-tabs-pill");
  assert.ok(pill, "one pill");
  assert.deepEqual(
    [num(styleOf(pill, "left")), num(styleOf(pill, "w"))],
    [163, 78],
    "the pill is at the new slot of Files (index 2 of 4)",
  );
  assert.equal(
    transitionOf(pill, "left"),
    undefined,
    "no slide on the render of a reorder",
  );
  assert.equal(transitionOf(pill, "width"), undefined);
});

// ---------------------------------------------------------------------------------------------------------------
// AC12 to AC14, the rest

test("AC12 a reorder selects nothing, writes no tab and runs no command", async () => {
  const m = await mount({ tab: "notes" });
  const stored = structuredClone(state.shared[STORE]);
  press(seg(m.tree(), "files"), at(100), m.cx);
  move(seg(m.tree(), "git"), at(270), m.cx);
  release(seg(m.tree(), "git"), at(270), m.cx);
  assert.deepEqual(shownOrder(m.tree()), ["notes", "changes", "git", "files"]);
  assert.deepEqual(state.shared[STORE], stored);
  assert.deepEqual(selectedSegments(m.tree()), ["notes"]);
  assert.deepEqual(state.runs, m.runs);
  assert.deepEqual(state.toasts, []);
});

test("AC12 a reorder writes no tab when none was ever stored", async () => {
  const m = await mount();
  assert.equal(state.shared[STORE], undefined);
  press(seg(m.tree(), "changes"), at(190), m.cx);
  release(seg(m.tree(), "files"), at(100), m.cx);
  assert.deepEqual(shownOrder(m.tree()), ["notes", "changes", "files", "git"]);
  assert.equal(state.shared[STORE], undefined);
});

test("AC12 a reorder starts from the stored order", async () => {
  const m = await mount({ layout: { order: CUSTOM } });
  assert.deepEqual(shownOrder(m.tree()), CUSTOM);
  press(seg(m.tree(), "notes"), at(100), m.cx);
  release(seg(m.tree(), "changes"), at(270), m.cx);
  assert.deepEqual(shownOrder(m.tree()), ["git", "files", "changes", "notes"]);
  assert.deepEqual(state.shared[LAYOUT_STORE].order, [
    "git",
    "files",
    "changes",
    "notes",
  ]);
});

test("AC13 press and release on the same segment selects it and keeps the order, whatever the pointer did inside it", async () => {
  const m = await mount();
  assertWired(m.tree());
  press(seg(m.tree(), "files"), at(100), m.cx);
  move(seg(m.tree(), "files"), at(110), m.cx);
  move(seg(m.tree(), "files"), at(95), m.cx);
  release(seg(m.tree(), "files"), at(95), m.cx);
  seg(m.tree(), "files").onClick(at(95), m.cx);
  assert.deepEqual(state.shared[STORE], { tab: "files" });
  assert.deepEqual(shownOrder(m.tree()), TABS);
  assert.deepEqual(storedOrder(), TABS);
});

test("AC13 a click through the kit (down, up, click) selects the tab and keeps a stored order", async () => {
  const m = await mount({ layout: { order: CUSTOM } });
  click(seg(m.tree(), "files"), m.cx, at(100));
  assert.deepEqual(state.shared[STORE], { tab: "files" });
  assert.deepEqual(shownOrder(m.tree()), CUSTOM);
  assert.deepEqual(state.shared[LAYOUT_STORE].order, CUSTOM);
});

test("AC14 the pressed segment is at 0.5 and the bar is on the landing side (forward)", async () => {
  const m = await mount();
  press(seg(m.tree(), "files"), at(100), m.cx);
  move(seg(m.tree(), "changes"), at(190), m.cx);
  const tree = m.tree();
  assert.equal(styleOf(seg(tree, "files"), "opacity"), 0.5);
  const found = bars(tree);
  assert.equal(found.length, 1);
  assert.ok(
    walk(seg(tree, "changes")).includes(found[0]),
    "the bar is a child of the target segment",
  );
  assert.equal(styleOf(found[0], "right"), 0);
  assert.equal(hasCall(found[0], "left"), false);
});

test("AC14 the pressed segment is at 0.5 and the bar is on the landing side (backward)", async () => {
  const m = await mount();
  press(seg(m.tree(), "changes"), at(190), m.cx);
  move(seg(m.tree(), "files"), at(100), m.cx);
  const tree = m.tree();
  assert.equal(styleOf(seg(tree, "changes"), "opacity"), 0.5);
  const found = bars(tree);
  assert.equal(found.length, 1);
  assert.ok(
    walk(seg(tree, "files")).includes(found[0]),
    "the bar is a child of the target segment",
  );
  assert.equal(styleOf(found[0], "left"), 0);
  assert.equal(hasCall(found[0], "right"), false);
});

test("AC14 the bar follows the pointer to the next segment", async () => {
  const m = await mount();
  press(seg(m.tree(), "files"), at(100), m.cx);
  move(seg(m.tree(), "changes"), at(190), m.cx);
  move(seg(m.tree(), "git"), at(270), m.cx);
  const tree = m.tree();
  assert.equal(bars(tree).length, 1);
  assert.ok(walk(seg(tree, "git")).includes(bars(tree)[0]));
  assert.equal(
    walk(seg(tree, "changes")).some((n) => n.nodeId === "sidebar-tabs-drop"),
    false,
  );
});

test("AC14 no bar over the pressed segment, and its opacity is not set", async () => {
  const m = await mount();
  assertWired(m.tree());
  press(seg(m.tree(), "files"), at(100), m.cx);
  assert.equal(bars(m.tree()).length, 0, "no bar after the press");
  assert.equal(hasCall(seg(m.tree(), "files"), "opacity"), false);
  move(seg(m.tree(), "files"), at(105), m.cx);
  assert.equal(
    bars(m.tree()).length,
    0,
    "no bar when the pointer moves over the pressed segment",
  );
  assert.equal(hasCall(seg(m.tree(), "files"), "opacity"), false);
});

test("AC14 no bar and no opacity with no drag", async () => {
  const m = await mount();
  assertWired(m.tree());
  assert.equal(bars(m.tree()).length, 0);
  for (const id of TABS)
    assert.equal(hasCall(seg(m.tree(), id), "opacity"), false, id);
});

test("AC14 the bar is also drawn for a stored order, on the landing side of that order", async () => {
  const m = await mount({ layout: { order: CUSTOM } });
  press(seg(m.tree(), "files"), at(190), m.cx);
  move(seg(m.tree(), "notes"), at(100), m.cx);
  const tree = m.tree();
  assert.equal(styleOf(bars(tree)[0], "left"), 0);
  assert.ok(walk(seg(tree, "notes")).includes(bars(tree)[0]));
});

test("AC14 a release after the pointer left changes nothing", async () => {
  const m = await mount();
  press(seg(m.tree(), "files"), at(100), m.cx);
  move(seg(m.tree(), "changes"), at(190), m.cx);
  handler(control(m.tree()), "on_window_mouse_move")?.(win(500, 16), m.cx);
  release(seg(m.tree(), "git"), at(270), m.cx);
  assert.equal(
    typeof handler(control(m.tree()), "on_window_mouse_move"),
    "function",
    "the control listens to window moves",
  );
  assert.deepEqual(shownOrder(m.tree()), TABS);
  assert.deepEqual(storedOrder(), TABS);
  assert.equal(bars(m.tree()).length, 0);
});

test("AC14 a window move inside the box with the left button held keeps the drag", async () => {
  const m = await mount();
  press(seg(m.tree(), "files"), at(100), m.cx);
  move(seg(m.tree(), "changes"), at(190), m.cx);
  const windowMove = handler(control(m.tree()), "on_window_mouse_move");
  assert.equal(
    typeof windowMove,
    "function",
    "the control listens to window moves",
  );
  windowMove(win(200, 16), m.cx);
  assert.equal(bars(m.tree()).length, 1);
  release(seg(m.tree(), "changes"), at(190), m.cx);
  assert.deepEqual(shownOrder(m.tree()), ["notes", "changes", "files", "git"]);
});

// ---------------------------------------------------------------------------------------------------------------
// AC17: the rail

test("AC17 the rail shows its icons in the stored order, with the Notes buttons below the last one", async () => {
  const m = await mount({ width: 44, layout: { order: CUSTOM } });
  assert.deepEqual(railOrder(m.tree()), CUSTOM);
  const ids = walk(m.tree())
    .map((n) => n.nodeId)
    .filter(
      (id) =>
        id?.startsWith("sidebar-rail-") ||
        id === "notes-search-rail" ||
        id === "notes-new-rail",
    );
  assert.deepEqual(ids, [
    ...CUSTOM.map((id) => `sidebar-rail-${id}`),
    "notes-search-rail",
    "notes-new-rail",
  ]);
});

test("AC17 a rail with a middle reorder puts each icon at its slot", async () => {
  const m = await mount({
    width: 44,
    layout: { order: ["notes", "changes", "files", "git"] },
  });
  assert.deepEqual(railOrder(m.tree()), ["notes", "changes", "files", "git"]);
  const ids = walk(m.tree())
    .map((n) => n.nodeId)
    .filter(
      (id) =>
        id === "sidebar-rail-git" ||
        id === "notes-search-rail" ||
        id === "notes-new-rail",
    );
  assert.deepEqual(ids, [
    "sidebar-rail-git",
    "notes-search-rail",
    "notes-new-rail",
  ]);
});

test("AC17 a rail click selects the tab of the icon, not the slot", async () => {
  const m = await mount({ width: 44, layout: { order: CUSTOM } });
  assert.deepEqual(railOrder(m.tree()), CUSTOM);
  findById(m.tree(), "sidebar-rail-files").onClick(null, m.cx);
  assert.deepEqual(state.shared[STORE], { tab: "files" });
  assert.deepEqual(state.shared[LAYOUT_STORE].order, CUSTOM);
});

test("AC17 the rail marks the selected tab at its own slot", async () => {
  const m = await mount({ width: 44, tab: "files", layout: { order: CUSTOM } });
  assert.deepEqual(railOrder(m.tree()), CUSTOM);
  const pressed = railOrder(m.tree()).filter((id) =>
    findById(m.tree(), `sidebar-rail-${id}`).calls.some(
      ([name]) => name === "bg",
    ),
  );
  assert.deepEqual(pressed, ["files"]);
});

// ---------------------------------------------------------------------------------------------------------------
// AC18: keys, tooltips and the badge follow the tab

for (const [want, from] of [
  ["files", "git"],
  ["changes", "git"],
  ["git", "files"],
  ["notes", "git"],
]) {
  test(`AC18 keys follow the tab, not the slot: herdsidian-tabs.${want} selects ${want} with the order Git, Notes, Files, Changes`, async () => {
    const m = await mount({ tab: from, layout: { order: CUSTOM } });
    state.commands = [want];
    const { default: Tabs } = await import("../mods/herdsidian-tabs/main.js");
    new Tabs().init({}, fakeCx());
    await settle();
    assert.deepEqual(state.shared[STORE], { tab: want });
    assert.deepEqual(state.shared[LAYOUT_STORE].order, CUSTOM);
    const tree = settledTree(m);
    assert.deepEqual(selectedSegments(tree), [want]);
    const pill = findById(tree, "sidebar-tabs-pill");
    assert.ok(pill, "one pill");
    assert.equal(
      num(styleOf(pill, "left")),
      3 + 80 * CUSTOM.indexOf(want),
      "the pill is at the slot of the tab",
    );
  });
}

test("AC18 tooltips keep their tab and its key when the order is not canonical", () => {
  const bindings = [
    {
      section: "layout:herdsidian",
      keys: "cmd-shift-o",
      action: "herdsidian-tabs.notes",
    },
    {
      section: "layout:herdsidian",
      keys: "cmd-shift-e",
      action: "herdsidian-tabs.files",
    },
    {
      section: "layout:herdsidian",
      keys: "cmd-shift-g",
      action: "herdsidian-tabs.changes",
    },
    {
      section: "layout:herdsidian",
      keys: "cmd-shift-h",
      action: "herdsidian-tabs.git",
    },
  ];
  const t = new Proxy({}, { get: () => "#000" });
  const tree = call(tabControl, "tabControl")(t, t, {
    tab: "notes",
    count: 0,
    onSelect() {},
    tips: tabTips(bindings, "herdsidian", "modifier"),
    order: CUSTOM,
  });
  assert.deepEqual(shownOrder(tree), CUSTOM);
  const tip = (id) =>
    seg(tree, id).calls.find(([name]) => name === "tooltip")?.[1][0];
  assert.deepEqual(TABS.map(tip), [
    "Notes  ⇧⌘O",
    "Files  ⇧⌘E",
    "Changes  ⇧⌘G",
    "Git  ⇧⌘H",
  ]);
});

test("AC18 the Changes badge stays on the Changes segment in a stored order", async () => {
  const m = await mount({ layout: { order: CUSTOM } });
  state.shared["herdsidian.changes"] = { count: 3 };
  const tree = m.tree();
  assert.deepEqual(shownOrder(tree), CUSTOM);
  const badges = walk(tree).filter((n) => n.nodeId === "sidebar-changes-badge");
  assert.equal(badges.length, 1);
  assert.deepEqual(badges[0].kids, ["3"]);
  assert.ok(
    walk(seg(tree, "changes")).includes(badges[0]),
    "the badge is inside the Changes segment",
  );
  assert.equal(walk(seg(tree, "git")).includes(badges[0]), false);
});

test("AC18 a segment keeps its label at its own slot", async () => {
  const m = await mount({ layout: { order: CUSTOM } });
  const labels = shownOrder(m.tree()).map((id) =>
    seg(m.tree(), id).kids.find((k) => typeof k === "string"),
  );
  assert.deepEqual(labels, ["Git", "Notes", "Files", "Changes"]);
});

// ---------------------------------------------------------------------------------------------------------------
// AC19: the fixed order of SIDEBAR_TABS and of the Settings row

test("AC19 SIDEBAR_TABS is canonical in lib and its 5 copies", async () => {
  const files = [
    "../lib/keys.js",
    ...[
      "herdsidian",
      "herdsidian-tabs",
      "herdsidian-status",
      "guide-agents",
      "guide-spaces",
    ].map((m) => `../mods/${m}/keys.js`),
  ];
  for (const file of files) {
    const mod = await import(file);
    assert.deepEqual(mod.SIDEBAR_TABS, TABS, file);
  }
});

test("AC19 the Settings row cycles in the fixed order from the middle tabs", async () => {
  const { settingSections } = await import("../lib/keys.js");
  const base = {
    settings: { keyHints: "modifier", usageInStatus: true },
    sidebarHidden: false,
    sidebarRail: false,
  };
  const next = (sidebarTab) =>
    settingSections({ ...base, sidebarTab })[1].rows[1].action.name;
  assert.equal(next("files"), "herdsidian-tabs.changes");
  assert.equal(next("changes"), "herdsidian-tabs.git");
  assert.equal(next("git"), "herdsidian-tabs.notes");
  assert.equal(next("notes"), "herdsidian-tabs.files");
});

test("AC19 the Settings row cycles in the fixed order with a stored order", async () => {
  const stubs = globalThis.__herdsidianStubs.herdr;
  const saved = {
    themes: stubs.themes,
    settings: stubs.settings,
    keys: stubs.keys,
    appHome: stubs.appHome,
  };
  stubs.themes = () => [];
  stubs.settings = () => ({ zoom: 1 });
  stubs.keys = () => [];
  stubs.appHome = () => "/herdr-home";
  try {
    const { Palette } = await import("../mods/herdsidian/palette-main.js");
    // Fixed order from notes is files; the stored order below would give changes (wrapping from the end).
    for (const [from, want] of [
      ["notes", "files"],
      ["files", "changes"],
    ]) {
      state.shared = {
        [STORE]: { tab: from },
        [LAYOUT_STORE]: { order: ["changes", "git", "files", "notes"] },
      };
      state.runs = [];
      state.toasts = [];
      state.closed = [];
      state.files = { "/herdr-home/settings.json": "{}" };
      state.props = { overlay: "o1" };
      state.layout = {
        id: "root",
        children: [{ id: "herdsidian", size: { px: 380 } }],
      };
      const cx = fakeCx(),
        view = new Palette(cx);
      await settle();
      view.on.tab("settings", cx);
      findById(view.render(cx), "row-setting:sidebar-tab").onClick(null, cx);
      assert.deepEqual(state.runs, [[`herdsidian-tabs.${want}`, {}]], from);
      assert.deepEqual(state.shared[LAYOUT_STORE], {
        order: ["changes", "git", "files", "notes"],
      });
    }
  } finally {
    Object.assign(stubs, saved);
  }
});
