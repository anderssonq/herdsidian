// The second review round of the sidebar motion and layout change: a prompt closed or moved during a write (R1),
// no input write in render (R2), a stale Close below (R3), Herdr's zoom on the measured sizes, and the spec gaps
// the first round left (AC1, AC6, AC28, AC31). Through the real Notes and herdsidian-tabs views.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "./support/mod-stubs.js";

// The mods capture the stubs when the kit loads them: both are set first, and read a variable or a table.
let zoom = 1;
const stubs = globalThis.__herdsidianStubs;
stubs.herdr.settings = () => ({ zoom });
// A theme with a different "#rrggbb" per key, so a wrong key shows in a value compare.
const COLORS = new Map();
stubs.herdr.theme = () =>
  new Proxy(
    {},
    {
      get: (_t, key) => {
        if (typeof key !== "string" || key === "then") return undefined;
        if (!COLORS.has(key)) {
          const n = COLORS.size * 0x1f3b5 + 0x102030;
          COLORS.set(key, `#${(n % 0xffffff).toString(16).padStart(6, "0")}`);
        }
        return COLORS.get(key);
      },
    },
  );
// Every input state made, with the options it was made with, so a test can read the placeholder.
const inputs = [];
const makeInput = stubs["gpui-base"].InputState.new;
stubs["gpui-base"].InputState.new = (opts) => {
  const made = makeInput(opts);
  inputs.push({ opts, made });
  return made;
};

const {
  state,
  fakeCx,
  findById,
  mountNotes,
  mountTabs,
  handler,
  styleOf,
  settle,
  STORE,
  LAYOUT_STORE,
} = await import("./support/sidebar-kit.js");
const { tokens } = await import("../mods/herdsidian/tokens.js");
const { default: Notes } = await import("../mods/herdsidian/main.js");

const VAULT = "/vault/my notes";
const realWrite = state.writeTextFile;
const layout = () => state.shared[LAYOUT_STORE];
const theme = () => stubs.herdr.theme();

// Holds the next writes until released: the prompt changes while a note is being written.
let gate = null;
const hold = () => {
  let release;
  gate = new Promise((resolve) => {
    release = resolve;
  });
  return release;
};

beforeEach(() => {
  zoom = 1;
  gate = null;
  state.props = {};
  state.runs = [];
  state.closed = [];
  state.writeTextFile = async (path, text, expected) => {
    if (gate) await gate;
    return realWrite(path, text, expected);
  };
  localStorage.removeItem("width");
});

// A Notes view with a prompt submitting `text` (blank: Untitled) whose write waits on the gate.
async function submitting(text) {
  const m = await mountNotes();
  const actions = m.view.actions;
  actions.askNoteName("", m.cx);
  actions.nameInput.set_value(text);
  m.loads = 0;
  const load = m.view.load.bind(m.view);
  m.view.load = (cx) => {
    m.loads++;
    return load(cx);
  };
  m.release = hold();
  actions.nameInput.fire("submit", null, m.cx);
  await settle();
  return m;
}

// ---- R1: the prompt closed or moved during the write ----

for (const [label, text, file] of [
  ["a blank Untitled submit", "", "Untitled.md"],
  ["a named submit", "Plan", "Plan.md"],
]) {
  test(`AC32 Escape during ${label}: the file stays and shows in the tree, but is not opened`, async () => {
    const m = await submitting(text);
    m.view.actions.cancelNoteName(m.cx);
    m.release();
    await settle();
    assert.equal(state.files[`${VAULT}/${file}`], "", "the note was written");
    assert.ok(!m.view.note, "the note is not opened");
    assert.notEqual(m.view.mode, "edit");
    assert.ok(m.loads >= 1, "the tree reloads to show it");
    assert.equal(m.view.actions.naming, null);
    assert.equal(m.view.actions.nameBusy, false);
  });

  test(`AC32 a prompt moved to another folder during ${label}: the file stays, the newer prompt keeps its text`, async () => {
    const m = await submitting(text);
    const actions = m.view.actions;
    actions.askNoteName("Docs", m.cx);
    actions.nameInput.set_value("Keep");
    m.release();
    await settle();
    assert.equal(state.files[`${VAULT}/${file}`], "", "the note was written");
    assert.ok(!m.view.note, "the note is not opened");
    assert.equal(actions.naming?.dir, "Docs", "the newer prompt stays");
    assert.equal(actions.nameInput.value(), "Keep");
    assert.ok(m.loads >= 1, "the tree reloads to show it");
  });

  test(`AC32 Escape then a new prompt during ${label}: the newer prompt keeps its text`, async () => {
    const m = await submitting(text);
    const actions = m.view.actions;
    actions.cancelNoteName(m.cx);
    actions.askNoteName("Docs", m.cx);
    actions.nameInput.set_value("Keep");
    m.release();
    await settle();
    assert.equal(state.files[`${VAULT}/${file}`], "", "the note was written");
    assert.ok(!m.view.note, "the note is not opened");
    assert.equal(actions.naming?.dir, "Docs");
    assert.equal(actions.nameInput.value(), "Keep");
  });
}

