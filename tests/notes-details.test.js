// V6: the Graph folds to its header while a note is open (never saved), and Send to agent is the
// primary action of the context strip, with "+ Add note" on the left.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, settle, findById, walk } from "./support/mod-stubs.js";

const stubs = globalThis.__herdsidianStubs;
stubs.herdr.theme = () => new Proxy({}, {
  get: (_t, key) => (key === "then" ? undefined : key === "solid" ? "#111111" : key === "solid_foreground" ? "#eeeeee" : key === "raised" ? "#222222" : key === "foreground" ? "#f0f0f0" : key === "muted" ? "#6a6a6a" : "#808080"),
});

const { default: Notes } = await import("../mods/herdsidian/main.js");
const { graphSection } = await import("../mods/herdsidian/graph-view.js");
const { graphFold, foldClick } = await import("../mods/herdsidian/fold.js");

const VAULT = "/vault/details";
const call = (node, name) => node.calls.find(([n]) => n === name)?.[1];
const texts = (node) => walk(node).flatMap((n) => n.kids.filter((c) => typeof c === "string"));

// ---- the fold rule (pure) ----

test("graphFold: a note open folds the graph; no note, or the person's own hidden choice, does not auto-fold", () => {
  assert.deepEqual(graphFold({ hidden: false, note: "a.md", count: 9 }),
    { folded: true, hideArea: true, hideStrip: false, detail: " · 9 notes · folded while reading" });
  assert.deepEqual(graphFold({ hidden: false, note: null, count: 9 }), { folded: false, hideArea: false, hideStrip: false, detail: null });
  // Hidden by the person: the header only (area and strip), but that is their choice, not the auto-fold.
  assert.deepEqual(graphFold({ hidden: true, note: "a.md", count: 9 }), { folded: false, hideArea: true, hideStrip: true, detail: null });
  assert.deepEqual(graphFold({ hidden: true, note: null, count: 9 }), { folded: false, hideArea: true, hideStrip: true, detail: null });
});

test("graphFold: the detail counts one note, and leaves the count out while unknown", () => {
  assert.equal(graphFold({ hidden: false, note: "a.md", count: 1 }).detail, " · 1 note · folded while reading");
  assert.equal(graphFold({ hidden: false, note: "a.md", count: 0 }).detail, " · folded while reading");
});

test("graphFold: an override for the open note unfolds it; another note folds again", () => {
  assert.equal(graphFold({ hidden: false, note: "a.md", override: "a.md" }).folded, false);
  assert.equal(graphFold({ hidden: false, note: "b.md", override: "a.md" }).folded, true);
});

test("foldClick: auto-folded, a click unfolds for this note and keeps the saved choice", () => {
  assert.deepEqual(foldClick({ hidden: false, note: "a.md", override: null }), { hidden: false, override: "a.md" });
});

test("foldClick: otherwise it flips the explicit choice and drops the override", () => {
  assert.deepEqual(foldClick({ hidden: false, note: null, override: null }), { hidden: true, override: null });
  assert.deepEqual(foldClick({ hidden: true, note: "a.md", override: null }), { hidden: false, override: null });
  // Reading with the override set (unfolded by hand): a click only clears the override, it never writes graph.hidden.
  assert.deepEqual(foldClick({ hidden: false, note: "a.md", override: "a.md" }), { hidden: false, override: null });
});

// ---- the fold in the Notes view ----

beforeEach(() => {
  state.shared = {}; state.runs = []; state.toasts = []; state.commands = []; state.files = {};
  state.layout = { id: "root", children: [] };
  localStorage.removeItem("vault"); localStorage.removeItem("graph.hidden");
});

