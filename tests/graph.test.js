import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { render, resolve } from "../mods/herdsidian/notes.js";
import {
  AREA, INDEX_AWK, MAX_NODES, ZOOM, bucketByBase, buildIndex, chunks, extractLinks, layout, missingRaw, neighborhood,
  LABEL, estimateWidth, fitLabel, placeLabels, parseFrontmatter, parseIndexOutput, resolveIn, sectionMessage, toScreen, updateIndex, zoomAt,
} from "../mods/herdsidian/graph.js";

// The targets render() turns into note: links, read back from its output.
const rendered = (text) => [...render(text).matchAll(/\]\(note:([^)]*)\)/g)].map((m) => decodeURIComponent(m[1]));

// An index built from { path: "note text" }, the way io.js + main.js would.
function indexOf(files) {
  const raw = new Map(Object.entries(files).map(([path, text]) => [path, { targets: extractLinks(text), front: [] }]));
  return buildIndex([...raw.keys()], raw);
}

const sorted = (edges) => [...edges].sort((a, b) => (a.join() < b.join() ? -1 : 1));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---- AC2: link extraction

test("extractLinks gives the target of a plain wikilink", () => {
  assert.deepEqual(extractLinks("see [[A]] now"), ["A"]);
  assert.deepEqual(rendered("see [[A]] now"), ["A"]);
});

test("extractLinks gives the target of an aliased wikilink", () => {
  assert.deepEqual(extractLinks("[[A|x]]"), ["A"]);
  assert.deepEqual(rendered("[[A|x]]"), ["A"]);
});

test("extractLinks drops the heading of a wikilink", () => {
  assert.deepEqual(extractLinks("[[A#h]]"), ["A"]);
  assert.deepEqual(rendered("[[A#h]]"), ["A"]);
});

test("extractLinks follows a note embed", () => {
  assert.deepEqual(extractLinks("![[A]]"), ["A"]);
  assert.deepEqual(rendered("![[A]]"), ["A"]);
});

test("extractLinks ignores an embedded file that is not a note", () => {
  assert.deepEqual(extractLinks("![[shot.png]]"), []);
  assert.deepEqual(rendered("![[shot.png]]"), []);
});

test("extractLinks keeps an embedded .md as a note target", () => {
  assert.deepEqual(extractLinks("![[a.md]]"), ["a.md"]);
  assert.deepEqual(rendered("![[a.md]]"), ["a.md"]);
});

test("extractLinks trims targets and keeps order and duplicates", () => {
  assert.deepEqual(extractLinks("[[ B ]] [[A]] [[B]]"), ["B", "A", "B"]);
});

const FENCED = "[[Out1]]\n```js\n[[In1]]\n```\n[[Out2]]\n~~~\n[[In2]]\n~~~\n[[Out3]]\n";
const INLINE = "a [[Out1]] `[[In1]]` b ``[[In2]] ` [[In3]]`` c [[Out2]]\n";

test("extractLinks skips wikilinks inside fenced blocks and inline code", () => {
  assert.deepEqual(extractLinks(FENCED), ["Out1", "Out2", "Out3"]);
  assert.deepEqual(extractLinks(INLINE), ["Out1", "Out2"]);
  assert.deepEqual(extractLinks("`[[A]]` and an unclosed ` tick [[B]]"), ["B"]);
});

test("extractLinks and render agree on every link, inside code or not", () => {
  for (const text of [FENCED, INLINE, "[[A|x]] ![[b.png]] ![[C]] [[D#h]]", "````\n```\n[[In]]\n````\n[[Out]]"]) {
    assert.deepEqual(extractLinks(text), rendered(text));
  }
});

test("graph.js reads wikilinks with the pattern and embed test of notes.js, not its own copy", () => {
  const source = readFileSync(new URL("../mods/herdsidian/graph.js", import.meta.url), "utf8");
  assert.equal(source.includes("\\[\\["), false);
  assert.match(source, /WIKILINK/);
  assert.match(source, /isFileEmbed/);
});

// ---- AC39: chunks

test("chunks splits 2,500 paths into 3 chunks of at most 1,000", () => {
  const paths = Array.from({ length: 2500 }, (_, i) => `n${i}.md`);
  const parts = chunks(paths, 1000);
  assert.deepEqual(parts.map((part) => part.length), [1000, 1000, 500]);
  assert.deepEqual(parts.flat(), paths);
  assert.deepEqual(chunks([]), []);
});

// ---- INDEX_AWK on a real vault

