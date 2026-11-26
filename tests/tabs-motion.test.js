// AC6: the pane tab bar draws the active tab with one sliding pill (`tabs-active-pill`). The pure
// pillBox / pillSnap, then the mounted toolbar with `on_size_change` fired by the test.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import "./support/mod-stubs.js";

// The mod captures the stubs when the kit loads it, so the zoom stub is set first and reads a variable.
let zoom = 1;
globalThis.__herdsidianStubs.herdr.settings = () => ({ zoom });
const { findById, mountTabs, handler, transitionOf, styleOf } =
  await import("./support/sidebar-kit.js");

// Loaded by hand so the mounted tests run (and fail on their own) while pill.js does not exist yet.
const { pillBox, pillSnap } =
  await import("../mods/herdsidian-tabs/pill.js").catch(() => ({}));

afterEach(() => {
  zoom = 1;
});

const SLIDE = { duration: 180, easing: "ease-out" };
const WIDTHS = { t1: 40, t2: 60, t3: 80, t4: 100 };
const PILL = "tabs-active-pill";

// ---- pure ----

const sizes = (obj) => new Map(Object.entries(obj));
const IDS = ["t1", "t2", "t3", "t4"];

test("AC6 pillBox places the third of four tabs at the widths before it plus the gaps", () => {
  assert.deepEqual(pillBox(IDS, sizes(WIDTHS), "t3"), {
    left: 40 + 2 + 60 + 2,
    width: 80,
  });
});

test("AC6 pillBox places the second tab and honors a gap argument", () => {
  assert.deepEqual(pillBox(IDS, sizes(WIDTHS), "t2"), { left: 42, width: 60 });
  assert.deepEqual(pillBox(IDS, sizes(WIDTHS), "t3", 4), {
    left: 40 + 4 + 60 + 4,
    width: 80,
  });
});

test("AC6 pillBox is null when a width at or before the active tab is missing", () => {
  assert.equal(pillBox(IDS, sizes({ t1: 40, t3: 80, t4: 100 }), "t3"), null);
  assert.equal(pillBox(IDS, sizes({ t1: 40, t2: 60 }), "t3"), null);
  assert.equal(pillBox(IDS, new Map(), "t3"), null);
});

test("AC6 pillBox ignores a missing width after the active tab", () => {
  assert.deepEqual(pillBox(IDS, sizes({ t1: 40, t2: 60, t3: 80 }), "t3"), {
    left: 104,
    width: 80,
  });
});

test("AC6 pillBox is null when the active tab is not in the list", () => {
  assert.equal(pillBox(IDS, sizes(WIDTHS), "t9"), null);
  assert.equal(pillBox(IDS, sizes(WIDTHS), null), null);
});

const frame = (over = {}) => ({
  space: "s1",
  ids: IDS,
  active: "t3",
  box: { left: 104, width: 80 },
  sizesKey: "40,60,80,100",
  switchedAt: 1000,
  ...over,
});

test("AC6 pillSnap slides when only the active tab changed in the same space", () => {
  const prev = frame({
    active: "t1",
    box: { left: 0, width: 40 },
    switchedAt: 0,
  });
  const next = frame({ switchedAt: 5000 });
  assert.equal(pillSnap(prev, next, 5000), false);
});

test("AC6 pillSnap snaps on the first placement", () => {
  assert.equal(pillSnap(null, frame(), 1000), true);
  assert.equal(pillSnap(frame({ box: null }), frame(), 1000), true);
});

test("AC6 pillSnap snaps on a space change", () => {
  assert.equal(
    pillSnap(
      frame({ space: "s1", active: "t1" }),
      frame({ space: "s2", switchedAt: 1000 }),
      1000,
    ),
    true,
  );
});

test("AC6 pillSnap snaps when a tab is added, closed or moved", () => {
  assert.equal(pillSnap(frame(), frame({ ids: [...IDS, "t5"] }), 1000), true);
  assert.equal(
    pillSnap(frame(), frame({ ids: ["t1", "t2", "t3"] }), 1000),
    true,
  );
  assert.equal(
    pillSnap(frame(), frame({ ids: ["t1", "t3", "t2", "t4"] }), 1000),
    true,
  );
});

test("AC6 pillSnap keeps the transition for a width change 100 ms after a switch", () => {
  const next = frame({
    box: { left: 104, width: 90 },
    sizesKey: "40,60,90,100",
    switchedAt: 1000,
  });
  assert.equal(pillSnap(frame(), next, 1100), false);
});