const mount = async () => {
  localStorage.setItem("vault", VAULT);
  for (const n of ["a.md", "b.md"]) state.files[`${VAULT}/${n}`] = "# T\n";
  const view = new Notes(), cx = fakeCx();
  view.init({}, cx);
  await settle();
  const nodes = ["a.md", "b.md", "c.md"].map((path) => ({ path, hop: path === "a.md" ? 0 : 1, degree: 1 }));
  view.graph = { nodes, edges: [], omitted: 0, positions: new Map(nodes.map((n) => [n.path, { x: 10, y: 10 }])) };
  const section = () => findById(view.render(cx), "graph-section");
  const open = async (note) => { view.open(note, cx); await settle(); };
  return { view, cx, section, open };
};
const area = (section) => walk(section).some((n) => n.nodeId === "graph-area");

test("opening a note folds the Graph to its header; going back restores it", async () => {
  const { view, section, open } = await mount();
  assert.equal(area(section()), true);
  await open("a.md");
  assert.equal(view.note, "a.md");
  assert.equal(area(section()), false);
  // The context strip stays under the folded header: agent line, + Add note, Send to agent.
  assert.equal(walk(section()).some((n) => n.nodeId === "graph-strip"), true);
  assert.ok(findById(section(), "graph-add"));
  assert.ok(findById(section(), "graph-send"));
  assert.ok(texts(section()).includes("Graph"));
  assert.ok(texts(section()).includes(" · 3 notes · folded while reading"));
  assert.equal(findById(section(), "graph-fit"), null); // the area's controls hide with it
  assert.equal(findById(section(), "hops-1"), null);
  view.close();
  assert.equal(area(section()), true);
  assert.ok(!texts(section()).some((s) => s.includes("folded while reading")));
});

test("the auto-fold is never saved: graph.hidden and the explicit setting stay as they were", async () => {
  const { view, section, open } = await mount();
  await open("a.md");
  section();
  assert.equal(view.hidden, false);
  assert.equal(localStorage.getItem("graph.hidden"), null);
  view.close();
  assert.equal(localStorage.getItem("graph.hidden"), null);
});

test("back to the tree restores the person's own choice: hidden stays hidden", async () => {
  const { view, section, open } = await mount();
  findById(view.render(fakeCx()), "graph-toggle").onClick(null, fakeCx());
  assert.equal(localStorage.getItem("graph.hidden"), "1");
  await open("a.md");
  assert.equal(area(section()), false);
  assert.equal(findById(section(), "graph-strip"), null); // explicit hidden: the header only, as before
  assert.ok(!texts(section()).some((s) => s.includes("folded while reading")));
  view.close();
  assert.equal(area(section()), false);
  assert.equal(localStorage.getItem("graph.hidden"), "1");
});

test("clicking the folded header unfolds it for this note only, and saves nothing", async () => {
  const { view, cx, section, open } = await mount();
  await open("a.md");
  findById(view.render(cx), "graph-toggle").onClick(null, cx);
  assert.equal(area(section()), true);
  assert.equal(localStorage.getItem("graph.hidden"), null);
  await open("b.md");
  assert.equal(area(section()), false); // another note: folded again
  await open("a.md");
  view.close();
  await open("a.md");
  assert.equal(area(section()), false); // back to the tree dropped the override
});

// ---- the context strip (graph-view.js) ----

const model = (over = {}) => ({
  hidden: false, folded: false, foldLabel: null, hops: 2, count: 3, omitted: 0, message: null, error: null,
  nodes: [], labels: [], area: { width: 300, height: 200 }, segments: [], hotSegments: [], hover: null,
  agentLabel: "Claude Code · herdsidian", agentOnlyAllowed: true, chips: [], suggestions: [],
  canAddCurrent: true, send: { ok: true, reason: null },
  picking: false, pickState: { focus() {} }, pickHits: [], ...over,
});
const calls = [];
const on = new Proxy({}, { get: (_t, name) => (...args) => calls.push([name, ...args]) });
const theme = () => stubs.herdr.theme();
const strip = (over) => graphSection(theme(), model(over), on);
const send = (over) => findById(strip(over), "graph-send");