const vault = mkdtempSync(join(tmpdir(), "herdsidian-graph-"));
after(() => rmSync(vault, { recursive: true, force: true }));
mkdirSync(join(vault, "sub"));
writeFileSync(join(vault, "a.md"), "# A\nSee [[B]] and ![[img.png]] and ![[D.md]].\n");
writeFileSync(join(vault, "b.md"), '---\naliases: [bee]\nrelated: "[[A]]"\n---\nBody [[C|x]] [[C#h]]\n');
writeFileSync(join(vault, "sub", "c.md"), "---\r\ntags:\r\n- t1\r\n---\r\nBack to [[A]]\r\n");
writeFileSync(join(vault, "d.md"), "# D\n---\nnot: frontmatter [[Z1]]\n---\nafter [[A]]\n");
writeFileSync(join(vault, "my note.md"), "---\nno end [[Z2]]\n");

function runAwk(files) {
  const run = spawnSync("awk", [INDEX_AWK, ...files], { cwd: vault, encoding: "utf8" });
  return { run, files: parseIndexOutput(run.stdout) };
}

test("INDEX_AWK finds targets in the body and in the frontmatter", () => {
  const { run, files } = runAwk(["a.md", "b.md"]);
  assert.equal(run.status, 0);
  assert.deepEqual(files.get("a.md").targets, ["B", "D.md"]);
  assert.deepEqual(files.get("b.md").targets, ["A", "C", "C"]);
});

test("INDEX_AWK reports frontmatter lines only from the leading --- block", () => {
  const { files } = runAwk(["b.md", "d.md", "my note.md"]);
  assert.deepEqual(files.get("b.md").front, ["aliases: [bee]", 'related: "[[A]]"']);
  assert.deepEqual(files.get("d.md").front, []);
  assert.deepEqual(files.get("d.md").targets, ["Z1", "A"]);
  assert.deepEqual(files.get("my note.md").front, []);
  assert.deepEqual(files.get("my note.md").targets, ["Z2"]);
});

test("INDEX_AWK reads CRLF notes without carriage returns", () => {
  const { run, files } = runAwk(["sub/c.md"]);
  assert.equal(run.stdout.includes("\r"), false);
  assert.deepEqual(files.get("sub/c.md").front, ["tags:", "- t1"]);
  assert.deepEqual(files.get("sub/c.md").targets, ["A"]);
});

test("INDEX_AWK skips wikilinks inside fenced blocks and inline code", () => {
  writeFileSync(join(vault, "fenced.md"), FENCED);
  writeFileSync(join(vault, "inline.md"), INLINE);
  writeFileSync(join(vault, "tricky.md"), "````\n```\n[[In]]\n````\n[[Out]]\n  ```\n[[In2]]\n  ```\n`[[In3]]`\n");
  const { run, files } = runAwk(["fenced.md", "inline.md", "tricky.md"]);
  assert.equal(run.status, 0);
  assert.deepEqual(files.get("fenced.md").targets, ["Out1", "Out2", "Out3"]);
  assert.deepEqual(files.get("inline.md").targets, ["Out1", "Out2"]);
  assert.deepEqual(files.get("tricky.md").targets, ["Out"]);
});

// Fixtures where code and links meet; extractLinks and INDEX_AWK must read each the same way.
const CODE_CORPUS = {
  "m1.md": "```npm i``` first.\nSee [[Setup]]\n",
  "m1b.md": "``` `x`\n[[InFence]]\n```\n[[AfterFence]]\n",
  "m1c.md": "~~~ `x`\n[[InTilde]]\n~~~\n[[AfterTilde]]\n",
  "m2.md": "```\n[[In1]]\n```~~\n[[In2]]\n```\n[[Out]]\n",
  "alias.md": "See [[Note|alias `c` x]] now [[Kept]]\n",
  "lone.md": "a ` [[B]] and ``[[C]]`` [[D]]\n",
  "plain.md": "[[A|x]] ![[b.png]] ![[C]] [[D#h]]\n",
};

test("INDEX_AWK reads a line that starts with an inline code span as prose, not a fence", () => {
  writeFileSync(join(vault, "m1.md"), CODE_CORPUS["m1.md"]);
  const { files } = runAwk(["m1.md"]);
  assert.deepEqual(files.get("m1.md").targets, ["Setup"]);
  assert.deepEqual(extractLinks(CODE_CORPUS["m1.md"]), ["Setup"]);
});

test("INDEX_AWK does not close a fence with a line that mixes backticks and tildes", () => {
  writeFileSync(join(vault, "m2.md"), CODE_CORPUS["m2.md"]);
  const { files } = runAwk(["m2.md"]);
  assert.deepEqual(files.get("m2.md").targets, ["Out"]);
  assert.deepEqual(extractLinks(CODE_CORPUS["m2.md"]), ["Out"]);
});

test("INDEX_AWK lets a code span inside a link split it, as render does", () => {
  writeFileSync(join(vault, "alias.md"), CODE_CORPUS["alias.md"]);
  const { files } = runAwk(["alias.md"]);
  assert.deepEqual(files.get("alias.md").targets, ["Kept"]);
  assert.deepEqual(extractLinks(CODE_CORPUS["alias.md"]), ["Kept"]);
});

