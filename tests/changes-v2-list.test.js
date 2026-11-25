// The Changes tab, list view (V2). Smoke test of the kit, then the list criteria (AC2 to AC9, AC11, AC15, AC16, AC47).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mount, fakeGit, reset, world, state, findById, walk, texts, has, settle, during } from "./support/changes-kit.js";
import { tokens } from "../mods/herdsidian/tokens.js";

beforeEach(reset);

const REPO = "/work/repo";
const T = { foreground: "#eeeeee", background: "#111111", chrome: "#222222", canvas: "#333333", raised: "#2a2a2a", accent: "#ff00aa",
  muted: "#999999", dim: "#555555", hover: "#444444", blocked: "#ffaa00", ansi1: "#ff0001", ansi2: "#00ff02" };
// The colors that V1's theme lacks: only a test that mounts with them may look at a badge color or a dot.
const FULL = { ...T, ansi3: "#ffff03", ansi4: "#0000ff", working: "#22aa22", idle: "#888888", done: "#2222aa", unknown: "#777777" };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, what) {
  for (let i = 0; i < 200; i++) {
    const value = await check();
    if (value) return value;
    await sleep(15);
  }
  assert.fail(`timed out waiting for ${what}`);
}

// Git's porcelain and numstat text for a list of { xy, path, from, add, del } (add null: binary; no add: untracked).
const porcelain = (entries, branch = "main") => `## ${branch}\0` + entries.map((e) => (e.from ? `${e.xy} ${e.path}\0${e.from}\0` : `${e.xy} ${e.path}\0`)).join("");
const numstat = (entries) => entries.filter((e) => e.xy !== "??").map((e) => {
  const counts = e.add === null ? "-\t-" : `${e.add}\t${e.del}`;
  return e.from ? `${counts}\t\0${e.from}\0${e.path}\0` : `${counts}\t${e.path}\0`;
}).join("");

const SIMPLE = [
  { xy: " M", path: "a.txt", add: 1, del: 0 },
  { xy: " M", path: "sub/inner.txt", add: 2, del: 1 },
  { xy: "??", path: "fresh.txt" },
];
const MIXED = [
  { xy: " M", path: "a.txt", add: 1, del: 0 },
  { xy: " M", path: "src/ui/b.js", add: 2, del: 1 },
  { xy: "A ", path: "src/new.js", add: 3, del: 0 },
  { xy: " D", path: "old.txt", add: 0, del: 4 },
  { xy: "UU", path: "conflict.txt", add: 1, del: 1 },
  { xy: "R ", path: "src/moved.js", from: "src/was.js", add: 1, del: 1 },
  { xy: "??", path: "fresh.txt" },
  { xy: " M", path: "img.png", add: null, del: null },
];

const claude = (over = {}) => ({ address: "t1", pane: "p1", status: "working", pane_name: "api", program: { key: "claude", name: "Claude Code" }, ...over });
const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();
const session = (text = "make the list shiny", files = [`${REPO}/a.txt`, `${REPO}/sub/inner.txt`], at = minutesAgo(5)) =>
  `P ${JSON.stringify(at)}\nT ${JSON.stringify(text)}\n${files.map((f) => `F ${JSON.stringify(f)}\n`).join("")}`;

// A ready scene: the space, the focused pane, an optional agent, a git for the entries and an optional session reply.
function scene({ entries = SIMPLE, agent = null, reply = null, git = {}, theme = T, tab = "changes" } = {}) {
  Object.assign(world, { spaces: [{ id: "s1", active: true, folder: REPO }], panes: [{ pane: "p1", cwd: REPO, pane_name: "api" }], focused: { pane: "p1" },
    agents: agent ? [agent] : [] });
  state.shared["herdsidian.sidebar"] = { tab };
  const fake = fakeGit({ status: porcelain(entries), numstat: numstat(entries), session: reply === null ? null : () => reply, ...git });
  const m = mount({ theme });
  const sessions = () => fake.calls.filter(([cmd]) => cmd === "/bin/sh");
  return { m, fake, sessions };
}
const listed = async (m, id = "change-a.txt") => until(() => { const t = m.render(); return findById(t, id) && t; }, "the rows");
const rowIds = (tree) => walk(tree).map((n) => n.nodeId).filter((id) => /^change-/.test(id ?? ""));
const find = (tree, id, text) => walk(findById(tree, id)).find((n) => n.kids.includes(text));

