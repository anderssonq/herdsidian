// The Git tab's lane layout (git-lanes.js): layoutLanes, laneGeometry, laneX and laneSegments. Written from AC19 to AC26,
// Q6 and the plan's Decision 4 and git-lanes.js contract. Every expected row is worked out by hand from Decision 4.
import { commitsOf } from "./support/git-kit.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutLanes, laneGeometry, laneX, laneSegments, GRAPH_ROW, LANE_W, LANE_PAD, MAX_LANES, NODE, NODE_DOT } from "../mods/herdsidian/git-lanes.js";

// "1.1" -> [true, false, true]: one character per lane, "1" when the lane holds a line.
const bits = (s) => [...s].map((ch) => ch === "1");
const row = (col, before, after, ins, outs, down) => ({ col, before: bits(before), after: bits(after), ins, outs, down });
// Only the LaneRow fields of the contract are compared.
const shape = (r) => ({ col: r.col, before: r.before, after: r.after, ins: r.ins, outs: r.outs, down: r.down });
const rowsOf = (layout) => layout.rows.map(shape);

test("contract: the graph constants", () => {
  assert.deepEqual({ GRAPH_ROW, LANE_W, LANE_PAD, MAX_LANES, NODE, NODE_DOT }, { GRAPH_ROW: 24, LANE_W: 16, LANE_PAD: 12, MAX_LANES: 6, NODE: 16, NODE_DOT: 8 });
});

test("AC19: a linear history has every node in column 0 and one lane", () => {
  const out = layoutLanes(commitsOf(`
    c3 <- c2 | third
    c2 <- c1 | second
    c1 <-    | first
  `));
  assert.deepEqual(rowsOf(out), [
    row(0, "", "1", [], [], true),
    row(0, "1", "1", [], [], true),
    row(0, "1", "", [], [], false),
  ]);
  assert.equal(out.width, 1);
  assert.deepEqual(out.open, []);
});

test("AC20: a fork puts A in column 0 and B in column 1; on P's row lane 1 bends into column 0 and is free after it", () => {
  const out = layoutLanes(commitsOf(`
    a <- p | child A
    b <- p | child B
    p <- o | the shared parent
    o <-   | root
  `));
  assert.deepEqual(rowsOf(out), [
    row(0, "", "1", [], [], true),
    row(1, "1", "11", [], [], true),
    row(0, "11", "1", [1], [], true),
    row(0, "1", "", [], [], false),
  ]);
  assert.equal(out.width, 2);
});

test("AC21: a merge whose second parent already has a lane sends its edge to that lane", () => {
  const out = layoutLanes(commitsOf(`
    x  <- p2    | waits for p2
    m  <- p1 p2 | merge
    p1 <- p2    | first parent
    p2 <-       | root
  `));
  assert.deepEqual(rowsOf(out), [
    row(0, "", "1", [], [], true),
    row(1, "1", "11", [], [0], true),
    row(1, "11", "11", [], [], true),
    row(0, "11", "", [1], [], false),
  ]);
});

test("AC21: a merge whose second parent has no lane takes the leftmost free lane", () => {
  const out = layoutLanes(commitsOf(`
    t1 <- m     | tip 1
    t2 <- s     | tip 2
    t3 <- u     | tip 3
    s  <-       | frees lane 1
    m  <- p1 p2 | merge
    p1 <-       | root
    p2 <-       | root
    u  <-       | root
  `));
  assert.deepEqual(rowsOf(out), [
    row(0, "", "1", [], [], true),
    row(1, "1", "11", [], [], true),
    row(2, "11", "111", [], [], true),
    row(1, "111", "1.1", [], [], false),
    row(0, "1.1", "111", [], [1], true),
    row(0, "111", ".11", [], [], false),
    row(1, ".11", "..1", [], [], false),
    row(2, "..1", "", [], [], false),
  ]);
});

test("AC21: a merge with no free lane opens a new lane on the right for its second parent", () => {
  const out = layoutLanes(commitsOf(`
    x  <- q     | tip
    m  <- p1 p2 | merge
    p1 <- q     | first parent
    p2 <-       | root
    q  <-       | root
  `));
  assert.deepEqual(rowsOf(out), [
    row(0, "", "1", [], [], true),
    row(1, "1", "111", [], [2], true),
    row(1, "111", "111", [], [], true),
    row(2, "111", "11", [], [], false),
    row(0, "11", "", [1], [], false),
  ]);
  assert.equal(out.width, 3);
});