test("INDEX_AWK and extractLinks give the same links for every code fixture", () => {
  for (const [name, text] of Object.entries(CODE_CORPUS)) writeFileSync(join(vault, name), text);
  const { files } = runAwk(Object.keys(CODE_CORPUS));
  for (const [name, text] of Object.entries(CODE_CORPUS)) {
    assert.deepEqual(files.get(name).targets, extractLinks(text), name);
  }
  for (const text of [FENCED, INLINE]) assert.deepEqual(extractLinks(text), rendered(text));
});

test("INDEX_AWK skips a missing file and still reads the others", () => {
  const { run, files } = runAwk(["a.md", "gone.md", "b.md"]);
  assert.equal(run.status, 0);
  assert.deepEqual([...files.keys()], ["a.md", "b.md"]);
});

test("parseIndexOutput strips CRLF from awk output lines", () => {
  const files = parseIndexOutput("F\tx.md\r\nM\ttags: [a]\r\nL\t[[B]]\r\n");
  assert.deepEqual(files.get("x.md"), { targets: ["B"], front: ["tags: [a]"] });
});

// ---- AC3: resolution

const notes = ["Home.md", "a/Git.md", "b/Git.md", "b/sub/Deep.md", "Projects/Herdr.md"];

test("a link from a/x.md to [[y]] resolves to a/y.md before b/y.md", () => {
  const all = ["b/y.md", "a/y.md", "a/x.md"];
  assert.equal(resolveIn(bucketByBase(all), "a/x.md", "y"), "a/y.md");
  assert.equal(resolveIn(bucketByBase(all), "b/x.md", "y"), "b/y.md");
});

test("resolveIn gives what resolve gives for the notes.test fixture", () => {
  const cases = [
    ["b/Index.md", "Git"], ["a/Index.md", "Git"], ["Home.md", "Projects/Herdr"], ["Home.md", "deep"],
    ["a/Git.md", "home.md"], ["Home.md", "Nope"], ["b/Index.md", "git.md"], ["Home.md", "sub/Deep"], ["Root.md", "Home"],
  ];
  const buckets = bucketByBase(notes);
  for (const [from, target] of cases) assert.equal(resolveIn(buckets, from, target), resolve(notes, from, target));
  assert.equal(resolveIn(bucketByBase([]), "Home.md", "Home"), null);
});

test("resolveIn gives what resolve gives for 200 random pairs", () => {
  let seed = 7;
  const next = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const dirs = ["", "a/", "b/", "b/sub/", "Projects/"];
  const names = ["Git", "git", "Home", "Deep", "Herdr", "Notes", "Idx", "Odd.md"];
  const all = [...new Set(Array.from({ length: 40 }, () => `${dirs[next(5)]}${names[next(8)]}.md`))];
  const targets = [...names, "Nope", "sub/Deep", "Projects/Herdr", "b/Git", "odd.md.md"];
  const buckets = bucketByBase(all);
  const memo = new Map();
  for (let i = 0; i < 200; i++) {
    const from = next(4) === 0 ? "Root.md" : all[next(all.length)];
    let target = targets[next(targets.length)];
    if (next(2)) target = target.toUpperCase();
    if (next(3) === 0) target += ".md";
    assert.equal(resolveIn(buckets, from, target, memo), resolve(all, from, target), `${from} -> ${target}`);
  }
});

// ---- parseFrontmatter

test("parseFrontmatter reads scalars and strips a tag's #", () => {
  assert.deepEqual(parseFrontmatter(["herdsidian: /v/repo", "aliases: Alpha", "tags: #t1"]), {
    aliases: ["Alpha"], tags: ["t1"], herdsidian: ["/v/repo"],
  });
});

test("parseFrontmatter reads inline lists and strips quotes", () => {
  const meta = parseFrontmatter(["aliases: [a, \"b c\", 'd']", "tags: [#x, y]"]);
  assert.deepEqual(meta.aliases, ["a", "b c", "d"]);
  assert.deepEqual(meta.tags, ["x", "y"]);
});

test("parseFrontmatter reads block lists", () => {
  const meta = parseFrontmatter(["tags:", "  - #one", '  - "two"', "aliases:", "- A", "  - B"]);
  assert.deepEqual(meta.tags, ["one", "two"]);
  assert.deepEqual(meta.aliases, ["A", "B"]);
});

test("parseFrontmatter reads the herdsidian key as a string and as a list", () => {
  assert.deepEqual(parseFrontmatter(["herdsidian: ~/repo"]).herdsidian, ["~/repo"]);
  assert.deepEqual(parseFrontmatter(["herdsidian:", "  - ~/a", '  - "/v/b"']).herdsidian, ["~/a", "/v/b"]);
  assert.deepEqual(parseFrontmatter(["herdsidian: [/v/a, /v/b]"]).herdsidian, ["/v/a", "/v/b"]);
});

