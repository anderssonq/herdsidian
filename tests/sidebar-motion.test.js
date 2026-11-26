// The sidebar tab switch motion (AC1 to AC5, AC7): the pure stepMotion and pillSlot, and the mounted tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mountNotes, cxWithSleep, findById, walk, styleOf, transitionOf, state, settle, TABS, STORE, LAYOUT_STORE } from "./support/sidebar-kit.js";

// Missing modules and exports must fail one test each, so they are loaded without a crash.
const motion = await import("../mods/herdsidian/sidebar-motion.js").catch(() => ({}));
const view = await import("../mods/herdsidian/sidebar-view.js").catch(() => ({}));
const need = (mod, name) => assert.equal(typeof mod[name], "function", `${name} is not exported`);

const PILL = { duration: 180, easing: "ease-out" };
const BODY = { duration: 160, easing: "ease-out" };
const px = (v) => (typeof v === "number" ? v : parseFloat(String(v)));
// A 380 block gives a 324 control, slots of 78 and these lefts (plan: Middle value for tests).
const SLOT = { notes: 3, files: 83, changes: 163, git: 243 };

const now = (top, over = {}) => ({ top, shown: [top], order: TABS, wide: true, width: 324, ...over });
const pillOf = (tree) => findById(tree, "sidebar-tabs-pill");
const bodyOf = (tree, tab) => findById(tree, `sidebar-body-${tab}`);
const bodies = (tree) => TABS.filter((id) => bodyOf(tree, id));
const select = (tree, id, cx) => findById(tree, `sidebar-tab-${id}`).onClick(null, cx);
const atRest = (tree, tab) => {
  const body = bodyOf(tree, tab);
  assert.ok(body, `body of ${tab} exists`);
  assert.equal(styleOf(body, "opacity"), 1);
  assert.equal(px(styleOf(body, "left")), 0);
};
const pillAt = (tree, tab) => {
  const pill = pillOf(tree);
  assert.ok(pill, "the pill exists");
  assert.equal(px(styleOf(pill, "left")), SLOT[tab]);
  assert.equal(px(styleOf(pill, "w")), 78);
};
// Switch by a click, then draw twice, as the app does: the first render and the next one.
const switchTo = (tree, id, cx, v) => {
  select(tree, id, cx);
  const first = v.render(cx);
  return { first, second: v.render(cx) };
};

// ---- pure: pillSlot -------------------------------------------------------------------------------------------

test("AC1 pillSlot at index 2 of 4 in a 324 control is left 163, width 78", () => {
  need(view, "pillSlot");
  assert.deepEqual(view.pillSlot(2, 4, 324), { left: 163, width: 78 });
});

test("AC1 pillSlot at the other indexes follows the same step", () => {
  need(view, "pillSlot");
  assert.deepEqual(view.pillSlot(1, 4, 324), { left: 83, width: 78 });
  assert.deepEqual(view.pillSlot(3, 4, 324), { left: 243, width: 78 });
});

test("AC1 pillSlot with no width places the pill in percent", () => {
  need(view, "pillSlot");
  const slot = view.pillSlot(2, 4, null);
  assert.match(String(slot.left), /%$/);
  assert.match(String(slot.width), /%$/);
});

test("AC1 tabsWidth takes the header out of the block width", () => {
  need(view, "tabsWidth");
  assert.equal(view.tabsWidth(380), 324);
  assert.equal(view.tabsWidth(null), null);
});

test("AC1 the motion constants are the 180 ms pill, the 160 ms body and the 8 px shift", () => {
  assert.deepEqual(motion.PILL_MOTION, PILL);
  assert.deepEqual(motion.BODY_MOTION, BODY);
  assert.equal(motion.BODY_SHIFT, 8);
});

// ---- pure: stepMotion -----------------------------------------------------------------------------------------

test("AC4 stepMotion on mount has no motion", () => {
  need(motion, "stepMotion");
  const step = motion.stepMotion(null, now("files"));
  assert.equal(step.pillTab, "files");
  assert.equal(step.slide, false);
  assert.equal(step.body, null);
  assert.equal(step.again, false);
});

test("AC4 stepMotion on the same tab twice has no motion", () => {
  need(motion, "stepMotion");
  const first = motion.stepMotion(null, now("files"));
  const second = motion.stepMotion(first.state, now("files"));
  assert.equal(second.pillTab, "files");
  assert.equal(second.body, null);
  assert.equal(second.again, false);
});

