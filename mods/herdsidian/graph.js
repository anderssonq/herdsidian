// The graph's pure logic, with no Herdr or GPUI imports so it can be tested with node:
// links, the vault index, the neighborhood, the ring layout and the view transform.
import { WIKILINK, base, isFileEmbed, mapProse, resolve } from "./notes.js";

export const MAX_NODES = 40;
const INDEX_CHUNK = 1000;
export const AREA = { width: 340, height: 200 };
export const ZOOM = { min: 0.5, max: 2 };

const MIN_CHORD = 26; // smallest distance between neighbors on a ring
const RINGS = 4; // the 4th ring is only overflow
const SAMPLES = 360;
const LABEL_MARGIN = { x: 48, y: 26 }; // room the outermost ring leaves for a label
const WHEEL_STEP = 0.0025;

// The awk program that narrows the vault to what the graph needs. It works in BEGIN and reads each
// ARGV file with getline, so a file deleted since `find` is skipped instead of aborting the chunk.
// Output: `F<TAB>path` per file, `M<TAB>line` per frontmatter line (only a leading ---  block,
// at most 200 lines), `L<TAB>[[...]]` per wikilink on any line, frontmatter included (A1), except
// inside fenced blocks (three or more backticks or tildes) and inline code spans, like notes.js mapProse.
// The backtick is built with sprintf because this template can't hold one.
// A code span splits the prose around it: a link is never joined across one, as in render().
// Known difference: in unclosed frontmatter (--- with no closing ---) awk reads no fences, while
// notes.js render() does; accepted, it is a malformed note.
export const INDEX_AWK = String.raw`function links(s,   a, rest, b, emb) {
  while ((a = index(s, "[[")) > 0) {
    rest = substr(s, a + 2)
    b = index(rest, "]]")
    if (b == 0) break
    emb = (a > 1 && substr(s, a - 1, 1) == "!") ? "!" : ""
    print "L\t" emb "[[" substr(rest, 1, b - 1) "]]"
    s = substr(rest, b + 2)
  }
}
BEGIN {
  bt = sprintf("%c", 96)
  for (i = 1; i < ARGC; i++) {
    f = ARGV[i]
    fence = ""
    r = (getline line < f)
    if (r < 0) continue
    print "F\t" f
    n = 0
    front = 0
    nf = 0
    while (r > 0) {
      n++
      sub(/\r$/, "", line)
      if (n == 1) {
        if (line == "---") front = 1
      } else if (front == 1) {
        if (line == "---") {
          for (j = 1; j <= nf; j++) print "M\t" buf[j]
          front = 2
        } else if (nf < 200) {
          nf++
          buf[nf] = line
        }
      }
      if (front != 1) {
        ci = 0
        while (substr(line, ci + 1, 1) == " ") ci++
        cc = substr(line, ci + 1, 1)
        ck = 0
        if (ci <= 3 && (cc == bt || cc == "~")) while (substr(line, ci + ck + 1, 1) == cc) ck++
        if (fence == "") {
          if (ck >= 3 && (cc == "~" || index(substr(line, ci + ck + 1), bt) == 0)) { fence = cc; flen = ck; r = (getline line < f); continue }
        } else {
          if (cc == fence && ck >= flen && substr(line, ci + ck + 1) ~ /^[ \t]*$/) fence = ""
          r = (getline line < f)
          continue
        }
      }
      s = ""
      cr = line
      while ((cp = index(cr, bt)) > 0) {
        s = s substr(cr, 1, cp - 1)
        cr = substr(cr, cp)
        ck = 0
        while (substr(cr, ck + 1, 1) == bt) ck++
        ct = substr(cr, ck + 1)
        cf = 0
        while ((cm = index(ct, bt)) > 0) {
          ct = substr(ct, cm)
          cj = 0
          while (substr(ct, cj + 1, 1) == bt) cj++
          ct = substr(ct, cj + 1)
          if (cj == ck) { cf = 1; break }
        }
        if (cf) { links(s); s = ""; cr = ct }
        else { s = s substr(cr, 1, ck); cr = substr(cr, ck + 1) }
      }
      links(s cr)
      r = (getline line < f)
    }
    close(f)
  }
}`;

