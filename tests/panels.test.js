// The Files / Changes side panel: what the layout shows, the commands to change it, and the
// choice remembered per space (mods/herdsidian-tabs/panels.js, pure).
import { test } from "node:test";
import assert from "node:assert/strict";
import { shownPanels, panelCommands, toggled, readChoice, sameChoice } from "../mods/herdsidian-tabs/panels.js";

const node = (hidden) => ({ hidden });

test("shownPanels reads each block, and a hidden column shows neither", () => {
  assert.deepEqual(shownPanels(node(false), { files: node(false), changes: node(true) }), { files: true, changes: false });
  assert.deepEqual(shownPanels(node(false), { files: node(false), changes: node(false) }), { files: true, changes: true });
  assert.deepEqual(shownPanels(node(true), { files: node(false), changes: node(false) }), { files: false, changes: false });
  assert.deepEqual(shownPanels(null, { files: node(false), changes: node(false) }), { files: false, changes: false });
  assert.deepEqual(shownPanels(node(false), { files: null, changes: node(false) }), { files: false, changes: true });
});

test("toggled flips one panel and keeps the other", () => {
  assert.deepEqual(toggled({ files: false, changes: false }, "files"), { files: true, changes: false });
  assert.deepEqual(toggled({ files: true, changes: false }, "changes"), { files: true, changes: true });
  assert.deepEqual(toggled({ files: true, changes: true }, "files"), { files: false, changes: true });
  assert.deepEqual(toggled({ files: false, changes: true }, "changes"), { files: false, changes: false });
});

test("panelCommands sets each block, then shows the column only when one is open", () => {
  assert.deepEqual(panelCommands({ files: true, changes: false }), [
    ["layout.show", { id: "files" }],
    ["layout.hide", { id: "changes" }],
    ["layout.show", { id: "panel" }],
  ]);
  assert.deepEqual(panelCommands({ files: true, changes: true }), [
    ["layout.show", { id: "files" }],
    ["layout.show", { id: "changes" }],
    ["layout.show", { id: "panel" }],
  ]);
  assert.deepEqual(panelCommands({ files: false, changes: false }), [
    ["layout.hide", { id: "files" }],
    ["layout.hide", { id: "changes" }],
    ["layout.hide", { id: "panel" }],
  ]);
});

test("readChoice reads the new form and the one older builds stored", () => {
  assert.deepEqual(readChoice({ files: true, changes: true }), { files: true, changes: true });
  assert.deepEqual(readChoice({ files: "yes" }), { files: false, changes: false });
  assert.deepEqual(readChoice("files"), { files: true, changes: false });
  assert.deepEqual(readChoice("changes"), { files: false, changes: true });
  assert.deepEqual(readChoice(null), { files: false, changes: false });
  assert.deepEqual(readChoice(undefined), { files: false, changes: false });
});

test("sameChoice compares both panels", () => {
  assert.equal(sameChoice({ files: true, changes: false }, { files: true, changes: false }), true);
  assert.equal(sameChoice({ files: true, changes: false }, { files: true, changes: true }), false);
});