test("AC3 stepMotion forward from files to changes draws the old slot, a body at 0 and +8, and asks for one render", () => {
  need(motion, "stepMotion");
  const mount = motion.stepMotion(null, now("files"));
  const step = motion.stepMotion(mount.state, now("changes"));
  assert.equal(step.pillTab, "files");
  assert.equal(step.slide, true);
  assert.deepEqual(step.body, { tab: "changes", opacity: 0, left: 8 });
  assert.equal(step.again, true);
});

test("AC3 stepMotion backward from changes to files starts at -8", () => {
  need(motion, "stepMotion");
  const mount = motion.stepMotion(null, now("changes"));
  const step = motion.stepMotion(mount.state, now("files"));
  assert.equal(step.pillTab, "changes");
  assert.deepEqual(step.body, { tab: "files", opacity: 0, left: -8 });
  assert.equal(step.again, true);
});

test("AC1 stepMotion draws the end values on the render after a switch, with the slide on", () => {
  need(motion, "stepMotion");
  const mount = motion.stepMotion(null, now("files"));
  const first = motion.stepMotion(mount.state, now("changes"));
  const next = motion.stepMotion(first.state, now("changes"));
  assert.equal(next.pillTab, "changes");
  assert.equal(next.slide, true);
  assert.equal(next.body, null);
  assert.equal(next.again, false);
  const later = motion.stepMotion(next.state, now("changes"));
  assert.equal(later.pillTab, "changes");
  assert.equal(later.body, null);
  assert.equal(later.again, false);
});

test("AC3 stepMotion follows the shown order, not the canonical one", () => {
  need(motion, "stepMotion");
  const order = ["git", "changes", "files", "notes"];
  const forward = motion.stepMotion(motion.stepMotion(null, now("changes", { order })).state, now("files", { order }));
  assert.equal(forward.body.left, 8);
  const backward = motion.stepMotion(motion.stepMotion(null, now("files", { order })).state, now("changes", { order }));
  assert.equal(backward.body.left, -8);
});

test("AC3 stepMotion on a second switch before the second render starts again from the last top", () => {
  need(motion, "stepMotion");
  const mount = motion.stepMotion(null, now("files"));
  const first = motion.stepMotion(mount.state, now("changes"));
  const second = motion.stepMotion(first.state, now("git"));
  assert.equal(second.pillTab, "changes");
  assert.deepEqual(second.body, { tab: "git", opacity: 0, left: 8 });
  assert.equal(second.again, true);
});

test("AC4 stepMotion in the rail has no motion, also on another tab", () => {
  need(motion, "stepMotion");
  const wide = motion.stepMotion(null, now("files"));
  const rail = motion.stepMotion(wide.state, now("changes", { wide: false, width: null }));
  assert.equal(rail.slide, false);
  assert.equal(rail.body, null);
  assert.equal(rail.again, false);
});

test("AC4 stepMotion rail to wide on the same tab has no motion", () => {
  need(motion, "stepMotion");
  const rail = motion.stepMotion(null, now("files", { wide: false, width: null }));
  const wide = motion.stepMotion(rail.state, now("files"));
  assert.equal(wide.pillTab, "files");
  assert.equal(wide.slide, false);
  assert.equal(wide.body, null);
  assert.equal(wide.again, false);
});

test("AC4 stepMotion wide to rail to wide on another tab has no motion", () => {
  need(motion, "stepMotion");
  const wide = motion.stepMotion(null, now("files"));
  const rail = motion.stepMotion(wide.state, now("changes", { wide: false, width: null }));
  const back = motion.stepMotion(rail.state, now("changes"));
  assert.equal(back.pillTab, "changes");
  assert.equal(back.slide, false);
  assert.equal(back.body, null);
  assert.equal(back.again, false);
});

test("AC4 stepMotion from the rail to a wide sidebar on another tab in one step has no motion", () => {
  need(motion, "stepMotion");
  const rail = motion.stepMotion(null, now("files", { wide: false, width: null }));
  const wide = motion.stepMotion(rail.state, now("changes"));
  assert.equal(wide.pillTab, "changes");
  assert.equal(wide.slide, false);
  assert.equal(wide.body, null);
  assert.equal(wide.again, false);
});

test("AC1 stepMotion on a width change leaves the pill transition out", () => {
  need(motion, "stepMotion");
  const mount = motion.stepMotion(null, now("files"));
  const step = motion.stepMotion(mount.state, now("files", { width: 280 }));
  assert.equal(step.slide, false);
  assert.equal(step.body, null);
  assert.equal(step.again, false);
});

