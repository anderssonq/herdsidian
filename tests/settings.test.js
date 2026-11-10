import { test } from "node:test";
import assert from "node:assert/strict";
import { KEY_HINT_VALUES, SETTING_DEFAULTS, SIDEBAR_TABS, keyHintLabel, nextKeyHints, readSettings, settingSections, showKeyHint } from "../lib/keys.js";

test("defaults: key hints on hover, usage in the status bar on", () => {
  assert.deepEqual(SETTING_DEFAULTS, { keyHints: "modifier", usageInStatus: true, contextInSidebar: true });
  assert.deepEqual(readSettings(undefined), SETTING_DEFAULTS);
  assert.deepEqual(readSettings(null), SETTING_DEFAULTS);
  assert.deepEqual(readSettings("on"), SETTING_DEFAULTS);
});

test("readSettings accepts the three keyHints values", () => {
  for (const v of ["modifier", "always", "off"]) assert.equal(readSettings({ keyHints: v }).keyHints, v);
});

test("readSettings migrates old boolean keyHints", () => {
  assert.equal(readSettings({ keyHints: true }).keyHints, "always");
  assert.equal(readSettings({ keyHints: false }).keyHints, "off");
});

test("readSettings falls back to the default for anything else", () => {
  assert.equal(readSettings({ keyHints: "no" }).keyHints, "modifier");
  assert.equal(readSettings({ keyHints: 3 }).keyHints, "modifier");
  assert.equal(readSettings({ usageInStatus: "yes" }).usageInStatus, true);
  assert.equal(readSettings({ usageInStatus: false }).usageInStatus, false);
});

test("readSettings ignores unknown keys", () => {
  assert.deepEqual(readSettings({ other: 1, keyHints: "off" }), { keyHints: "off", usageInStatus: true, contextInSidebar: true });
});

test("nextKeyHints cycles modifier, always, off", () => {
  assert.deepEqual(KEY_HINT_VALUES, ["modifier", "always", "off"]);
  assert.equal(nextKeyHints("modifier"), "always");
  assert.equal(nextKeyHints("always"), "off");
  assert.equal(nextKeyHints("off"), "modifier");
});

test("keyHintLabel: modifier reads On hover (P0 fallback)", () => {
  assert.equal(keyHintLabel("modifier"), "On hover");
  assert.equal(keyHintLabel("always"), "Always");
  assert.equal(keyHintLabel("off"), "Off");
});

test("SIDEBAR_TABS order", () => {
  assert.deepEqual(SIDEBAR_TABS, ["notes", "files", "changes"]);
});

const base = { settings: { keyHints: "modifier", usageInStatus: true }, sidebarHidden: false, sidebarRail: false };

test("settingSections: General has the key hints row", () => {
  const s = settingSections(base);
  assert.deepEqual(s.map((x) => x.title), ["General", "Layout"]);
  const row = s[0].rows[0];
  assert.equal(row.id, "key-hints");
  assert.equal(row.label, "Key hints");
  assert.equal(row.detail, "On hover");
  assert.deepEqual(row.action, { type: "setting", name: "keyHints", value: "always" });
  assert.equal(settingSections({ ...base, settings: { ...base.settings, keyHints: "off" } })[0].rows[0].action.value, "modifier");
});

test("settingSections: Layout rows and actions", () => {
  const rows = settingSections(base)[1].rows;
  assert.deepEqual(rows.map((r) => r.id), ["right-sidebar", "sidebar-tab", "sidebar-width", "usage-in-status", "context-in-sidebar"]);
  const [side, tab, width, usage] = rows;
  assert.equal(side.label, "Right sidebar");
  assert.equal(side.detail, "Shown");
  assert.equal(side.keycap, null);
  assert.deepEqual(side.action, { type: "run", name: "layout.toggle", args: { id: "herdsidian" } });
  assert.equal(tab.label, "Right sidebar tab");
  assert.equal(tab.detail, "Notes");
  assert.deepEqual(tab.action, { type: "run", name: "herdsidian-tabs.files", args: {} });
  assert.equal(width.label, "Sidebar width");
  assert.equal(width.detail, "Expanded");
  assert.deepEqual(width.action, { type: "run", name: "herdsidian.rail", args: {} });
  assert.equal(usage.label, "Usage in the status bar");
  assert.equal(usage.detail, "On");
  assert.deepEqual(usage.action, { type: "setting", name: "usageInStatus", value: false });
});

test("settingSections: tab detail and next tab follow the order, wrapping", () => {
  const next = (sidebarTab) => settingSections({ ...base, sidebarTab })[1].rows[1];
  assert.equal(next("files").detail, "Files");
  assert.equal(next("files").action.name, "herdsidian-tabs.changes");
  assert.equal(next("changes").detail, "Changes");
  assert.equal(next("changes").action.name, "herdsidian-tabs.notes");
  assert.equal(next("notes").action.name, "herdsidian-tabs.files");
  // A stored "settings" tab reads as Notes.
  assert.equal(next("settings").detail, "Notes");
  assert.equal(next("settings").action.name, "herdsidian-tabs.files");
});

test("settingSections: rail and usage off", () => {
  const rows = settingSections({ ...base, sidebarRail: true, settings: { ...base.settings, usageInStatus: false } })[1].rows;
  assert.equal(rows[2].detail, "Rail");
  assert.deepEqual(rows[2].action, { type: "run", name: "herdsidian.expand", args: {} });
  assert.equal(rows[3].detail, "Off");
  assert.equal(rows[3].action.value, true);
});

test("settingSections: a hidden sidebar omits the width row", () => {
  const rows = settingSections({ ...base, sidebarHidden: true })[1].rows;
  assert.deepEqual(rows.map((r) => r.id), ["right-sidebar", "sidebar-tab", "usage-in-status", "context-in-sidebar"]);
  assert.equal(rows[0].detail, "Hidden");
});

test("settingSections: the Right sidebar row has no keycap", () => {
  const rows = settingSections(base)[1].rows;
  assert.equal(rows[0].keycap, null);
});

test("showKeyHint: always shows every row, modifier only the hovered one, off none", () => {
  assert.equal(showKeyHint("always", null, "a"), true);
  assert.equal(showKeyHint("always", "b", "a"), true);
  assert.equal(showKeyHint("modifier", "a", "a"), true);
  assert.equal(showKeyHint("modifier", "b", "a"), false);
  assert.equal(showKeyHint("modifier", null, "a"), false);
  assert.equal(showKeyHint("off", "a", "a"), false);
});