test("parseFrontmatter ignores other keys and their lists", () => {
  const meta = parseFrontmatter(["title: T", "cssclass:", "  - skip", "tags: [z]", "date: 2026-10-31"]);
  assert.deepEqual(meta, { aliases: [], tags: ["z"], herdsidian: [] });
});

// ---- buildIndex and AC4: neighborhood

const six = {
  "C.md": "[[Out]] [[Out]] [[C]]",
  "Out.md": "[[Far]]",
  "Back.md": "[[C]]",
  "Far.md": "",
  "Far2.md": "[[Back]]",
  "Unrelated.md": "[[Unrelated]]",
};

test("buildIndex drops self-links and duplicates and derives backlinks", () => {
  const index = indexOf(six);
  assert.deepEqual(index.out.get("C.md"), ["Out.md"]);
  assert.deepEqual(index.back.get("C.md"), ["Back.md"]);
  assert.equal(index.links, 4);
  assert.equal(index.degree.get("C.md"), 2);
});

test("buildIndex counts a mutual link as one edge", () => {
  const index = indexOf({ "A.md": "[[B]]", "B.md": "[[A]]" });
  assert.equal(index.links, 1);
  assert.equal(index.degree.get("A.md"), 1);
});

test("neighborhood with 2 hops holds outgoing, backlink and 2-hop notes only", () => {
  const graph = neighborhood(indexOf(six), "C.md", 2);
  assert.deepEqual(graph.nodes.map((n) => [n.path, n.hop]).sort(), [
    ["Back.md", 1], ["C.md", 0], ["Far.md", 2], ["Far2.md", 2], ["Out.md", 1],
  ]);
  assert.deepEqual(sorted(graph.edges), [["Back.md", "C.md"], ["Back.md", "Far2.md"], ["C.md", "Out.md"], ["Far.md", "Out.md"]]);
  assert.equal(graph.omitted, 0);
});

test("neighborhood with 1 hop leaves the 2-hop notes out", () => {
  const graph = neighborhood(indexOf(six), "C.md", 1);
  assert.deepEqual(graph.nodes.map((n) => n.path), ["C.md", "Back.md", "Out.md"]);
  assert.deepEqual(sorted(graph.edges), [["Back.md", "C.md"], ["C.md", "Out.md"]]);
});

test("neighborhood of a note with no links is the note alone", () => {
  const graph = neighborhood(indexOf(six), "Unrelated.md", 2);
  assert.deepEqual(graph, { nodes: [{ path: "Unrelated.md", hop: 0, degree: 0 }], edges: [], omitted: 0 });
  assert.deepEqual(neighborhood(indexOf(six), null, 2), { nodes: [], edges: [], omitted: 0 });
});

// ---- AC5: node cap

const pad = (i) => String(i).padStart(2, "0");

test("neighborhood keeps 40 of 60 nodes and reports the 20 left out", () => {
  const files = { "C.md": Array.from({ length: 30 }, (_, i) => `[[H${pad(i)}]]`).join(" ") };
  for (let i = 0; i < 30; i++) files[`H${pad(i)}.md`] = i < 29 ? `[[X${pad(i)}]]` : "";
  for (let i = 0; i < 29; i++) files[`X${pad(i)}.md`] = "";
  const graph = neighborhood(indexOf(files), "C.md", 2);
  assert.equal(Object.keys(files).length, 60);
  assert.equal(graph.nodes.length, MAX_NODES);
  assert.equal(graph.omitted, 20);
  assert.equal(graph.nodes[0].path, "C.md");
  assert.equal(graph.nodes.filter((n) => n.hop === 1).length, 30);
  assert.equal(graph.nodes.filter((n) => n.hop === 2).length, 9);
});

test("neighborhood keeps no hop-2 node while a hop-1 node is dropped", () => {
  const files = { "C.md": Array.from({ length: 50 }, (_, i) => `[[H${pad(i)}]]`).join(" ") };
  for (let i = 0; i < 50; i++) files[`H${pad(i)}.md`] = "";
  files["H10.md"] = "[[X0]] [[X1]] [[X2]]";
  files["H11.md"] = "[[X3]]";
  for (let i = 0; i < 4; i++) files[`X${i}.md`] = "";
  const graph = neighborhood(indexOf(files), "C.md", 2);
  assert.equal(graph.nodes.length, 40);
  assert.equal(graph.nodes.some((n) => n.hop === 2), false);
  assert.equal(graph.omitted, 55 - 40);
  const rest = Array.from({ length: 50 }, (_, i) => `H${pad(i)}.md`).filter((p) => p !== "H10.md" && p !== "H11.md");
  assert.deepEqual(graph.nodes.map((n) => n.path), ["C.md", "H10.md", "H11.md", ...rest].slice(0, 40));
});

