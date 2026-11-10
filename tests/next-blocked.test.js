// V7: ⌘J focuses the next blocked agent, after the focused one in the list's order, wrapping around.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, settle } from "./support/mod-stubs.js";

const list = [
  { address: "a", pane: "p1", status: "blocked", seq: 1 },
  { address: "b", pane: "p2", status: "working", seq: 2 },
  { address: "c", pane: "p3", status: "blocked", seq: 3 },
  { address: "d", pane: "p4", status: "idle", seq: 4 },
  { address: "e", pane: "p5", status: "blocked", seq: 5 },
];
let focusedPane = "p2";
// The mods capture the runtime functions at import, so set them before.
globalThis.__herdsidianStubs.herdr.agents = () => list;
globalThis.__herdsidianStubs.herdr.terminals = () => [];
globalThis.__herdsidianStubs.herdr.focused = () => ({ pane: focusedPane });

const { nextBlocked } = await import("../mods/guide-agents/blocked.js");
const { default: Agents } = await import("../mods/guide-agents/main.js");

const order = (...statuses) => statuses.map((status, i) => ({ address: `x${i}`, pane: `q${i}`, status }));
const panes = (...agents) => agents.map((a) => a?.pane ?? null);

test("AC-V7.1: three blocked agents are all visited, and a fourth call returns to the first", () => {
  let pane = "p2";
  const seen = [];
  for (let i = 0; i < 4; i++) {
    pane = nextBlocked(list, pane).pane;
    seen.push(pane);
  }
  assert.deepEqual(seen, ["p3", "p5", "p1", "p3"]);
});

test("from each blocked agent, three calls visit all three and return to the start", () => {
  for (const start of ["p1", "p3", "p5"]) {
    let pane = start;
    const seen = new Set();
    for (let i = 0; i < 3; i++) {
      pane = nextBlocked(list, pane).pane;
      seen.add(pane);
    }
    assert.deepEqual([...seen].sort(), ["p1", "p3", "p5"]);
    assert.equal(pane, start);
  }
});

test("it wraps past the end of the list", () => {
  const o = order("blocked", "idle", "blocked");
  assert.equal(nextBlocked(o, "q2").pane, "q0");
});

test("no blocked agent gives null", () => {
  assert.equal(nextBlocked(order("idle", "working", "done"), "q1"), null);
  assert.equal(nextBlocked([], "q0"), null);
});

test("a focused agent not in the list gets the first blocked one", () => {
  const o = order("idle", "blocked", "blocked");
  assert.equal(nextBlocked(o, "gone").pane, "q1");
  assert.equal(nextBlocked(o, undefined).pane, "q1");
});

test("a focused agent that is the only blocked one returns itself", () => {
  const o = order("idle", "blocked", "working");
  assert.equal(nextBlocked(o, "q1").pane, "q1");
});

test("a focused agent that is not blocked finds the next blocked after it", () => {
  const o = order("blocked", "working", "idle", "blocked");
  assert.deepEqual(panes(nextBlocked(o, "q1"), nextBlocked(o, "q2")), ["q3", "q3"]);
});

test("the next-blocked command focuses the next blocked agent's pane", async () => {
  state.runs = [];
  state.commands = ["next-blocked"];
  focusedPane = "p1";
  const view = new Agents();
  const cx = fakeCx();
  view.init({}, cx);
  view.render(cx);
  await settle();
  // The priority view lists blocked agents newest first: e, c, a. After a (p1) it wraps to e (p5).
  assert.deepEqual(state.runs.filter(([name]) => name === "pane.focus"), [["pane.focus", { pane: "p5" }]]);
});