test("AC22: an octopus with 3 parents gives each parent after the first a lane and one edge, in parent order", () => {
  const out = layoutLanes(commitsOf(`
    m  <- p1 p2 p3 | octopus
    p1 <-          | root
    p2 <-          | root
    p3 <-          | root
  `));
  assert.deepEqual(rowsOf(out), [
    row(0, "", "111", [], [1, 2], true),
    row(0, "111", ".11", [], [], false),
    row(1, ".11", "..1", [], [], false),
    row(2, "..1", "", [], [], false),
  ]);
  assert.equal(out.width, 3);
});

test("AC23: a root commit has no line below its node", () => {
  const out = layoutLanes(commitsOf("r <- | the only commit"));
  assert.deepEqual(rowsOf(out), [row(0, "", "", [], [], false)]);
  assert.deepEqual(out.open, []);
});

test("AC23: two unrelated roots each end at their node and free their lane", () => {
  const out = layoutLanes(commitsOf(`
    a2 <- a1 | main tip
    b2 <- b1 | orphan tip
    a1 <-    | main root
    b1 <-    | orphan root
  `));
  assert.deepEqual(rowsOf(out), [
    row(0, "", "1", [], [], true),
    row(1, "1", "11", [], [], true),
    row(0, "11", ".1", [], [], false),
    row(1, ".1", "", [], [], false),
  ]);
});

test("AC24: a new lane reuses the leftmost free lane, not a later free one", () => {
  const out = layoutLanes(commitsOf(`
    t0 <- z | tip 0
    t1 <- a | tip 1
    t2 <- w | tip 2
    t3 <- b | tip 3
    z  <-   | frees lane 0
    w  <-   | frees lane 2
    n  <- a | takes lane 0
    a  <- b | joins lane 1
    b  <-   | root
  `));
  assert.deepEqual(rowsOf(out), [
    row(0, "", "1", [], [], true),
    row(1, "1", "11", [], [], true),
    row(2, "11", "111", [], [], true),
    row(3, "111", "1111", [], [], true),
    row(0, "1111", ".111", [], [], false),
    row(2, ".111", ".1.1", [], [], false),
    row(0, ".1.1", "11.1", [], [], true),
    row(0, "11.1", "1..1", [1], [], true),
    row(0, "1..1", "", [3], [], false),
  ]);
  assert.equal(out.width, 4);
});

test("AC24: free lanes at the right end are dropped, a free lane in the middle stays, and the next new lane follows the trim", () => {
  const out = layoutLanes(commitsOf(`
    x <- a | tip 0
    y <- b | tip 1
    z <- c | tip 2
    b <-   | frees lane 1 (middle)
    c <-   | frees lane 2: lanes 1 and 2 are dropped
    w <- a | a new lane right after lane 0
    a <-   | root
  `));
  assert.deepEqual(rowsOf(out), [
    row(0, "", "1", [], [], true),
    row(1, "1", "11", [], [], true),
    row(2, "11", "111", [], [], true),
    row(1, "111", "1.1", [], [], false),
    row(2, "1.1", "1", [], [], false),
    row(1, "1", "11", [], [], true),
    row(0, "11", "", [1], [], false),
  ]);
});

// A history with a merge, a fork and an unrelated branch, used for every cut below.
const MIXED = `
  m <- a b | merge
  a <- c   | first parent
  x <- y   | unrelated tip
  b <- c   | second parent
  y <-     | unrelated root
  c <- d   | shared parent
  d <-     | root
`;

test("AC25: a history cut after N rows has the first N rows of the full history, for every N", () => {
  const all = commitsOf(MIXED);
  const full = rowsOf(layoutLanes(all));
  for (let n = 1; n <= all.length; n++) assert.deepEqual(rowsOf(layoutLanes(all.slice(0, n))), full.slice(0, n), `cut after ${n}`);
});

test("AC25: open names the lanes still waiting after the last row; they run to the bottom edge and continue after Load more", () => {
  const all = commitsOf(MIXED);
  const cut = layoutLanes(all.slice(0, 3));
  assert.deepEqual(cut.open, ["c", "b", "y"]);
  assert.deepEqual(cut.rows[2].after, bits("111"));
  const full = layoutLanes(all);
  // b was waited for in lane 1 at the cut; after Load more its row sits in lane 1, with the line coming in from above.
  assert.equal(full.rows[3].col, 1);
  assert.equal(full.rows[3].before[1], true);
  assert.deepEqual(full.open, []);
});