test("the kit mounts the Changes tab and finds changes-summary", async () => {
  Object.assign(world, { spaces: [{ id: "s1", active: true, folder: "/work/repo" }], panes: [{ pane: "p1", cwd: "/work/repo" }], focused: { pane: "p1" } });
  fakeGit({ status: "## main\0 M a.txt\0", numstat: "1\t0\ta.txt\0" });
  const m = mount();
  m.render();
  await settle();
  assert.equal(texts(findById(m.render(), "changes-summary")).length, 1);
});

// AC2
test("AC2: Loading changes... shows with no card and no row", async () => {
  const { m } = scene({ agent: claude(), reply: session() });
  state.exec = () => new Promise(() => {});
  const tree = m.render();
  assert.ok(texts(tree).some((s) => s.includes("Loading changes…")));
  assert.equal(findById(tree, "changes-turn"), null);
  assert.deepEqual(rowIds(tree), []);
});

test("AC2: No folder shows with no card and no row", async () => {
  const { m } = scene({ agent: claude(), reply: session() });
  Object.assign(world, { spaces: [], panes: [], focused: null });
  m.render();
  await settle();
  const tree = m.render();
  assert.ok(texts(tree).some((s) => s.includes("No folder")));
  assert.equal(findById(tree, "changes-turn"), null);
  assert.deepEqual(rowIds(tree), []);
});

test("AC2: Not a git repository shows with no card and no row", async () => {
  const { m } = scene({ agent: claude(), reply: session(), git: { fail: "top" } });
  m.render();
  await settle();
  const tree = m.render();
  assert.ok(texts(tree).some((s) => s.includes("Not a git repository")));
  assert.equal(findById(tree, "changes-turn"), null);
  assert.deepEqual(rowIds(tree), []);
});

test("AC2: a git error shows no card and no row", async () => {
  const { m, sessions } = scene({ agent: claude(), reply: session(), git: { fail: "status" } });
  m.render();
  await settle();
  const tree = m.render();
  assert.equal(findById(tree, "changes-turn"), null);
  assert.deepEqual(rowIds(tree), []);
  assert.equal(findById(tree, "changes-total"), null);
  assert.equal(sessions().length, 0, "no session read while the list is not ready");
});

test("AC2: an exec that throws shows no card and no row", async () => {
  const { m } = scene({ agent: claude(), reply: session() });
  state.exec = async () => { throw new Error("cannot run"); };
  m.render();
  await settle();
  const tree = m.render();
  assert.equal(findById(tree, "changes-turn"), null);
  assert.deepEqual(rowIds(tree), []);
});

// AC3
test("AC3: changes-summary is 30 px, muted, holds only the summary text, and the total is outside it", async () => {
  const { m } = scene({ agent: claude(), reply: session() });
  const tree = await listed(m);
  const summary = findById(tree, "changes-summary");
  assert.deepEqual(texts(summary), ["3 files changed on main"]);
  assert.ok(has(summary, "h", 30));
  assert.ok(has(summary, "text_color", T.muted));
  assert.equal(walk(summary).some((n) => n.nodeId === "changes-total"), false);
  const head = findById(tree, "changes-head");
  assert.ok(head && walk(head).includes(summary), "changes-head holds the summary");
});

// AC5
test("AC5: rows are 28 px, in git's order, with +N, -N, new and bin as in V1", async () => {
  const { m } = scene({ entries: [...SIMPLE.slice(0, 2), { xy: " M", path: "img.png", add: null, del: null }, SIMPLE[2]] });
  const tree = await listed(m);
  assert.deepEqual(rowIds(tree), ["change-a.txt", "change-sub/inner.txt", "change-img.png", "change-fresh.txt"]);
  for (const id of rowIds(tree)) assert.ok(has(findById(tree, id), "h", 28), `${id} is 28 px`);
  assert.ok(has(find(tree, "change-a.txt", "+1"), "text_color", T.ansi2));
  assert.equal(find(tree, "change-a.txt", "−0"), undefined, "a zero count is not drawn");
  assert.ok(has(find(tree, "change-sub/inner.txt", "+2"), "text_color", T.ansi2));
  assert.ok(has(find(tree, "change-sub/inner.txt", "−1"), "text_color", T.ansi1));
  assert.ok(has(find(tree, "change-fresh.txt", "new"), "text_color", T.muted));
  assert.ok(has(find(tree, "change-img.png", "bin"), "text_color", T.muted));
  assert.equal(find(tree, "change-fresh.txt", "+0"), undefined);
});