test("AC6 pillSnap snaps for a width change 400 ms after the last switch", () => {
  const next = frame({
    box: { left: 104, width: 90 },
    sizesKey: "40,60,90,100",
    switchedAt: 1000,
  });
  assert.equal(pillSnap(frame(), next, 1400), true);
});

// ---- mounted ----

// The toolbar's tab ids t1..t4 with the third active, or the given ids and active one.
const tabsList = (active, ids = IDS) =>
  ids.map((id, n) => ({
    id,
    index: n + 1,
    name: `name-${id}`,
    active: id === active,
  }));
// The kit's herdr.spaces() returns the array mountTabs got, so the list is changed in place.
let current = null;
const setSpaces = (spaces) => current.splice(0, current.length, ...spaces);

// Mounts one space; render() draws the current tree; fire(widths) reports sizes then re-renders; notifies counts cx.notify().
function mount({ active = "t3", ids = IDS } = {}) {
  current = [
    { id: "s1", name: "alpha", active: true, tabs: tabsList(active, ids) },
  ];
  const m = mountTabs({ spaces: current });
  m.notifies = 0;
  const notify = m.cx.notify;
  m.cx.notify = (...args) => {
    m.notifies += 1;
    return notify.apply(m.cx, args);
  };
  m.render = () => (m.tree = m.view.render(m.cx));
  m.tab = (id) => findById(m.tree, `tab-${id}`);
  m.pill = () => findById(m.tree, PILL);
  m.fire = (widths) => {
    for (const [id, width] of Object.entries(widths))
      handler(m.tab(id), "on_size_change")({ width, height: 28 }, m.cx);
    return m.render();
  };
  return m;
}

const namesOf = (node) => new Set(node.calls.map(([name]) => name));
const bgOf = (node) => JSON.stringify(styleOf(node, "bg"));

test("AC6 with no width known there is no pill and the active tab draws its own fill", () => {
  const m = mount();
  assert.equal(m.pill(), null);
  assert.notEqual(
    bgOf(m.tab("t3")),
    bgOf(m.tab("t2")),
    "active tab keeps its fill",
  );
  assert.notEqual(
    JSON.stringify(styleOf(m.tab("t3"), "border_color")),
    JSON.stringify(styleOf(m.tab("t2"), "border_color")),
  );
});

test("AC6 with only some widths known (one before the active tab missing) there is still no pill", () => {
  const m = mount();
  m.fire({ t1: 40, t3: 80, t4: 100 });
  assert.equal(m.pill(), null);
  assert.notEqual(bgOf(m.tab("t3")), bgOf(m.tab("t2")));
});

test("AC6 with all widths known the pill sits at the third tab: widths before plus gaps", () => {
  const m = mount();
  m.fire(WIDTHS);
  const pill = m.pill();
  assert.ok(pill, "the pill is drawn");
  assert.equal(styleOf(pill, "left"), 104);
  assert.equal(styleOf(pill, "w"), 80);
});

test("AC6 with a pill the active tab's own fill and border are transparent like an inactive tab", () => {
  const m = mount();
  m.fire(WIDTHS);
  assert.equal(bgOf(m.tab("t3")), bgOf(m.tab("t2")));
  assert.equal(
    JSON.stringify(styleOf(m.tab("t3"), "border_color")),
    JSON.stringify(styleOf(m.tab("t2"), "border_color")),
  );
});

test("AC6 the pill is the first child of tab-scroll and is not a tab id", () => {
  const m = mount();
  m.fire(WIDTHS);
  const scroll = findById(m.tree, "tab-scroll");
  assert.equal(scroll.kids[0].nodeId, PILL);
  assert.ok(!PILL.startsWith("tab-"));
});

test("AC6 the first placement has no transition", () => {
  const m = mount();
  m.fire(WIDTHS);
  assert.equal(transitionOf(m.pill(), "left"), undefined);
  assert.equal(transitionOf(m.pill(), "width"), undefined);
});

test("AC6 an active change in the same space slides with 180 ms ease-out on left and width", () => {
  const m = mount({ active: "t1" });
  m.fire(WIDTHS);
  setSpaces([{ id: "s1", name: "alpha", active: true, tabs: tabsList("t3") }]);
  m.render();
  const pill = m.pill();
  assert.equal(styleOf(pill, "left"), 104);
  assert.equal(styleOf(pill, "w"), 80);
  assert.deepEqual(transitionOf(pill, "left"), SLIDE);
  assert.deepEqual(transitionOf(pill, "width"), SLIDE);
});