test("Send to agent: h 28, control radius, solid background, solid foreground, weight 600", () => {
  const el = send();
  assert.deepEqual(call(el, "h"), [28]);
  assert.deepEqual(call(el, "rounded"), [6]);
  assert.deepEqual(call(el, "bg"), ["#111111"]);
  assert.deepEqual(call(el, "text_color"), ["#eeeeee"]);
  assert.deepEqual(call(el, "font_weight"), [600]);
  assert.ok(texts(el).includes("Send to agent"));
});

test("Send to agent holds a ⌘↵ key cap with a hairline of solid_foreground at 0.25", () => {
  const cap = walk(send()).find((n) => n.kids.includes("⌘↵"));
  assert.ok(cap);
  assert.deepEqual(call(cap, "border_color"), ["#eeeeee40"]);
});

test("Send to agent calls on.send and sits right of + Add note", () => {
  calls.length = 0;
  const tree = strip();
  findById(tree, "graph-send").onClick({}, "cx");
  assert.deepEqual(calls.at(-1), ["send", "cx"]);
  const parent = walk(tree).find((n) => n.kids.includes(findById(tree, "graph-add")));
  assert.ok(parent.kids.includes(findById(tree, "graph-send")));
  assert.ok(parent.kids.indexOf(findById(tree, "graph-add")) < parent.kids.indexOf(findById(tree, "graph-send")));
});

test("+ Add note: raised background, h 28, control radius, opens the picker", () => {
  calls.length = 0;
  const add = findById(strip(), "graph-add");
  assert.deepEqual(call(add, "h"), [28]);
  assert.deepEqual(call(add, "rounded"), [6]);
  assert.deepEqual(call(add, "bg"), ["#222222"]); // t.raised in this theme
  assert.ok(texts(add).includes("+ Add note"));
  add.onClick({}, "cx");
  assert.deepEqual(calls.at(-1), ["pick", "cx"]);
});

test("disabled Send is the muted pill with the reason as tooltip and no click", () => {
  const el = send({ send: { ok: false, reason: "No agent focused" } });
  assert.deepEqual(call(el, "tooltip"), ["No agent focused"]);
  assert.equal(el.onClick, null);
  assert.notDeepEqual(call(el, "bg"), ["#111111"]);
  assert.notDeepEqual(call(el, "text_color"), ["#eeeeee"]);
});

test("Add current note ⌘L is in the picker, not a button of the strip", () => {
  assert.equal(findById(strip(), "graph-add-current"), null);
  calls.length = 0;
  const item = findById(strip({ picking: true }), "graph-add-current");
  assert.ok(item);
  assert.ok(texts(item).includes("Add current note"));
  assert.ok(texts(item).includes("⌘L"));
  item.onClick({}, "cx");
  assert.deepEqual(calls.at(-1), ["addCurrent", "cx"]);
});

test("in the picker, Add current note without an open note is disabled with a tooltip", () => {
  const item = findById(strip({ picking: true, canAddCurrent: false }), "graph-add-current");
  assert.equal(item.onClick, null);
  assert.deepEqual(call(item, "tooltip"), ["Open a note first"]);
});

test("a folded model draws the header (Graph semibold, detail muted) and the strip, but no area", () => {
  const tree = strip({ folded: true, foldDetail: " · 3 notes · folded while reading" });
  const title = walk(tree).find((n) => n.kids.includes("Graph"));
  assert.ok(call(title, "font_semibold"));
  assert.deepEqual(call(title, "text_color"), ["#f0f0f0"]); // t.foreground in this theme
  const detail = walk(tree).find((n) => n.kids.includes(" · 3 notes · folded while reading"));
  assert.deepEqual(call(detail, "text_color"), ["#6a6a6a"]); // t.muted in this theme
  assert.equal(findById(tree, "graph-area"), null);
  assert.ok(findById(tree, "graph-strip"));
  assert.ok(findById(tree, "graph-send"));
  assert.ok(findById(tree, "graph-toggle"));
});