test("AC5: 500 rows at most, then N more files not shown", async () => {
  const entries = Array.from({ length: 520 }, (_v, i) => ({ xy: " M", path: `n${String(i).padStart(3, "0")}.txt`, add: 1, del: 0 }));
  const { m } = scene({ entries });
  const tree = await listed(m, "change-n000.txt");
  assert.equal(rowIds(tree).length, 500);
  assert.ok(texts(tree).some((s) => /20 more files not shown/.test(s)));
  assert.deepEqual(texts(findById(tree, "changes-summary")), ["520 files changed on main"]);
});

test("AC5: no id starts with change- except the rows, with a card and with a diff open", async () => {
  const { m } = scene({ agent: claude(), reply: session() });
  const tree = await until(() => { const t = m.render(); return findById(t, "changes-turn") && t; }, "the card");
  const rows = new Set(["change-a.txt", "change-sub/inner.txt", "change-fresh.txt"]);
  assert.ok(rowIds(tree).length === 3 && rowIds(tree).every((id) => rows.has(id)));
  m.click(findById(tree, "change-a.txt"));
  const diff = await until(() => { const t = m.render(); return findById(t, "diff-view") && t; }, "the diff view");
  assert.ok(rowIds(diff).every((id) => rows.has(id)), `unexpected ids: ${rowIds(diff)}`);
});

// AC6
test("AC6: a row shows badge, folder (muted), name (foreground, truncated), counts, bar, in that order", async () => {
  const { m } = scene({ entries: [{ xy: " M", path: "src/ui/b.js", add: 2, del: 1 }] });
  const tree = await listed(m, "change-src/ui/b.js");
  const row = findById(tree, "change-src/ui/b.js");
  assert.deepEqual(texts(row), ["M", "src/ui/", "b.js", "+2", "−1"]);
  assert.ok(has(find(tree, "change-src/ui/b.js", "src/ui/"), "text_color", T.muted));
  const name = find(tree, "change-src/ui/b.js", "b.js");
  assert.ok(has(name, "text_color", T.foreground));
  assert.ok(has(name, "truncate"));
  const order = walk(row);
  const bar = findById(tree, "changes-bar-src/ui/b.js");
  assert.ok(bar, "the row has its bar");
  assert.ok(order.indexOf(find(tree, "change-src/ui/b.js", "+2")) < order.indexOf(bar), "the bar comes last");
});

test("AC6: a file at the repo root shows no folder part", async () => {
  const { m } = scene({ entries: [{ xy: " M", path: "a.txt", add: 1, del: 0 }] });
  const tree = await listed(m);
  assert.deepEqual(texts(findById(tree, "change-a.txt")), ["M", "a.txt", "+1"]);
});

// AC7
test("AC7: the badge letter and theme color follow the status", async () => {
  const { m } = scene({ entries: MIXED, theme: FULL });
  const tree = await listed(m);
  const badge = (id, letter, color) => {
    const node = find(tree, id, letter);
    assert.ok(node, `${id} has the letter ${letter}`);
    assert.ok(has(node, "text_color", color), `${id} ${letter} is ${color}`);
  };
  badge("change-src/new.js", "A", FULL.ansi2);
  badge("change-fresh.txt", "A", FULL.ansi2);
  badge("change-old.txt", "D", FULL.ansi1);
  badge("change-conflict.txt", "U", FULL.ansi1);
  badge("change-a.txt", "M", FULL.ansi3);
  badge("change-src/moved.js", "R", FULL.ansi4);
});

test("AC7: a theme without ansi3, ansi4, working and idle still draws every row", async () => {
  const { m } = scene({ entries: MIXED, agent: claude({ status: "idle" }), reply: session(), theme: T });
  const tree = await listed(m);
  assert.equal(rowIds(tree).length, MIXED.length);
  m.render();
  await settle();
  m.render();
});

// AC8
test("AC8: the bar has 5 blocks, split green and red, empty for untracked and binary", async () => {
  const entries = [
    { xy: " M", path: "big.js", add: 10, del: 0 },
    { xy: " M", path: "mix.js", add: 6, del: 4 },
    { xy: " M", path: "tiny.js", add: 1, del: 0 },
    { xy: "??", path: "fresh.txt" },
    { xy: " M", path: "img.png", add: null, del: null },
  ];
  const { m } = scene({ entries });
  const tree = await listed(m, "change-big.js");
  const pill = tokens(T).pill;
  const colors = (path) => {
    const bar = findById(tree, `changes-bar-${path}`);
    assert.ok(bar, `${path} has a bar`);
    assert.equal(bar.kids.length, 5, `${path} has 5 blocks`);
    return bar.kids.map((block) => block.calls.find(([name]) => name === "bg")?.[1][0]);
  };
  const [g, r, e] = [T.ansi2, T.ansi1, pill];
  assert.deepEqual(colors("big.js"), [g, g, g, g, g]);
  assert.deepEqual(colors("mix.js"), [g, g, g, r, r]);
  assert.deepEqual(colors("tiny.js"), [g, e, e, e, e]);
  assert.deepEqual(colors("fresh.txt"), [e, e, e, e, e]);
  assert.deepEqual(colors("img.png"), [e, e, e, e, e]);
});

