// V7: the status bar's "Needs you" pill does what ⌘J does: the next blocked agent after the
// focused one, in the Agents list's published order, wrapping around.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, findById } from "./support/mod-stubs.js";

let listed = [];
let focusedPane = null;
globalThis.__herdsidianStubs.herdr.agents = () => listed;
globalThis.__herdsidianStubs.herdr.focused = () => (focusedPane ? { pane: focusedPane } : null);

const { default: Status } = await import("../mods/herdsidian-status/main.js");

beforeEach(() => {
  state.runs = [];
  state.shared = {};
  listed = [];
  focusedPane = null;
});

const agent = (pane, status) => ({ address: `t${pane}`, pane, status });
const click = () => findById(new Status().render(), "status-needs").onClick();

test("from a focused blocked agent the pill goes to the next blocked one", () => {
  listed = [agent("p1", "blocked"), agent("p2", "working"), agent("p3", "blocked")];
  focusedPane = "p1";
  click();
  assert.deepEqual(state.runs, [["pane.focus", { pane: "p3" }]]);
});

test("the pill wraps around to the first blocked agent", () => {
  listed = [agent("p1", "blocked"), agent("p2", "working"), agent("p3", "blocked")];
  focusedPane = "p3";
  click();
  assert.deepEqual(state.runs, [["pane.focus", { pane: "p1" }]]);
});

test("the pill follows the Agents list's published order, not the model order", () => {
  listed = [agent("p1", "blocked"), agent("p2", "blocked"), agent("p3", "blocked")];
  state.shared["guide-agents.order"] = ["tp2", "tp3", "tp1"];
  focusedPane = "p2";
  click();
  assert.deepEqual(state.runs, [["pane.focus", { pane: "p3" }]]);
});