test("neighborhood keeps edges only between kept nodes", () => {
  const graph = hubGraph(30, 29);
  const kept = new Set(graph.nodes.map((n) => n.path));
  assert.equal(kept.size, 40);
  assert.equal(kept.has("X28.md"), false);
  for (const [a, b] of graph.edges) {
    assert.ok(kept.has(a) && kept.has(b), `${a} ${b}`);
    assert.ok(a < b);
  }
  assert.equal(graph.edges.length, 30 + 9);
});

// ---- AC6: layout

function hubGraph(hop1, hop2) {
  const files = { "C.md": Array.from({ length: hop1 }, (_, i) => `[[H${pad(i)}]]`).join(" ") };
  for (let i = 0; i < hop1; i++) files[`H${pad(i)}.md`] = "";
  for (let i = 0; i < hop2; i++) {
    files[`H${pad(i % hop1)}.md`] += `[[X${pad(i)}]]`;
    files[`X${pad(i)}.md`] = "";
  }
  return neighborhood(indexOf(files), "C.md", 2);
}

test("layout gives the same positions on two runs", () => {
  const graph = hubGraph(25, 14);
  assert.deepEqual(layout(graph), layout(graph));
  assert.deepEqual(layout(hubGraph(25, 14)), layout(graph));
});

test("layout puts the center in the middle of the area", () => {
  assert.deepEqual(layout(hubGraph(5, 3)).get("C.md"), { x: 170, y: 100 });
  assert.deepEqual(layout(hubGraph(5, 3), { width: 100, height: 60 }).get("C.md"), { x: 50, y: 30 });
});

test("layout keeps any two of 40 nodes at least 24 px apart", () => {
  for (const [hop1, hop2] of [[30, 9], [39, 0], [10, 29], [1, 38], [20, 19]]) {
    const graph = hubGraph(hop1, hop2);
    assert.equal(graph.nodes.length, 40);
    const points = [...layout(graph).values()];
    assert.equal(points.length, 40);
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) assert.ok(dist(points[i], points[j]) >= 24, `${hop1}/${hop2}: ${i} ${j}`);
    }
  }
});

test("layout keeps every node inside the area for the three main rings", () => {
  for (const [hop1, hop2] of [[1, 0], [6, 0], [8, 8], [12, 12], [20, 10], [20, 19], [30, 9]]) {
    for (const { x, y } of layout(hubGraph(hop1, hop2)).values()) {
      assert.ok(x >= 0 && x <= AREA.width && y >= 0 && y <= AREA.height, `${hop1}/${hop2}: ${x},${y}`);
    }
  }
});

test("layout puts hop-2 nodes on rings beyond hop 1 when there is room", () => {
  const positions = layout(hubGraph(6, 6));
  const radius = (path) => Math.hypot((positions.get(path).x - 170) / 1.6, positions.get(path).y - 100);
  assert.ok(radius("X00.md") > radius("H05.md"));
});

test("layout of an empty graph is empty", () => {
  assert.equal(layout({ nodes: [], edges: [], omitted: 0 }).size, 0);
});

test("layout grows the rings so the outermost used one nears the area's edges", () => {
  const points = [...layout(hubGraph(12, 0)).values()];
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  // The outer ring is 54 px tall at scale 1; it must reach well past that.
  assert.ok(Math.max(...points.map((p) => Math.hypot((p.x - 170) / 1.6, p.y - 100))) >= 70, "outer ring grown");
  assert.ok(Math.min(...xs) >= 0 && Math.max(...xs) <= AREA.width && Math.min(...ys) >= 0 && Math.max(...ys) <= AREA.height);
});

// ---- labels

// A hub on the layout, as graphModel builds it: screen nodes with kind, linked, degree and hovered.
function labelNodes(hop1, hop2, extra = () => ({})) {
  const graph = hubGraph(hop1, hop2);
  const positions = layout(graph);
  return graph.nodes.map((n) => ({
    path: n.path, label: n.path.replace(/\.md$/, "") + " a long note name", ...positions.get(n.path), size: n.hop === 0 ? 14 : n.hop === 1 ? 10 : 8,
    kind: n.hop === 0 ? "center" : n.hop === 1 ? "near" : "far", linked: false, degree: n.degree, hovered: false, ...extra(n),
  }));
}
const boxesOverlap = (a, b) => a.left < b.left + b.w && b.left < a.left + a.w && a.top < b.top + b.h && b.top < a.top + a.h;

test("placeLabels returns no two overlapping boxes", () => {
  for (const [hop1, hop2] of [[12, 0], [20, 10], [30, 9]]) {
    const boxes = placeLabels(labelNodes(hop1, hop2), estimateWidth, AREA);
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!boxesOverlap(boxes[i], boxes[j]), `${hop1}/${hop2}: ${boxes[i].path} ${boxes[j].path}`);
  }
});