// Targets render() turns into note: links, trimmed, in order, duplicates kept. Same pattern and
// embed test as notes.js, and code is skipped as there.
export function extractLinks(text) {
  const targets = [];
  mapProse(text, (prose) => {
    for (const [, embed, target] of prose.matchAll(WIKILINK)) {
      const name = target.trim();
      if (!isFileEmbed(embed, name)) targets.push(name);
    }
    return prose;
  });
  return targets;
}

// Split a list of paths into exec-sized chunks.
export function chunks(paths, size = INDEX_CHUNK) {
  const out = [];
  for (let i = 0; i < paths.length; i += size) out.push(paths.slice(i, i + size));
  return out;
}

// awk stdout -> Map<relPath, { targets, front }>, CRLF stripped.
export function parseIndexOutput(stdout) {
  const files = new Map();
  let current = null;
  for (const raw of stdout.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line[1] !== "\t") continue;
    const value = line.slice(2);
    if (line[0] === "F") {
      current = { targets: [], front: [] };
      files.set(value, current);
    } else if (!current) {
      continue;
    } else if (line[0] === "M") {
      current.front.push(value);
    } else if (line[0] === "L") {
      current.targets.push(...extractLinks(value));
    }
  }
  return files;
}

// One frontmatter item without its quotes and, for tags, its leading "#".
function clean(part, key) {
  const text = part.trim().replace(/^(["'])(.*)\1$/, "$2");
  return key === "tags" ? text.replace(/^#/, "") : text;
}

// Items of a frontmatter value: "a", "[a, b]" or "" (a block list follows).
function items(value, key) {
  const text = value.trim();
  const parts = text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1).split(",") : [text];
  return parts.map((part) => clean(part, key)).filter(Boolean);
}

// Minimal YAML for three keys: scalar, [a, b] and block "- a". Quotes and a leading "#" (tags) are stripped.
export function parseFrontmatter(lines) {
  const meta = { aliases: [], tags: [], herdsidian: [] };
  let current = null;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, "");
    const key = line.match(/^([A-Za-z_][\w-]*)\s*:(.*)$/);
    if (key) {
      current = Object.hasOwn(meta, key[1]) ? key[1] : null;
      if (current) meta[current].push(...items(key[2], current));
      continue;
    }
    const item = current && line.match(/^\s*-\s+(.*)$/);
    const value = item ? clean(item[1], current) : "";
    if (value) meta[current].push(value);
  }
  return meta;
}

const ALL = "\u0000all"; // bucket key that holds every note, for the rare targets a base name can't narrow

// Notes grouped by lower-cased base(), order of `all` kept.
export function bucketByBase(all) {
  const buckets = new Map();
  for (const path of all) {
    const key = base(path).toLowerCase();
    const bucket = buckets.get(key);
    if (bucket) bucket.push(path);
    else buckets.set(key, [path]);
  }
  buckets.set(ALL, all);
  return buckets;
}

// resolve() from notes.js over the candidate bucket only; the same result as resolve(all, from, target).
// Every test in resolve() implies equal base names, so the bucket holds all possible answers in order.
export function resolveIn(buckets, from, target, memo = new Map()) {
  const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
  const key = `${dir}\u0000${target}`;
  if (memo.has(key)) return memo.get(key);
  const want = target.toLowerCase().replace(/\.md$/, "");
  const candidates = want.endsWith(".md") ? buckets.get(ALL) : buckets.get(base(want)) ?? [];
  const found = resolve(candidates, from, target);
  memo.set(key, found);
  return found;
}

const EMPTY_META = Object.freeze({ aliases: [], tags: [], herdsidian: [] });

// A note's resolved targets: unique, in order, without a link to itself.
function outgoing(buckets, memo, path, targets) {
  const seen = new Set([path]);
  const out = [];
  for (const target of targets) {
    const found = resolveIn(buckets, path, target, memo);
    if (found && !seen.has(found)) {
      seen.add(found);
      out.push(found);
    }
  }
  return out;
}

// Backlinks, degrees and the edge count from the resolved links.
function assemble(all, raw, out, meta) {
  const back = new Map(all.map((path) => [path, []]));
  for (const path of all) for (const to of out.get(path)) back.get(to).push(path);
  const edges = new Set();
  for (const path of all) for (const to of out.get(path)) edges.add(`${path}\u0000${to}`);
  const degree = new Map();
  let links = 0;
  for (const path of all) {
    const o = out.get(path);
    const b = back.get(path);
    const mutual = o.reduce((count, to) => count + (edges.has(`${to}\u0000${path}`) ? 1 : 0), 0);
    degree.set(path, o.length + b.length - mutual);
    links += o.length - mutual / 2;
  }
  return { notes: all, raw, out, back, meta, degree, links: Math.round(links) };
}

// Full build. raw = the parseIndexOutput result, merged across chunks.
// -> { notes, raw, out, back, meta, degree, links }; out: resolved, unique, no self-link;
//    links: the number of undirected edges.
export function buildIndex(list, raw) {
  const all = [...list]; // our own copy: the caller may change its array later
  const buckets = bucketByBase(all);
  const memo = new Map();
  const out = new Map();
  const meta = new Map();
  for (const path of all) {
    const entry = raw.get(path);
    out.set(path, entry ? outgoing(buckets, memo, path, entry.targets) : []);
    meta.set(path, entry?.front.length ? parseFrontmatter(entry.front) : EMPTY_META);
  }
  return assemble(all, raw, out, meta);
}

const sameNotes = (a, b) => a === b || (a.length === b.length && a.every((path, i) => path === b[i]));

// The notes of `all` the index holds no raw entry for (for example after a folder rename): they need indexing.
export const missingRaw = (index, all) => all.filter((path) => !index.raw.has(path));

// Changed notes only. The same `all`: re-resolve `changed`. A different `all`: a full rebuild, because a
// new or removed note can change how other notes' links resolve. Returns a new index.
export function updateIndex(index, all, rawChanges) {
  const raw = new Map(index.raw);
  for (const [path, entry] of rawChanges) raw.set(path, entry);
  if (!sameNotes(index.notes, all) || all.some((path) => !index.out.has(path))) {
    const live = new Set(all);
    for (const path of raw.keys()) if (!live.has(path)) raw.delete(path);
    return buildIndex(all, raw);
  }
  const buckets = bucketByBase(all);
  const memo = new Map();
  const out = new Map(index.out);
  const meta = new Map(index.meta);
  for (const [path, entry] of rawChanges) {
    if (!out.has(path)) continue;
    out.set(path, outgoing(buckets, memo, path, entry.targets));
    meta.set(path, entry.front.length ? parseFrontmatter(entry.front) : EMPTY_META);
  }
  return assemble([...all], raw, out, meta); // our own copy: the caller may change its array later
}

// A note's neighbors in both directions.
function neighbors(index, path) {
  const out = index.out.get(path) ?? [];
  const back = index.back.get(path) ?? [];
  if (!back.length) return out;
  if (!out.length) return back;
  return [...new Set([...out, ...back])];
}

const byDegree = (index) => (a, b) =>
  (index.degree.get(b) ?? 0) - (index.degree.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0);

// The notes `from` reaches that `seen` does not hold yet.
function collect(index, from, seen) {
  const found = [];
  for (const path of from) {
    for (const next of neighbors(index, path)) {
      if (seen.has(next)) continue;
      seen.add(next);
      found.push(next);
    }
  }
  return found;
}

// Undirected BFS up to `hops` (1|2), at most `cap` nodes with the center; hop 1 before hop 2, and inside
// a hop: more connected first, then by path.
// -> { nodes: [{ path, hop, degree }], edges: [[a, b]], omitted }; edges only between kept nodes, a < b.
export function neighborhood(index, center, hops, cap = MAX_NODES) {
  if (!center) return { nodes: [], edges: [], omitted: 0 };
  const order = byDegree(index);
  const seen = new Set([center]);
  const hop1 = collect(index, [center], seen);
  const hop2 = hops >= 2 ? collect(index, hop1, seen) : [];
  hop1.sort(order);
  hop2.sort(order);
  const degree = (path) => index.degree.get(path) ?? 0;
  const all = [
    { path: center, hop: 0, degree: degree(center) },
    ...hop1.map((path) => ({ path, hop: 1, degree: degree(path) })),
    ...hop2.map((path) => ({ path, hop: 2, degree: degree(path) })),
  ];
  const nodes = all.slice(0, Math.max(1, cap));
  const kept = new Set(nodes.map((node) => node.path));
  const edges = [];
  for (const { path } of nodes) {
    for (const next of neighbors(index, path)) if (kept.has(next) && path < next) edges.push([path, next]);
  }
  return { nodes, edges, omitted: all.length - nodes.length };
}

// Ring k (1-based) as 360 samples of an ellipse with cumulative arc length, starting at the top.
function ringTable(k, scale = 1) {
  const b = (28 + 26 * (k - 1)) * scale;
  const a = 1.6 * b;
  const points = [];
  const length = [0];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = -Math.PI / 2 + (2 * Math.PI * i) / SAMPLES;
    points.push([a * Math.cos(t), b * Math.sin(t)]);
    if (i > 0) length.push(length[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return { points, length, perimeter: length[SAMPLES] };
}

// The point at arc length s along the ring.
function ringPoint(table, s) {
  const at = ((s % table.perimeter) + table.perimeter) % table.perimeter;
  let i = 1;
  while (i < SAMPLES && table.length[i] < at) i++;
  const span = table.length[i] - table.length[i - 1];
  const f = span === 0 ? 0 : (at - table.length[i - 1]) / span;
  const [x1, y1] = table.points[i - 1];
  const [x2, y2] = table.points[i];
  return [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f];
}

// n points at equal arc length; `half` shifts them by half a step.
function ringPoints(table, n, half) {
  const step = table.perimeter / n;
  return Array.from({ length: n }, (_, j) => ringPoint(table, (half ? step / 2 : 0) + j * step));
}

// The most nodes a ring takes while the smallest chord between neighbors stays >= MIN_CHORD.
function capacity(table, half) {
  let best = 1;
  for (let n = 2; n <= Math.floor(table.perimeter / MIN_CHORD) + 1; n++) {
    const points = ringPoints(table, n, half);
    const chord = Math.min(...points.map((p, j) => Math.hypot(p[0] - points[(j + 1) % n][0], p[1] - points[(j + 1) % n][1])));
    if (chord >= MIN_CHORD) best = n;
  }
  return best;
}

// The capacity of each ring at scale 1; it never changes, so it is computed once.
let ringCaps = null;
function capacities() {
  ringCaps ??= Array.from({ length: RINGS }, (_, i) => capacity(ringTable(i + 1), i % 2 === 1));
  return ringCaps;
}

// Hop 1 by (degree desc, path) as given; hop 2 by (its first hop-1 neighbor, path) so it sits near its parent.
function placementOrder(graph) {
  const hop1 = graph.nodes.filter((node) => node.hop === 1).map((node) => node.path);
  const parent = new Map();
  const rank = new Map(hop1.map((path, i) => [path, i]));
  for (const [a, b] of graph.edges) {
    for (const [near, far] of [[a, b], [b, a]]) {
      if (!rank.has(near) || rank.has(far)) continue;
      parent.set(far, Math.min(parent.get(far) ?? Infinity, rank.get(near)));
    }
  }
  const hop2 = graph.nodes.filter((node) => node.hop === 2).map((node) => node.path);
  hop2.sort((a, b) => (parent.get(a) ?? Infinity) - (parent.get(b) ?? Infinity) || (a < b ? -1 : a > b ? 1 : 0));
  return { hop1, hop2 };
}

// Concentric ellipse rings by hop, the center in the middle. Deterministic.
// -> Map<path, { x, y }>, the center first.
export function layout(graph, area = AREA) {
  const positions = new Map();
  const center = graph.nodes.find((node) => node.hop === 0);
  if (!center) return positions;
  const cx = area.width / 2;
  const cy = area.height / 2;
  positions.set(center.path, { x: cx, y: cy });
  const caps = capacities();
  const rings = caps.map(() => []);
  let r = 0;
  const place = (path) => {
    while (r < RINGS - 1 && rings[r].length >= caps[r]) r++;
    rings[r].push(path);
  };
  const { hop1, hop2 } = placementOrder(graph);
  hop1.forEach(place);
  if (hop2.length) {
    const room = caps.slice(r + 1, RINGS - 1).reduce((sum, c) => sum + c, 0);
    if (rings[r].length > 0 && room >= hop2.length) r++;
    hop2.forEach(place);
  }
  // Grow the rings until the outermost used one reaches the area's edges, less room for labels. Never
  // shrink them, so the chord between neighbors stays >= MIN_CHORD.
  const used = rings.reduce((last, paths, i) => (paths.length ? i + 1 : last), 0);
  const outer = 28 + 26 * (used - 1);
  const scale = Math.max(1, Math.min((area.width / 2 - LABEL_MARGIN.x) / (1.6 * outer), (area.height / 2 - LABEL_MARGIN.y) / outer));
  const scaled = caps.map((_, i) => ringTable(i + 1, scale));
  rings.forEach((paths, i) => {
    if (!paths.length) return;
    ringPoints(scaled[i], paths.length, i % 2 === 1).forEach(([x, y], j) => positions.set(paths[j], { x: cx + x, y: cy + y }));
  });
  return positions;
}

// Liang-Barsky: the part of a segment inside [0,w] x [0,h], or null.
function clip(x1, y1, x2, y2, w, h) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [[-dx, x1], [dx, w - x1], [-dy, y1], [dy, h - y1]]) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return null;
      t0 = Math.max(t0, t);
    } else {
      if (t < t0) return null;
      t1 = Math.min(t1, t);
    }
  }
  return { x1: x1 + t0 * dx, y1: y1 + t0 * dy, x2: x1 + t1 * dx, y2: y1 + t1 * dy };
}