// AC9
test("AC9: a row click shows diff-view and does not select a tab", async () => {
  const { m } = scene();
  const tree = await listed(m);
  m.click(findById(tree, "change-a.txt"));
  const diff = await until(() => { const t = m.render(); return findById(t, "diff-view") && t; }, "the diff view");
  assert.ok(diff);
  assert.deepEqual(m.selected, []);
  assert.equal(state.shared["herdsidian.sidebar"].tab, "changes");
});

// AC11
test("AC11: the card shows the dot, agent, pane, time, prompt and footer", async () => {
  const { m } = scene({ agent: claude(), reply: session("make the list shiny"), theme: FULL });
  const tree = await until(() => { const t = m.render(); return findById(t, "changes-turn") && t; }, "the card");
  const head = findById(tree, "changes-turn-head");
  const headTexts = texts(head);
  assert.ok(headTexts.includes("Claude Code"));
  assert.ok(headTexts.includes("api"));
  assert.ok(headTexts.includes("5 min ago"));
  assert.ok(texts(findById(tree, "changes-turn-text")).includes("make the list shiny"));
  assert.deepEqual(texts(findById(tree, "changes-turn-foot")), ["Last prompt · 2 of 3 files changed in this turn"]);
  const dot = walk(head).find((n) => has(n, "bg", FULL.working));
  assert.ok(dot && dot.calls.some(([name]) => name === "loop"), "a working agent has a pulsing dot");
});

test("AC11: an idle agent has a ring dot", async () => {
  const { m } = scene({ agent: claude({ status: "idle" }), reply: session(), theme: FULL });
  const tree = await until(() => { const t = m.render(); return findById(t, "changes-turn") && t; }, "the card");
  const dot = walk(findById(tree, "changes-turn-head")).find((n) => has(n, "border_color", FULL.idle));
  assert.ok(dot, "an idle agent has a ring");
  assert.equal(dot.calls.some(([name]) => name === "bg"), false);
  assert.equal(dot.calls.some(([name]) => name === "loop"), false);
});

test("AC11: the prompt is two lines until a click shows it whole, and a second click clamps it again", async () => {
  const { m } = scene({ agent: claude(), reply: session("a very long prompt ".repeat(30)) });
  let tree = await until(() => { const t = m.render(); return findById(t, "changes-turn") && t; }, "the card");
  // The plan (Decision 2): the API has no line clamp, so two lines is a fixed height plus overflow_hidden.
  const clamped = (t) => {
    const nodes = walk(findById(t, "changes-turn-text"));
    return nodes.some((n) => n.calls.some(([name]) => name === "overflow_hidden")) && nodes.some((n) => n.calls.some(([name]) => name === "h"));
  };
  assert.equal(clamped(tree), true);
  // gpui reads a bare number in line_height as a multiplier of the font size, so the line height is a px string.
  const nodes = walk(findById(tree, "changes-turn-text"));
  const lineHeight = nodes.flatMap((n) => n.calls).find(([name]) => name === "line_height")?.[1][0];
  assert.match(String(lineHeight), /^\d+(\.\d+)?px$/, "line_height is a length in px, not a multiplier");
  const fixed = nodes.flatMap((n) => n.calls).find(([name]) => name === "h")?.[1][0];
  assert.equal(Number(fixed), 2 * parseFloat(lineHeight), "the fixed height is two lines");
  m.click(findById(tree, "changes-turn-text"));
  tree = m.render();
  assert.equal(clamped(tree), false);
  m.click(findById(tree, "changes-turn-text"));
  assert.equal(clamped(m.render()), true);
});

// Claude Code only (scope cut of 2026-11-25)
test("AC10: a Codex pane gets no card and no session read", async () => {
  const codex = claude({ program: { key: "codex", name: "Codex" } });
  const { m, sessions } = scene({ agent: codex, reply: session() });
  const tree = await listed(m);
  await settle();
  assert.equal(findById(m.render(), "changes-turn"), null);
  assert.equal(sessions().length, 0);
  assert.ok(tree);
});