test("AC1 stepMotion on a reorder leaves the pill transition out", () => {
  need(motion, "stepMotion");
  const mount = motion.stepMotion(null, now("files"));
  const step = motion.stepMotion(mount.state, now("files", { order: ["notes", "changes", "files", "git"] }));
  assert.equal(step.pillTab, "files");
  assert.equal(step.slide, false);
  assert.equal(step.body, null);
  assert.equal(step.again, false);
});

test("AC3 stepMotion on a swap in a split has no body fade", () => {
  need(motion, "stepMotion");
  const mount = motion.stepMotion(null, now("files", { shown: ["files", "changes"] }));
  const step = motion.stepMotion(mount.state, now("changes", { shown: ["changes", "files"] }));
  assert.equal(step.body, null);
  assert.equal(step.again, false);
});

// ---- mounted: AC1 ---------------------------------------------------------------------------------------------

test("AC1 one pill with the selected look and 180 ms transitions", async () => {
  const { view: v, cx, tree } = await mountNotes({ tab: "files" });
  const { first } = switchTo(tree, "changes", cx, v);
  const pills = walk(first).filter((n) => n.nodeId === "sidebar-tabs-pill");
  assert.equal(pills.length, 1);
  const pill = pills[0];
  for (const name of ["bg", "border_t", "border_color", "rounded"]) {
    assert.ok(pill.calls.some(([n]) => n === name), `the pill sets ${name}`);
  }
  assert.deepEqual(transitionOf(pill, "left"), PILL);
  assert.deepEqual(transitionOf(pill, "width"), PILL);
});

test("AC1 the pill is at the old slot on the first render after a click and at the new one on the next", async () => {
  const { view: v, cx, tree } = await mountNotes({ tab: "files" });
  pillAt(tree, "files");
  const { first, second } = switchTo(tree, "changes", cx, v);
  pillAt(first, "files");
  pillAt(second, "changes");
  assert.deepEqual(transitionOf(pillOf(second), "left"), PILL);
  assert.deepEqual(transitionOf(pillOf(second), "width"), PILL);
});

test("AC1 the pill follows a custom order, from the middle slots", async () => {
  const layout = { order: ["git", "changes", "files", "notes"], split: null, splitTop: null };
  const { view: v, cx, tree } = await mountNotes({ tab: "files", layout });
  assert.equal(px(styleOf(pillOf(tree), "left")), 163);
  const { first, second } = switchTo(tree, "changes", cx, v);
  assert.equal(px(styleOf(pillOf(first), "left")), 163);
  assert.equal(px(styleOf(pillOf(second), "left")), 83);
});

test("AC1 a second switch before the second render starts from the last top's slot", async () => {
  const { view: v, cx, tree } = await mountNotes({ tab: "files" });
  select(tree, "changes", cx);
  v.render(cx);
  select(tree, "git", cx);
  const first = v.render(cx);
  pillAt(first, "changes");
  const body = bodyOf(first, "git");
  assert.equal(styleOf(body, "opacity"), 0);
  assert.equal(px(styleOf(body, "left")), 8);
  const second = v.render(cx);
  pillAt(second, "git");
  atRest(second, "git");
});

test("AC1 a width change draws the pill with no transition", async () => {
  const { view: v, cx } = await mountNotes({ tab: "files" });
  state.layout.children[0].size.px = 300;
  const next = v.render(cx);
  assert.ok(pillOf(next), "the pill exists");
  assert.equal(transitionOf(pillOf(next), "left"), undefined);
  assert.equal(transitionOf(pillOf(next), "width"), undefined);
  assert.equal(px(styleOf(pillOf(next), "w")), (300 - 56 - 6 - 6) / 4);
});

test("AC1 a reorder draws the pill with no transition", async () => {
  const { view: v, cx } = await mountNotes({ tab: "files" });
  state.shared[LAYOUT_STORE] = { order: ["notes", "changes", "files", "git"], split: null, splitTop: null };
  const next = v.render(cx);
  assert.equal(px(styleOf(pillOf(next), "left")), 163);
  assert.equal(transitionOf(pillOf(next), "left"), undefined);
  assert.equal(transitionOf(pillOf(next), "width"), undefined);
  atRest(next, "files");
});

// ---- mounted: AC2 ---------------------------------------------------------------------------------------------