// Positions in area space -> px of an area of `size`, with pan and zoom around the area's middle;
// segments are clipped to the area. -> { nodes: Map<path, { x, y, inside }>, segments: [{ a, b, x1, y1, x2, y2 }] }
export function toScreen(positions, edges, view, size) {
  const map = ({ x, y }) => ({
    x: size.width / 2 + (x - AREA.width / 2) * view.zoom + view.panX,
    y: size.height / 2 + (y - AREA.height / 2) * view.zoom + view.panY,
  });
  const nodes = new Map();
  for (const [path, position] of positions) {
    const { x, y } = map(position);
    nodes.set(path, { x, y, inside: x >= 0 && x <= size.width && y >= 0 && y <= size.height });
  }
  const segments = [];
  for (const [a, b] of edges) {
    const from = nodes.get(a);
    const to = nodes.get(b);
    if (!from || !to) continue;
    const part = clip(from.x, from.y, to.x, to.y, size.width, size.height);
    if (part) segments.push({ a, b, ...part });
  }
  return { nodes, segments };
}

// Zoom around the pointer (a point in the area), clamped to ZOOM; the point under it stays fixed.
export function zoomAt(view, point, deltaY, size) {
  const zoom = Math.min(ZOOM.max, Math.max(ZOOM.min, view.zoom * Math.exp(-deltaY * WHEEL_STEP)));
  const k = zoom / view.zoom;
  return {
    panX: point.x - size.width / 2 - (point.x - size.width / 2 - view.panX) * k,
    panY: point.y - size.height / 2 - (point.y - size.height / 2 - view.panY) * k,
    zoom,
  };
}