test("placeLabels always keeps the center label", () => {
  for (const [hop1, hop2] of [[0, 0], [12, 0], [30, 9]]) {
    const boxes = placeLabels(labelNodes(hop1 || 1, hop2), estimateWidth, AREA);
    assert.ok(boxes.some((b) => b.path === "C.md"));
  }
});

test("placeLabels keeps every box inside the area", () => {
  const small = { width: 200, height: 120 };
  for (const area of [AREA, small]) {
    for (const b of placeLabels(labelNodes(12, 6), estimateWidth, area)) {
      assert.ok(b.left >= 0 && b.top >= 0 && b.left + b.w <= area.width && b.top + b.h <= area.height, `${b.path} ${b.left},${b.top}`);
    }
  }
});

test("placeLabels serves linked, then hovered, then hop 1 by degree, then hop 2", () => {
  // Two nodes at the same spot: only the higher priority one can keep its label.
  const at = { x: 20, y: 10, size: 10, label: "Same", linked: false, hovered: false, degree: 1, kind: "near" };
  const tight = { width: 40, height: 40 };
  const winner = (a, b) => placeLabels([{ ...at, path: "a", ...a }, { ...at, path: "b", ...b }], estimateWidth, tight)
    .filter((l) => l.path === "a" || l.path === "b").map((l) => l.path);
  assert.deepEqual(winner({ linked: true }, { hovered: true }), ["a"]);
  assert.deepEqual(winner({ hovered: false }, { hovered: true }), ["b"]);
  assert.deepEqual(winner({ degree: 1 }, { degree: 5 }), ["b"]);
  assert.deepEqual(winner({ kind: "far" }, { kind: "near" }), ["b"]);
  const placed = placeLabels([{ ...at, path: "far", kind: "far" }, { ...at, path: "c", kind: "center", x: 20, y: 10 }], estimateWidth, tight);
  assert.equal(placed[0].path, "c");
});

test("placeLabels puts a label below its node, or beside it when below is taken", () => {
  const node = { size: 10, label: "Note", linked: false, hovered: false, degree: 0, kind: "near" };
  const [only] = placeLabels([{ ...node, path: "a", x: 100, y: 50 }], estimateWidth, AREA);
  assert.equal(only.side, "below");
  assert.ok(only.top >= 55);
  const boxes = placeLabels([{ ...node, path: "a", x: 100, y: 50, linked: true }, { ...node, path: "b", x: 100, y: 52 }], estimateWidth, AREA);
  assert.ok(boxes.every((b) => b.path !== "b" || b.side !== "below"));
});

test("fitLabel cuts a long label with an ellipsis to at most 90 px", () => {
  const text = fitLabel("A very long note title that cannot fit");
  assert.ok(text.endsWith("…"));
  assert.ok(estimateWidth(text) <= LABEL.maxWidth);
  assert.equal(fitLabel("Short"), "Short");
});

// ---- toScreen and zoomAt

const still = { panX: 0, panY: 0, zoom: 1 };
const size = { width: 340, height: 200 };

test("toScreen maps the area onto itself at zoom 1 with no pan", () => {
  const { nodes } = toScreen(new Map([["a", { x: 170, y: 100 }], ["b", { x: 10, y: 20 }]]), [], still, size);
  assert.deepEqual(nodes.get("a"), { x: 170, y: 100, inside: true });
  assert.deepEqual(nodes.get("b"), { x: 10, y: 20, inside: true });
});

test("toScreen pans and zooms around the middle of the area", () => {
  const positions = new Map([["a", { x: 170, y: 100 }], ["b", { x: 200, y: 110 }]]);
  const panned = toScreen(positions, [], { panX: 15, panY: -5, zoom: 1 }, size).nodes;
  assert.deepEqual([panned.get("b").x, panned.get("b").y], [215, 105]);
  const zoomed = toScreen(positions, [], { panX: 0, panY: 0, zoom: 2 }, size).nodes;
  assert.deepEqual([zoomed.get("a").x, zoomed.get("a").y], [170, 100]);
  assert.deepEqual([zoomed.get("b").x, zoomed.get("b").y], [230, 120]);
  const wide = toScreen(positions, [], still, { width: 400, height: 300 }).nodes;
  assert.deepEqual([wide.get("a").x, wide.get("a").y], [200, 150]);
});

test("toScreen clips a segment that leaves the area to the area", () => {
  const positions = new Map([["a", { x: 170, y: 100 }], ["b", { x: 400, y: 100 }]]);
  const { nodes, segments } = toScreen(positions, [["a", "b"]], still, size);
  assert.equal(nodes.get("b").inside, false);
  assert.deepEqual(segments, [{ a: "a", b: "b", x1: 170, y1: 100, x2: 340, y2: 100 }]);
});