// ---- R2: no input write in render ----

test("AC36 a tab switch away from Notes with typed text writes no input value during render", async () => {
  const { view, cx } = await mountNotes({ tab: "notes" });
  const actions = view.actions;
  actions.askNoteName("", cx);
  actions.nameInput.set_value("typed");
  const input = actions.nameInput;
  let writes = 0;
  const setValue = input.set_value;
  input.set_value = (next) => {
    writes++;
    return setValue(next);
  };
  state.shared[STORE] = { tab: "files" };
  view.render(cx);
  assert.equal(writes, 0, "render did not touch the input");
  assert.equal(actions.naming, null, "the prompt is closed");
  input.set_value = setValue;
  state.shared[STORE] = { tab: "notes" };
  view.render(cx);
  assert.equal(actions.naming, null, "coming back does not show it");
  actions.askNoteName("", cx);
  assert.equal(input.value(), "", "a reopened prompt starts empty");
});

// ---- R3: a stale Close below ----

const STORED = { order: ["notes", "files", "changes", "git"], split: { top: "files", below: "changes" }, splitTop: 240 };

// The popup copy of Notes for the tab menu of `tab`, opened while files over changes is stored; then the stored
// top tab becomes `storeTab` (a stale menu) and the row is clicked. Returns the closed overlays.
async function staleClose(tab, storeTab) {
  await mountNotes({ tab: "files", layout: STORED });
  state.props = { overlay: "menu-1", sidebarMenu: { tab, op: "close-below" } };
  const view = new Notes();
  const cx = fakeCx();
  view.init({}, cx);
  const row = findById(view.render(cx), "sidebar-menu-close-below");
  state.props = {};
  assert.ok(row, "the Close below row");
  if (storeTab) state.shared[STORE] = { tab: storeTab };
  row.onClick({}, cx);
  return state.closed;
}

test("AC23 Close below from a menu whose tab became the top tab leaves the layout store unchanged", async () => {
  const closed = await staleClose("changes", "changes");
  assert.deepEqual(layout(), STORED);
  assert.deepEqual(closed, ["menu-1"], "the menu still closes");
});

test("AC23 Close below from a menu whose tab is not in the split leaves the layout store unchanged", async () => {
  const closed = await staleClose("git");
  assert.deepEqual(layout(), STORED);
  assert.deepEqual(closed, ["menu-1"]);
});

test("AC23 Close below from a menu of the current bottom tab still closes the split", async () => {
  await staleClose("changes");
  assert.deepEqual(layout(), { ...STORED, split: null });
});

// ---- Herdr's zoom on the measured sizes ----

test("AC21 at zoom 2 the divider stores the top height in layout px, not window px", async () => {
  zoom = 2;
  const { view, cx } = await mountNotes({
    tab: "files",
    layout: { split: { top: "files", below: "changes" } },
  });
  const group = findById(view.render(cx), "sidebar-split");
  handler(group, "on_resize")([300, 200], cx);
  assert.equal(layout().splitTop, 150);
});