// The muted one-liner for the section, or null when the graph shows (AC33-38).
// s = { vault, error, index, center, graph }
export function sectionMessage(s) {
  if (!s.vault) return "Choose a vault to see the graph.";
  if (s.error) return s.error;
  if (!s.index) return "Indexing links…";
  if (!s.center) return "Open a note or link one to this agent.";
  if (s.index.links === 0) return "No [[wikilinks]] in this vault yet.";
  if (s.graph && s.graph.nodes.length <= 1) return "No links to or from this note.";
  return null;
}

// ---- Labels

export const LABEL = { size: 10.5, height: 14, maxWidth: 90, pad: 8, gap: 2 };
const CHAR_WIDTH = 0.56; // average glyph width as a fraction of the font size
const BOLD_EXTRA = 1.08;

// The width in px of a label at the label font size, from its character count (no DOM measuring).
export const estimateWidth = (text, bold = false) => Math.ceil(text.length * LABEL.size * CHAR_WIDTH * (bold ? BOLD_EXTRA : 1)) + LABEL.pad;

// The label cut with an ellipsis so its box is at most LABEL.maxWidth wide.
export function fitLabel(text, measure = estimateWidth, bold = false) {
  if (measure(text, bold) <= LABEL.maxWidth) return text;
  let n = text.length;
  while (n > 1 && measure(`${text.slice(0, n)}…`, bold) > LABEL.maxWidth) n--;
  return `${text.slice(0, n).trimEnd()}…`;
}