test("toScreen clips a diagonal segment at both borders", () => {
  const positions = new Map([["a", { x: -100, y: -100 }], ["b", { x: 440, y: 300 }]]);
  const [segment] = toScreen(positions, [["a", "b"]], still, size).segments;
  for (const [x, y] of [[segment.x1, segment.y1], [segment.x2, segment.y2]]) {
    assert.ok(x >= -1e-9 && x <= 340 + 1e-9 && y >= -1e-9 && y <= 200 + 1e-9, `${x},${y}`);
  }
  assert.ok(Math.abs((segment.y2 - segment.y1) / (segment.x2 - segment.x1) - 400 / 540) < 1e-9);
});

test("toScreen drops a segment that is wholly outside the area", () => {
  const positions = new Map([["a", { x: 500, y: 10 }], ["b", { x: 600, y: 90 }]]);
  assert.deepEqual(toScreen(positions, [["a", "b"]], still, size).segments, []);
});

test("zoomAt keeps the zoom between 0.5 and 2", () => {
  let view = still;
  for (let i = 0; i < 40; i++) view = zoomAt(view, { x: 100, y: 50 }, -200, size);
  assert.equal(view.zoom, ZOOM.max);
  for (let i = 0; i < 80; i++) view = zoomAt(view, { x: 100, y: 50 }, 200, size);
  assert.equal(view.zoom, ZOOM.min);
});

test("zoomAt zooms in on a scroll up and out on a scroll down", () => {
  assert.ok(zoomAt(still, { x: 170, y: 100 }, -40, size).zoom > 1);
  assert.ok(zoomAt(still, { x: 170, y: 100 }, 40, size).zoom < 1);
});

test("zoomAt keeps the point under the pointer fixed", () => {
  const pointer = { x: 80, y: 150 };
  const start = { panX: 12, panY: -7, zoom: 1.3 };
  const spot = (view, area) => ({
    x: (pointer.x - size.width / 2 - view.panX) / view.zoom + area.x,
    y: (pointer.y - size.height / 2 - view.panY) / view.zoom + area.y,
  });
  const next = zoomAt(start, pointer, -90, size);
  const area = { x: 170, y: 100 };
  assert.notEqual(next.zoom, start.zoom);
  assert.ok(dist(spot(start, area), spot(next, area)) < 1e-9);
});

// ---- AC33-38: section message

const linked = indexOf(six);
const alone = { nodes: [{ path: "C.md", hop: 0, degree: 0 }], edges: [], omitted: 0 };
const state = { vault: "/v", indexing: false, error: null, index: linked, center: "C.md", graph: neighborhood(linked, "C.md", 2) };

test("sectionMessage asks for a vault when none is chosen", () => {
  assert.equal(sectionMessage({ ...state, vault: null, index: null }), "Choose a vault to see the graph.");
});

test("sectionMessage says the links are being indexed", () => {
  assert.equal(sectionMessage({ ...state, indexing: true, index: null, graph: null }), "Indexing links…");
});

test("sectionMessage keeps showing the graph while an index refreshes", () => {
  assert.equal(sectionMessage({ ...state, indexing: true }), null);
});

test("sectionMessage says the vault has no wikilinks", () => {
  const bare = indexOf({ "C.md": "text", "D.md": "" });
  assert.equal(sectionMessage({ ...state, index: bare, graph: alone }), "No [[wikilinks]] in this vault yet.");
});

test("sectionMessage asks to open a note when there is no center", () => {
  assert.equal(sectionMessage({ ...state, center: null, graph: null }), "Open a note or link one to this agent.");
});

test("sectionMessage says an orphan note has no links", () => {
  const orphan = neighborhood(linked, "Unrelated.md", 2);
  assert.equal(sectionMessage({ ...state, center: "Unrelated.md", graph: orphan }), "No links to or from this note.");
});

test("sectionMessage gives the error text when indexing failed", () => {
  assert.equal(sectionMessage({ ...state, error: "awk: not found", index: null }), "awk: not found");
});

test("sectionMessage is null when the graph shows", () => {
  assert.equal(sectionMessage(state), null);
});

// ---- updateIndex

test("updateIndex with the same notes re-resolves only the changed notes", () => {
  const files = { "A.md": "[[B]]", "B.md": "[[C]]", "C.md": "" };
  const index = indexOf(files);
  const next = updateIndex(index, [...index.notes], new Map([["A.md", { targets: ["C"], front: ["tags: [t]"] }]]));
  assert.deepEqual(next.out.get("A.md"), ["C.md"]);
  assert.deepEqual(next.back.get("B.md"), []);
  assert.deepEqual(next.back.get("C.md"), ["A.md", "B.md"]);
  assert.deepEqual(next.meta.get("A.md").tags, ["t"]);
  assert.equal(next.out.get("B.md"), index.out.get("B.md"));
  assert.deepEqual(index.out.get("A.md"), ["B.md"]);
});