// AC15
test("AC15: render makes no exec and no read in its own tick", async () => {
  const { m, fake } = scene({ agent: claude(), reply: session() });
  const reads = [];
  state.readTextFile = async (path) => { reads.push(path); return null; };
  for (let i = 0; i < 3; i++) {
    const before = fake.calls.length;
    m.render();
    assert.equal(fake.calls.length, before, "no exec inside render");
    assert.deepEqual(reads, []);
    await settle();
  }
  m.render();
  assert.deepEqual(reads, []);
});

test("AC15: five renders give one session read", async () => {
  const { m, sessions } = scene({ agent: claude(), reply: session() });
  await listed(m);
  for (let i = 0; i < 5; i++) m.render();
  await settle();
  for (let i = 0; i < 5; i++) m.render();
  await settle();
  assert.equal(sessions().length, 1);
  assert.ok(findById(m.render(), "changes-turn"));
});

test("AC15: a second read comes after a watch refresh and after a new target", async () => {
  const { m, sessions } = scene({ agent: claude(), reply: session() });
  await listed(m);
  await until(() => sessions().length === 1, "the first read");
  const rev = m.watch.rev;
  const watcher = await until(() => world.watchers.find((w) => w.root === REPO), "the folder watch");
  watcher.resolve([`${REPO}/a.txt`]);
  await until(() => m.watch.rev > rev, "the refresh");
  m.render();
  await until(() => sessions().length === 2, "the read after the refresh");
  world.agents = [claude({ address: "t9" })];
  m.render();
  await until(() => sessions().length === 3, "the read for the new target");
  m.render();
  await settle();
  assert.equal(sessions().length, 3);
});

test("AC15: no read happens while the store says another tab", async () => {
  const { m, sessions } = scene({ agent: claude(), reply: session() });
  await listed(m);
  await until(() => sessions().length === 1, "the first read");
  state.shared["herdsidian.sidebar"] = { tab: "files" };
  const rev = m.watch.rev;
  const watcher = await until(() => world.watchers.find((w) => w.root === REPO), "the folder watch");
  watcher.resolve([`${REPO}/a.txt`]);
  await until(() => m.watch.rev > rev, "the refresh");
  await settle();
  assert.equal(sessions().length, 1);
});

// AC16
test("AC16: a dot shows on turn rows only", async () => {
  const { m } = scene({ agent: claude(), reply: session("go", [`${REPO}/a.txt`]), theme: FULL });
  const tree = await until(() => { const t = m.render(); return findById(t, "changes-dot-a.txt") && t; }, "the dot");
  assert.ok(has(findById(tree, "changes-dot-a.txt"), "bg", FULL.accent));
  assert.equal(findById(tree, "changes-dot-sub/inner.txt"), null);
  assert.equal(findById(tree, "changes-dot-fresh.txt"), null);
  assert.ok(walk(findById(tree, "change-a.txt")).some((n) => n.nodeId === "changes-dot-a.txt"), "the dot is inside its row");
});

test("AC16: with no card there are no dots", async () => {
  const { m } = scene({ agent: claude(), reply: "" });
  const tree = await listed(m);
  await settle();
  const after = m.render();
  assert.equal(findById(after, "changes-turn"), null);
  assert.deepEqual(walk(tree).concat(walk(after)).filter((n) => /^changes-dot-/.test(n.nodeId ?? "")), []);
});

// AC47
test("AC47: the tab works with a host of exactly cx, selectTab, files, vault, changes and a dead host.cx", async () => {
  const { m } = scene({ agent: claude(), reply: session() });
  assert.deepEqual(Object.keys(m.host).sort(), ["changes", "cx", "files", "selectTab", "vault"]);
  const { ChangesTab } = await import("../mods/herdsidian/changes-view.js");
  const touched = [];
  const host = { get cx() { touched.push("cx"); throw new Error("host.cx used"); }, selectTab: () => {}, files: () => m.files, vault: () => null, changes: () => m.watch };
  const tab = new ChangesTab(host);
  const render = () => during(m.cx, (c) => tab.render(T, c));
  const tree = await until(() => { const t = render(); return findById(t, "change-a.txt") && findById(t, "changes-turn") && t; }, "rows and card");
  assert.equal(findById(tree, "tab-changes") !== null, true);
  during(m.cx, (c) => findById(tree, "change-a.txt").onClick(null, c));
  assert.ok(findById(render(), "diff-view"));
  assert.deepEqual(touched, [], "the tab never reads host.cx");
});