// Lower rank is placed first: center, linked, hovered, hop 1, hop 2.
function labelRank(n) {
  if (n.kind === "center") return 0;
  if (n.linked) return 1;
  if (n.hovered) return 2;
  return n.kind === "far" ? 4 : 3;
}

const overlaps = (a, b) => a.left < b.left + b.w && b.left < a.left + a.w && a.top < b.top + b.h && b.top < a.top + a.h;

// Which labels to draw, and where. Greedy by priority; a label whose box overlaps one already placed, or a
// node dot, or leaves `area`, is skipped. nodes: [{ path, label, x, y, size, kind, linked, hovered, degree }],
// kind "center" | "near" | "far". measure(text, bold) -> width in px (default: estimateWidth).
// -> [{ path, text, left, top, w, h, side }], side "below" | "right" | "left"; the center always comes back.
export function placeLabels(nodes, measure = estimateWidth, area = AREA) {
  const order = nodes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => labelRank(a.n) - labelRank(b.n) || (b.n.degree ?? 0) - (a.n.degree ?? 0) || a.i - b.i)
    .map(({ n }) => n);
  const dots = nodes.map((n) => ({ path: n.path, left: n.x - n.size / 2, top: n.y - n.size / 2, w: n.size, h: n.size }));
  const placed = [];
  const h = LABEL.height;
  for (const n of order) {
    const bold = n.kind === "center";
    const text = fitLabel(n.label, measure, bold);
    const w = measure(text, bold);
    const below = { left: n.x - w / 2, top: n.y + n.size / 2 + LABEL.gap };
    const spots = [
      ["below", below.left, below.top],
      ["right", n.x + n.size / 2 + LABEL.gap, n.y - h / 2],
      ["left", n.x - n.size / 2 - LABEL.gap - w, n.y - h / 2],
    ];
    const fits = (box) => box.left >= 0 && box.top >= 0 && box.left + w <= area.width && box.top + h <= area.height
      && !placed.some((p) => overlaps(box, p)) && !dots.some((d) => d.path !== n.path && overlaps(box, d));
    let chosen = null;
    for (const [side, left, top] of spots) {
      const box = { path: n.path, text, left, top, w, h, side };
      if (fits(box)) { chosen = box; break; }
    }
    if (!chosen && bold) {
      chosen = { path: n.path, text, left: Math.max(0, Math.min(area.width - w, below.left)), top: Math.max(0, Math.min(area.height - h, below.top)), w, h, side: "below" };
    }
    if (chosen) placed.push(chosen);
  }
  return placed;
}