test("AC9 at zoom 2 the measured tab control width is divided by the zoom", async () => {
  zoom = 2;
  const { view, cx, tree } = await mountNotes({ tab: "notes" });
  handler(findById(tree, "sidebar-tabs"), "on_size_change")({ width: 300, height: 30 }, cx);
  assert.equal(view.tabsPx, 150);
  const pill = findById(view.render(cx), "sidebar-tabs-pill");
  assert.equal(styleOf(pill, "w"), (150 - 2 * 3 - 2 * 3) / 4, "the pill is sized from the layout width");
});

// ---- AC1 and AC6: the pill's fill and top line ----

test("AC1 the sidebar pill is the raised fill with a 1 px top line in the highlight color", async () => {
  const { tree } = await mountNotes({ tab: "notes" });
  const t = theme();
  const pill = findById(tree, "sidebar-tabs-pill");
  assert.ok(pill, "the pill is drawn");
  assert.notEqual(t.raised, tokens(t).highlight, "the stub tells the two apart");
  assert.equal(styleOf(pill, "bg"), t.raised);
  assert.equal(styleOf(pill, "border_t"), 1);
  assert.equal(styleOf(pill, "border_color"), tokens(t).highlight);
});

test("AC6 the pane tab bar's pill is the raised fill with a 1 px top line in the highlight color", () => {
  const m = mountTabs();
  for (const id of ["t1", "t2", "t3", "t4"]) {
    handler(findById(m.tree, `tab-${id}`), "on_size_change")({ width: 60, height: 28 }, m.cx);
  }
  const t = theme();
  const pill = findById(m.view.render(m.cx), "tabs-active-pill");
  assert.ok(pill, "the pill is drawn");
  assert.equal(styleOf(pill, "bg"), t.raised);
  assert.equal(styleOf(pill, "border_t"), 1);
  assert.equal(styleOf(pill, "border_color"), tokens(t).highlight);
});

// ---- AC28: a bottom tab runs its work ----

test("AC28 Git in the bottom section loads and syncs with the watch", async () => {
  const { view } = await mountNotes({ tab: "notes", layout: { split: { top: "notes", below: "git" } } });
  assert.equal(view.gitTab.away, false, "Git is shown now");
  assert.notEqual(view.gitTab.key, null, "it synced");
  assert.equal(view.host.changes().onApply, view.gitTab.hook, "the watch wakes it");
});

test("AC28 Git in no section stays away", async () => {
  const { view } = await mountNotes({ tab: "notes" });
  assert.equal(view.gitTab.away, true);
  assert.notEqual(view.host.changes().onApply, view.gitTab.hook);
});

test("AC28 Changes in the bottom section applies the watch", async () => {
  const { view, cx } = await mountNotes({ tab: "notes", layout: { split: { top: "notes", below: "changes" } } });
  const tab = view.changesTab;
  assert.ok(tab, "the Changes tab is made");
  let synced = 0;
  tab.sync = () => {
    synced++;
  };
  const watch = view.host.changes();
  assert.equal(watch.onApply, tab.hook);
  watch.onApply(cx);
  assert.equal(synced, 1, "a read applied to the shown bottom tab");
});

test("AC28 Changes in no section does not apply the watch", async () => {
  const { view } = await mountNotes({ tab: "notes" });
  assert.equal(view.changesTab, undefined);
});

// ---- AC31: the prompt's placeholder and the rail ----

test("AC31 the name input's placeholder is Untitled", async () => {
  const { view } = await mountNotes();
  const made = inputs.find((i) => i.made === view.actions.nameInput);
  assert.ok(made, "the prompt's input was made through InputState.new");
  assert.equal(made.opts?.placeholder, "Untitled");
});

test("AC31 New note from the rail expands the sidebar to its restored width before the prompt opens", async () => {
  localStorage.setItem("width", "500");
  const { view, cx, tree } = await mountNotes({ width: 44 });
  let runsAtAsk = null;
  const ask = view.actions.askNoteName.bind(view.actions);
  view.actions.askNoteName = (...args) => {
    runsAtAsk = state.runs.map(([name, a]) => [name, a]);
    return ask(...args);
  };
  findById(tree, "notes-new-rail").onClick({}, cx);
  assert.deepEqual(runsAtAsk, [["layout.resize", { id: "herdsidian", px: 500 }]], "resized first");
  assert.notEqual(view.actions.naming, null, "the prompt is open");
});
