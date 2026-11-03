// The "Needs you" signal: the status bar pill and the Agents wording (F4).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, findById } from "./support/mod-stubs.js";

// The stub's agents() is read when the mod loads, so point it at a list the tests set.
let listed = [];
globalThis.__herdsidianStubs.herdr.agents = () => listed;

const { default: Status, needsLabel, firstBlocked } = await import("../mods/herdsidian-status/main.js");
const { STATUS_TEXT } = await import("../mods/guide-agents/main.js");

beforeEach(() => {
  state.runs = [];
  listed = [];
});

const agent = (pane, status) => ({ address: `t${pane}`, pane, status });
const render = () => new Status().render();
const words = (pill) => pill.kids.at(-1);

test("the status bar shows no Needs you pill without a blocked agent", () => {
  listed = [agent("p1", "working"), agent("p2", "done"), agent("p3", "idle")];
  assert.equal(findById(render(), "status-needs"), null);
});

test("the pill says Needs you for one blocked agent", () => {
  listed = [agent("p1", "working"), agent("p2", "blocked")];
  assert.equal(words(findById(render(), "status-needs")), "Needs you");
  assert.equal(needsLabel(1), "Needs you");
});

test("the pill counts three blocked agents", () => {
  listed = [agent("p1", "blocked"), agent("p2", "blocked"), agent("p3", "blocked"), agent("p4", "idle")];
  assert.equal(words(findById(render(), "status-needs")), "Needs you · 3");
  assert.equal(needsLabel(3), "Needs you · 3");
});

test("clicking the pill focuses the first blocked agent's pane", () => {
  listed = [agent("p1", "working"), agent("p2", "blocked"), agent("p3", "blocked")];
  findById(render(), "status-needs").onClick();
  assert.deepEqual(state.runs, [["pane.focus", { pane: "p2" }]]);
  assert.equal(firstBlocked(listed).pane, "p2");
});

test("firstBlocked finds nothing when no agent is blocked", () => {
  assert.equal(firstBlocked([agent("p1", "done")]), undefined);
});

test("the Agents list words blocked as Needs you", () => {
  assert.equal(STATUS_TEXT.blocked, "Needs you");
  assert.deepEqual(Object.values(STATUS_TEXT), ["Working", "Needs you", "Done", "Idle"]);
});