test("AC6 a space change places the pill with no transition", () => {
  const m = mount({ active: "t1" });
  m.fire(WIDTHS);
  const other = { id: "s2", name: "beta", active: true, tabs: tabsList("t3") };
  setSpaces([
    { id: "s1", name: "alpha", active: false, tabs: tabsList("t1") },
    other,
  ]);
  m.render();
  assert.equal(styleOf(m.pill(), "left"), 104);
  assert.equal(transitionOf(m.pill(), "left"), undefined);
  assert.equal(transitionOf(m.pill(), "width"), undefined);
});

test("AC6 a tab added places the pill with no transition", () => {
  const m = mount();
  m.fire(WIDTHS);
  setSpaces([
    {
      id: "s1",
      name: "alpha",
      active: true,
      tabs: tabsList("t3", [...IDS, "t5"]),
    },
  ]);
  m.render();
  assert.equal(styleOf(m.pill(), "left"), 104);
  assert.equal(transitionOf(m.pill(), "left"), undefined);
  assert.equal(transitionOf(m.pill(), "width"), undefined);
});

test("AC6 a tab closed before the active one places the pill with no transition", () => {
  const m = mount();
  m.fire(WIDTHS);
  setSpaces([
    {
      id: "s1",
      name: "alpha",
      active: true,
      tabs: tabsList("t3", ["t1", "t3", "t4"]),
    },
  ]);
  m.render();
  assert.equal(styleOf(m.pill(), "left"), 42);
  assert.equal(transitionOf(m.pill(), "left"), undefined);
  assert.equal(transitionOf(m.pill(), "width"), undefined);
});

test("AC6 a tab moved places the pill with no transition", () => {
  const m = mount();
  m.fire(WIDTHS);
  setSpaces([
    {
      id: "s1",
      name: "alpha",
      active: true,
      tabs: tabsList("t3", ["t1", "t3", "t2", "t4"]),
    },
  ]);
  m.render();
  assert.equal(styleOf(m.pill(), "left"), 42);
  assert.equal(styleOf(m.pill(), "w"), 80);
  assert.equal(transitionOf(m.pill(), "left"), undefined);
  assert.equal(transitionOf(m.pill(), "width"), undefined);
});

test("AC6 at zoom 2 the reported sizes are halved", () => {
  zoom = 2;
  const m = mount();
  m.fire({ t1: 80, t2: 120, t3: 160, t4: 200 });
  assert.equal(styleOf(m.pill(), "left"), 104);
  assert.equal(styleOf(m.pill(), "w"), 80);
});

test("AC6 the same size reported twice asks for no second render", () => {
  const m = mount();
  m.fire(WIDTHS);
  const before = m.notifies;
  assert.ok(before > 0, "a new width asks for a render");
  m.fire(WIDTHS);
  assert.equal(m.notifies, before);
});

test("AC6 every tab has on_size_change and keeps its ids, handlers and children", () => {
  const m = mount();
  const before = Object.fromEntries(IDS.map((id) => [id, namesOf(m.tab(id))]));
  m.fire(WIDTHS);
  for (const id of IDS) {
    const node = m.tab(id);
    assert.ok(handler(node, "on_size_change"), `${id} reports its size`);
    assert.ok(handler(node, "on_hover"), `${id} keeps on_hover`);
    for (const [name, button] of [
      ["on_mouse_down", "left"],
      ["on_mouse_up", "left"],
      ["on_mouse_down", "right"],
    ])
      assert.ok(handler(node, name, button), `${id} keeps ${name} ${button}`);
    assert.ok(
      node.calls.some(([name]) => name === "tooltip"),
      `${id} keeps its tooltip`,
    );
    for (const name of before[id])
      assert.ok(namesOf(node).has(name), `${id} keeps ${name}`);
  }
  assert.ok(
    findById(m.tree, "close-t3"),
    "the active tab keeps its close button",
  );
  assert.equal(findById(m.tree, "close-t2"), null);
  for (const id of ["tab-bar", "tab-scroll", "tab-new"])
    assert.ok(findById(m.tree, id), id);
});
