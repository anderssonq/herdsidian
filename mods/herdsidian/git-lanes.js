// The Git tab's lane layout (Decision 4, AC19 to AC26). Pure. One forward pass over commits in topo order
// gives each row its node column and the lines around it; laneGeometry and laneSegments turn a row into px.

export const GRAPH_ROW = 24, LANE_W = 16, LANE_PAD = 12, MAX_LANES = 6, NODE = 16, NODE_DOT = 8;

const present = (lanes) => lanes.map((hash) => hash !== null);

// The leftmost free lane, else a new lane at the right end.
function freeLane(lanes) {
  const i = lanes.indexOf(null);
  return i === -1 ? lanes.length : i;
}

// commits: [{ hash, parents }] -> { rows: LaneRow[], width, open: (string | null)[] }
//   LaneRow = { col, before, after, ins, outs, down }
export function layoutLanes(commits) {
  const lanes = [];
  const rows = [];
  let width = 0;
  for (const { hash, parents } of commits) {
    const before = present(lanes);
    const mine = [];
    lanes.forEach((waits, i) => { if (waits === hash) mine.push(i); });
    const col = mine.length ? mine[0] : freeLane(lanes);
    const ins = mine.slice(1);
    for (const i of ins) lanes[i] = null;
    lanes[col] = parents.length ? parents[0] : null;
    const outs = [];
    for (const parent of parents.slice(1)) {
      const waiting = lanes.indexOf(parent);
      const lane = waiting === -1 ? freeLane(lanes) : waiting;
      lanes[lane] = parent;
      outs.push(lane);
    }
    // Counted before the trim: a root at a new right-end lane still needs its column.
    width = Math.max(width, lanes.length);
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    rows.push({ col, before, after: present(lanes), ins, outs, down: parents.length > 0 });
  }
  return { rows, width, open: [...lanes] };
}

// Up to 6 lanes keep a 16 px pitch; more lanes share the 108 px cell and nodes become plain dots (Q6).
export const laneGeometry = (width) => width <= MAX_LANES
  ? { pitch: LANE_W, cell: width * LANE_W + LANE_PAD, dots: false }
  : { pitch: (MAX_LANES * LANE_W) / width, cell: MAX_LANES * LANE_W + LANE_PAD, dots: true };

export const laneX = (lane, geo) => LANE_PAD / 2 + lane * geo.pitch + geo.pitch / 2;

// One row's lines in a GRAPH_ROW high cell -> [{ lane, ops }], one entry per lane color (lane mod 6).
// A bend takes the color of the lane it leaves or joins, not the node's column.
export function laneSegments(row, geo) {
  const { col, before, after, ins, outs, down } = row;
  const byColor = new Map();
  const add = (lane, ...ops) => {
    const color = lane % MAX_LANES;
    if (!byColor.has(color)) byColor.set(color, []);
    byColor.get(color).push(...ops);
  };
  const mid = GRAPH_ROW / 2;
  const nx = laneX(col, geo);
  before.forEach((on, i) => {
    if (on && after[i] && i !== col && !ins.includes(i)) add(i, ["M", laneX(i, geo), 0], ["L", laneX(i, geo), GRAPH_ROW]);
  });
  if (before[col]) add(col, ["M", nx, 0], ["L", nx, mid]);
  if (down) add(col, ["M", nx, mid], ["L", nx, GRAPH_ROW]);
  // The control point sits on the outer lane at mid height, so the line leaves or meets that lane straight.
  for (const i of ins) add(i, ["M", laneX(i, geo), 0], ["Q", laneX(i, geo), mid, nx, mid]);
  for (const k of outs) add(k, ["M", nx, mid], ["Q", laneX(k, geo), mid, laneX(k, geo), GRAPH_ROW]);
  return [...byColor].map(([lane, ops]) => ({ lane, ops }));
}