test("AC25: a 300-commit page with a lane open to an unloaded parent keeps rows 1-300 the same after Load more to 600", () => {
  // m0 <- m1 <- ... <- m599 (root), plus a side tip s at row 1 whose parent m450 is on the second page.
  const all = [{ hash: "m0", parents: ["m1"] }, { hash: "s", parents: ["m450"] }];
  for (let k = 1; k < 600; k++) all.push({ hash: `m${k}`, parents: k < 599 ? [`m${k + 1}`] : [] });
  const page = layoutLanes(all.slice(0, 300));
  const more = layoutLanes(all);
  assert.deepEqual(page.open, ["m299", "m450"]);
  assert.deepEqual(page.rows[299].after, [true, true]);
  assert.deepEqual(rowsOf(more).slice(0, 300), rowsOf(page));
  // m450 is row 451: the open lane 1 bends into its node in column 0.
  assert.deepEqual(shape(more.rows[451]), row(0, "11", "1", [1], [], true));
  assert.equal(more.width, 2);
});

test("AC26: laneGeometry keeps a 16 px pitch up to 6 lanes, then shrinks the pitch to fit 108 px and draws plain dots", () => {
  assert.deepEqual(laneGeometry(1), { pitch: 16, cell: 28, dots: false });
  assert.deepEqual(laneGeometry(6), { pitch: 16, cell: 108, dots: false });
  assert.deepEqual(laneGeometry(7), { pitch: 96 / 7, cell: 108, dots: true });
  assert.deepEqual(laneGeometry(12), { pitch: 8, cell: 108, dots: true });
});

test("AC26: an octopus that needs 7 lanes gives a width of 7 and the plain-dot geometry", () => {
  const out = layoutLanes(commitsOf(`
    m  <- p1 p2 p3 p4 p5 p6 p7 | octopus of 7
    p1 <- | root
    p2 <- | root
    p3 <- | root
    p4 <- | root
    p5 <- | root
    p6 <- | root
    p7 <- | root
  `));
  assert.equal(out.width, 7);
  assert.equal(laneGeometry(out.width).dots, true);
});

test("AC26: laneX is the lane center: 6 + lane * pitch + pitch / 2", () => {
  assert.equal(laneX(0, { pitch: 16, cell: 60, dots: false }), 14);
  assert.equal(laneX(2, { pitch: 16, cell: 60, dots: false }), 46);
  assert.equal(laneX(3, { pitch: 8, cell: 108, dots: true }), 34);
});

// The segments of one entry as a sorted list: a line as its two end points (top first), a curve as start and end.
function piecesOf(ops) {
  const pieces = [];
  for (const op of ops) {
    if (op[0] === "M") pieces.push([op]);
    else pieces[pieces.length - 1].push(op);
  }
  return pieces.map((p) => {
    const tail = p.slice(1);
    const from = [p[0][1], p[0][2]];
    const last = tail[tail.length - 1];
    const to = last.slice(-2);
    if (tail.every((op) => op[0] === "L") && tail.length === 1) return { kind: "line", ends: [from, to].sort((u, v) => u[1] - v[1]) };
    if (tail.every((op) => op[0] === "Q")) return { kind: "curve", from, to };
    return { kind: "other", ops: p };
  }).sort((u, v) => JSON.stringify(u).localeCompare(JSON.stringify(v)));
}
const segmentsOf = (r, geo) => {
  const entries = laneSegments(r, geo);
  assert.equal(new Set(entries.map((e) => e.lane % 6)).size, entries.length, "one entry per lane color");
  return entries.map((e) => ({ lane: e.lane, pieces: piecesOf(e.ops) })).sort((u, v) => u.lane - v.lane);
};
const GEO3 = { pitch: 16, cell: 60, dots: false };

test("laneSegments: a pass-through lane, the top half of the node's lane and a bend in, each with its own lane", () => {
  // Lane 1 bends into the root node in column 0; lane 2 passes.
  const r = row(0, "111", "..1", [1], [], false);
  assert.deepEqual(segmentsOf(r, GEO3), [
    { lane: 0, pieces: [{ kind: "line", ends: [[14, 0], [14, 12]] }] },
    { lane: 1, pieces: [{ kind: "curve", from: [30, 0], to: [14, 12] }] },
    { lane: 2, pieces: [{ kind: "line", ends: [[46, 0], [46, 24]] }] },
  ]);
});

test("laneSegments: a pass-through lane, the bottom half of a new node's lane and a bend out", () => {
  // A merge opens lane 1 for its node and sends its second parent to a new lane 2; lane 0 passes.
  const r = row(1, "1", "111", [], [2], true);
  assert.deepEqual(segmentsOf(r, GEO3), [
    { lane: 0, pieces: [{ kind: "line", ends: [[14, 0], [14, 24]] }] },
    { lane: 1, pieces: [{ kind: "line", ends: [[30, 12], [30, 24]] }] },
    { lane: 2, pieces: [{ kind: "curve", from: [30, 12], to: [46, 24] }] },
  ]);
});