test("updateIndex re-resolves other notes when a note joins their folder", () => {
  const index = indexOf({ "b/z.md": "[[y]]", "c/y.md": "" });
  assert.deepEqual(index.out.get("b/z.md"), ["c/y.md"]);
  const next = updateIndex(index, ["b/z.md", "c/y.md", "b/y.md"], new Map([["b/y.md", { targets: [], front: [] }]]));
  assert.deepEqual(next.out.get("b/z.md"), ["b/y.md"]);
  assert.deepEqual(next.back.get("c/y.md"), []);
});

test("updateIndex forgets a deleted note and its links", () => {
  const index = indexOf({ "A.md": "[[B]]", "B.md": "[[A]]" });
  const next = updateIndex(index, ["A.md"], new Map());
  assert.deepEqual(next.out.get("A.md"), []);
  assert.deepEqual([...next.raw.keys()], ["A.md"]);
  assert.equal(next.links, 0);
});

test("updateIndex survives the caller changing the array given to buildIndex", () => {
  const all = ["A.md", "B.md"];
  const raw = new Map(all.map((path) => [path, { targets: [], front: [] }]));
  const index = buildIndex(all, raw);
  all.push("Z.md");
  const next = updateIndex(index, all, new Map([["Z.md", { targets: ["A"], front: [] }]]));
  assert.deepEqual(next.notes, ["A.md", "B.md", "Z.md"]);
  assert.deepEqual(next.out.get("Z.md"), ["A.md"]);
  assert.deepEqual(next.back.get("A.md"), ["Z.md"]);
});

test("updateIndex output survives the caller popping or pushing the array afterwards", () => {
  const all = ["A.md", "B.md"];
  const index = buildIndex(all, new Map([["A.md", { targets: ["B"], front: [] }], ["B.md", { targets: [], front: [] }]]));
  const next = updateIndex(index, all, new Map([["A.md", { targets: ["B"], front: [] }]]));
  assert.notEqual(next.notes, all);
  all.pop();
  all.push("X.md", "Y.md");
  assert.deepEqual(next.notes, ["A.md", "B.md"]);
  const again = updateIndex(next, ["A.md", "B.md"], new Map());
  assert.deepEqual(again.out.get("A.md"), ["B.md"]);
});

test("updateIndex rebuilds when a note of `all` is missing from the index, even with the same array", () => {
  const index = indexOf({ "A.md": "" });
  const all = [...index.notes, "B.md"];
  index.notes = all;
  const next = updateIndex(index, all, new Map([["B.md", { targets: ["A"], front: [] }]]));
  assert.deepEqual(next.out.get("B.md"), ["A.md"]);
});

test("missingRaw lists the notes with no raw entry", () => {
  const index = indexOf({ "A.md": "", "old/B.md": "" });
  assert.deepEqual(missingRaw(index, ["A.md", "new/B.md", "C.md"]), ["new/B.md", "C.md"]);
  assert.deepEqual(missingRaw(index, ["A.md"]), []);
});

// ---- AC7: performance

function syntheticOutput(count, perNote) {
  let seed = 11;
  const next = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const all = Array.from({ length: count }, (_, i) => `f${i % 50}/n${i}.md`);
  const lines = [];
  all.forEach((path, i) => {
    lines.push(`F\t${path}`, "M\ttags: [demo]");
    for (let k = 0; k < perNote; k++) lines.push(`L\t[[n${k === 0 && i % 10 === 0 ? 0 : next(count)}]]`);
  });
  return { all, stdout: `${lines.join("\n")}\n` };
}

test("parsing and building an index of 5,000 notes and 50,000 links takes at most 500 ms", () => {
  const { all, stdout } = syntheticOutput(5000, 10);
  const start = performance.now();
  const index = buildIndex(all, parseIndexOutput(stdout));
  const took = performance.now() - start;
  console.log(`# index build: ${took.toFixed(1)} ms`);
  assert.ok(index.links > 30000);
  assert.ok(took <= 500, `${took} ms`);
});

test("neighborhood and layout of a hub take at most 50 ms", () => {
  const { all, stdout } = syntheticOutput(5000, 10);
  const index = buildIndex(all, parseIndexOutput(stdout));
  const hub = "f0/n0.md";
  assert.ok(index.degree.get(hub) > 400);
  const start = performance.now();
  const graph = neighborhood(index, hub, 2);
  const positions = layout(graph);
  const took = performance.now() - start;
  console.log(`# neighborhood + layout: ${took.toFixed(1)} ms`);
  assert.equal(graph.nodes.length, MAX_NODES);
  assert.equal(positions.size, MAX_NODES);
  assert.ok(took <= 50, `${took} ms`);
});