test("AC2 the selected segment keeps its weight and color; labels, tooltips, badge and ids are as before", async () => {
  const { view: v, cx } = await mountNotes({ tab: "files" });
  state.shared["herdsidian.changes"] = { count: 3 };
  const next = v.render(cx);
  const calls = (id) => findById(next, `sidebar-tab-${id}`).calls;
  const weighted = TABS.filter((id) => calls(id).some(([n, a]) => n === "font_weight" && a[0] === 500));
  assert.deepEqual(weighted, ["files"]);
  const colorName = calls("files").find(([n]) => /color/.test(n) && n !== "border_color")?.[0];
  assert.ok(colorName, "the selected segment sets a text color");
  for (const id of TABS) assert.ok(calls(id).some(([n]) => n === colorName), `${id} sets a text color`);
  assert.equal(calls("files").some(([n]) => n === "bg"), false, "the selected segment has no fill of its own");
  assert.equal(calls("files").some(([n]) => n === "border_color"), false, "the selected segment has no border of its own");
  assert.deepEqual(walk(next).map((n) => n.nodeId).filter((id) => id?.startsWith("sidebar-tab-")), TABS.map((id) => `sidebar-tab-${id}`));
  const labels = TABS.map((id) => findById(next, `sidebar-tab-${id}`).kids.find((k) => typeof k === "string"));
  assert.deepEqual(labels, ["Notes", "Files", "Changes", "Git"]);
  for (const id of TABS) assert.ok(calls(id).some(([n]) => n === "tooltip"), `${id} has a tooltip`);
  assert.deepEqual(findById(next, "sidebar-changes-badge").kids, ["3"]);
});

// ---- mounted: AC3 ---------------------------------------------------------------------------------------------

test("AC3 a switch to a later tab draws the new body at opacity 0 and left 8, then at 1 and 0", async () => {
  const { view: v, cx, tree } = await mountNotes({ tab: "files" });
  atRest(tree, "files");
  const { first, second } = switchTo(tree, "changes", cx, v);
  const body = bodyOf(first, "changes");
  assert.ok(body, "the new body exists in the first render");
  assert.equal(styleOf(body, "opacity"), 0);
  assert.equal(px(styleOf(body, "left")), 8);
  assert.deepEqual(transitionOf(body, "opacity"), BODY);
  assert.deepEqual(transitionOf(body, "left"), BODY);
  atRest(second, "changes");
  assert.deepEqual(transitionOf(bodyOf(second, "changes"), "opacity"), BODY);
  assert.deepEqual(transitionOf(bodyOf(second, "changes"), "left"), BODY);
});

test("AC3 a switch to an earlier tab starts at left -8", async () => {
  const { view: v, cx, tree } = await mountNotes({ tab: "changes" });
  const { first, second } = switchTo(tree, "files", cx, v);
  const body = bodyOf(first, "files");
  assert.equal(styleOf(body, "opacity"), 0);
  assert.equal(px(styleOf(body, "left")), -8);
  atRest(second, "files");
});

test("AC3 with a custom order the direction follows the shown order", async () => {
  const layout = { order: ["git", "changes", "files", "notes"], split: null, splitTop: null };
  const back = await mountNotes({ tab: "files", layout });
  const toChanges = switchTo(back.tree, "changes", back.cx, back.view);
  assert.equal(px(styleOf(bodyOf(toChanges.first, "changes"), "left")), -8);
  const fwd = await mountNotes({ tab: "changes", layout });
  const toFiles = switchTo(fwd.tree, "files", fwd.cx, fwd.view);
  assert.equal(px(styleOf(bodyOf(toFiles.first, "files"), "left")), 8);
});

test("AC3 the old body is gone in the first render", async () => {
  const { view: v, cx, tree } = await mountNotes({ tab: "files" });
  assert.deepEqual(bodies(tree), ["files"]);
  const { first, second } = switchTo(tree, "changes", cx, v);
  assert.deepEqual(bodies(first), ["changes"]);
  assert.deepEqual(bodies(second), ["changes"]);
});

test("AC3 the end values are drawn on a render after the switch even when no task ran", async () => {
  const { view: v, cx, tree } = await mountNotes({ tab: "files" });
  select(tree, "changes", cx);
  v.render(cx);
  for (let n = 0; n < 3; n++) atRest(v.render(cx), "changes");
});

test("AC3 a swap in a split fades no body", async () => {
  const layout = { order: TABS, split: { top: "files", below: "changes" }, splitTop: null };
  const { view: v, cx, tree } = await mountNotes({ tab: "files", layout });
  select(tree, "changes", cx);
  const next = v.render(cx);
  const faded = walk(next).filter((n) => n.calls.some(([name, a]) => name === "opacity" && a[0] === 0));
  assert.equal(faded.length, 0);
});

// ---- mounted: AC4 ---------------------------------------------------------------------------------------------

test("AC4 no motion on mount", async () => {
  const { tree } = await mountNotes({ tab: "files" });
  atRest(tree, "files");
  pillAt(tree, "files");
  assert.deepEqual(bodies(tree), ["files"]);
});

test("AC4 no motion out of the rail", async () => {
  const { view: v, cx, tree } = await mountNotes({ tab: "files", width: 44 });
  findById(tree, "sidebar-rail-changes").onClick(null, cx);
  state.layout.children[0].size.px = 380;
  const first = v.render(cx);
  atRest(first, "changes");
  pillAt(first, "changes");
  assert.deepEqual(bodies(first), ["changes"]);
  atRest(v.render(cx), "changes");
});

test("AC4 no motion when the tab is the same", async () => {
  const { view: v, cx, tree } = await mountNotes({ tab: "files" });
  select(tree, "files", cx);
  for (let n = 0; n < 2; n++) {
    const next = v.render(cx);
    atRest(next, "files");
    pillAt(next, "files");
  }
});

test("AC4 no motion after a re-mount on another tab", async () => {
  const first = await mountNotes({ tab: "files" });
  switchTo(first.tree, "changes", first.cx, first.view);
  const again = await mountNotes({ tab: "changes" });
  atRest(again.tree, "changes");
  pillAt(again.tree, "changes");
  assert.deepEqual(bodies(again.tree), ["changes"]);
});

test("AC4 a re-mount keeps the stored custom order and still has no motion", async () => {
  const layout = { order: ["git", "changes", "files", "notes"], split: null, splitTop: null };
  const { tree } = await mountNotes({ tab: "files", layout });
  atRest(tree, "files");
  assert.equal(px(styleOf(pillOf(tree), "left")), 163);
});

// ---- mounted: AC5 ---------------------------------------------------------------------------------------------

test("AC5 a switch starts no timer and asks for one re-render", async () => {
  const { view: v, cx, tree } = await mountNotes({ tab: "files" });
  const count = { after: 0, every: 0, spawn: 0 };
  cx.timer.after = () => { count.after++; };
  cx.timer.every = () => { count.every++; };
  const spawn = cx.spawn;
  cx.spawn = (task) => { count.spawn++; return spawn(task); };
  select(tree, "changes", cx);
  v.render(cx);
  v.render(cx);
  v.render(cx);
  assert.equal(count.after, 0);
  assert.equal(count.every, 0);
  assert.equal(count.spawn, 1);
});

test("AC5 the one task notifies once when its sleep ends", async () => {
  const { view: v, tree } = await mountNotes({ tab: "files" });
  const cx = cxWithSleep();
  let notified = 0;
  cx.notify = () => { notified++; };
  select(tree, "changes", cx);
  v.render(cx);
  notified = 0;
  await settle();
  assert.equal(notified, 1);
  atRest(v.render(cx), "changes");
});

test("AC5 a render with no switch spawns nothing and starts no timer", async () => {
  const { view: v, cx } = await mountNotes({ tab: "files" });
  const count = { timer: 0, spawn: 0 };
  cx.timer.after = () => { count.timer++; };
  cx.timer.every = () => { count.timer++; };
  const spawn = cx.spawn;
  cx.spawn = (task) => { count.spawn++; return spawn(task); };
  v.render(cx);
  v.render(cx);
  assert.equal(count.timer, 0);
  assert.equal(count.spawn, 0);
});

// ---- mounted: AC7 ---------------------------------------------------------------------------------------------

test("AC7 the rail keeps its look and has no transition", async () => {
  const { view: v, cx } = await mountNotes({ tab: "files", width: 44 });
  const check = (tree, selected) => {
    for (const id of TABS) {
      const icon = findById(tree, `sidebar-rail-${id}`);
      assert.ok(icon, `${id} icon`);
      assert.equal(icon.calls.some(([n]) => n === "bg"), id === selected, id);
      assert.equal(walk(icon).some((n) => n.calls.some(([name]) => name === "transition")), false, id);
    }
    assert.equal(findById(tree, "sidebar-tabs-pill"), null);
    assert.equal(findById(tree, "sidebar-tabs"), null);
  };
  check(v.render(cx), "files");
  state.shared[STORE] = { tab: "git" };
  check(v.render(cx), "git");
});

test("AC7 a switch in the rail draws no body frame motion", async () => {
  const { view: v, cx, tree } = await mountNotes({ tab: "files", width: 44 });
  findById(tree, "sidebar-rail-changes").onClick(null, cx);
  const next = v.render(cx);
  const moving = walk(next).filter((n) => n.calls.some(([name, a]) => name === "opacity" && a[0] === 0));
  assert.equal(moving.length, 0);
  assert.equal(walk(next).some((n) => n.nodeId === "sidebar-tabs-pill"), false);
});
