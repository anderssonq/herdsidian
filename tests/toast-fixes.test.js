// herdsidian-toast fix round: leaving cards that must not ghost, a timer line that keeps animating across window swaps,
// a fresh cx in every handler, warning and login cards that can leave, fixed card heights, state that survives a swap.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { state, element, walk, findById, fakeCx } from "./support/mod-stubs.js";

const host = globalThis.__herdsidianStubs.herdr;
const kit = globalThis.__herdsidianStubs["gpui-kit"];
kit.image = (path) => element("image", path);

let panes = [], agents = [], machines = [], appActive = true, overlayLog = [];
host.panes = () => panes;
host.agents = () => agents;
host.machines = () => machines;
host.keys = () => [];
host.window = () => ({ platform: "macos", titlebar: "none", active: appActive });
host.openOverlay = (spec) => { const id = `win-${overlayLog.filter((e) => e.op === "open").length + 1}`; overlayLog.push({ op: "open", id, spec }); return id; };
host.closeOverlay = (id) => { overlayLog.push({ op: "close", id }); };

const { default: Toast } = await import("../mods/herdsidian-toast/main.js");
const { A, stillNeeded, windowSpec, heightOf } = await import("../mods/herdsidian-toast/stack.js");

const KEY = "herdsidian-toast";
const FULL = A.width - 28;
let now = 1_000_000;
Date.now = () => now;

beforeEach(() => {
  state.props = {};
  state.shared = {};
  state.runs = [];
  state.viewport = null;
  state.layout = { id: "root", children: [] };
  panes = []; agents = []; machines = []; appActive = true; overlayLog = []; now = 1_000_000;
});

function timedCx() {
  const cx = fakeCx();
  cx.timers = [];
  cx.notified = 0;
  cx.notify = () => { cx.notified += 1; };
  cx.stop_propagation = () => {};
  cx.timer = {
    after: (ms, fn) => { cx.timers.push({ ms, fn, kind: "after", done: false }); },
    every: (ms, fn) => { cx.timers.push({ ms, fn, kind: "every", done: false }); },
  };
  cx.fire = (ms) => {
    const t = cx.timers.find((x) => !x.done && x.kind === "after" && x.ms === ms);
    assert.ok(t, `no pending timer of ${ms} ms`);
    t.done = true;
    t.fn(cx);
  };
  cx.drain = () => {
    for (let i = 0; i < 20; i++) {
      const t = cx.timers.find((x) => !x.done && x.kind === "after");
      if (!t) return;
      t.done = true;
      t.fn(cx);
    }
  };
  cx.tick = () => cx.timers.filter((x) => x.kind === "every").forEach((t) => t.fn(cx));
  return cx;
}

const notice = (over = {}) => ({ level: "success", title: "Done", body: "all green", ...over });
const loginNotice = (machine = "devbox") => notice({ level: "error", title: "x", body: `${machine} needs login; run hc machine login ${machine}` });
const store = () => state.shared[KEY];

function post(props, hostId = "host-1") {
  state.props = { ...props, overlay: hostId };
  new Toast().init(state.props, timedCx());
}

function stackCopy() {
  state.props = { stack: true, overlay: store().window.id };
  const cx = timedCx();
  const view = new Toast();
  view.init(state.props, cx);
  return { view, cx, overlay: state.props.overlay, tree: () => view.render(cx) };
}

const args = (node, name) => node.calls.filter(([n]) => n === name).map(([, a]) => a);
const handler = (node, name) => node.calls.filter(([n]) => n === name).at(-1)[1].at(-1);
const texts = (n, out = []) => { typeof n === "string" ? out.push(n) : n?.kids?.forEach((k) => texts(k, out)); return out; };
const opens = () => overlayLog.filter((e) => e.op === "open");

// A cx that throws on any use: what a render's cx is once the render is over.
function kill(cx) {
  const boom = () => { throw new Error("stale cx used after its render"); };
  cx.notify = boom; cx.write_to_clipboard = boom; cx.stop_propagation = boom;
  cx.timer = { after: boom, every: boom };
}

test("F1 a card leaving when its window is replaced is finished by the new copy; the old copy does nothing", () => {
  post(notice());
  const first = stackCopy();
  first.tree();
  now += A.ttl;
  first.cx.fire(A.ttl);
  assert.equal(store().cards[0].leaving, true);
  assert.equal(typeof store().cards[0].leavingAt, "number");

  post(notice({ title: "Second" }), "host-2");
  assert.equal(store().cards.length, 2);
  state.props = { stack: true, overlay: first.overlay };
  first.cx.drain();
  assert.equal(store().cards.length, 2, "the replaced copy never acts");

  const second = stackCopy();
  second.tree();
  second.cx.drain();
  assert.deepEqual(store().cards.map((c) => c.title), ["Second"]);
});

test("F1 a card whose fade is already over is finished at once by the new copy", () => {
  post(notice());
  const first = stackCopy();
  first.tree();
  now += A.ttl;
  first.cx.fire(A.ttl);
  post(notice({ title: "Second" }), "host-2");
  now += A.leave;
  const second = stackCopy();
  second.tree();
  second.cx.timers.filter((t) => t.kind === "after" && t.ms === 0).forEach((t) => { t.done = true; t.fn(second.cx); });
  assert.deepEqual(store().cards.map((c) => c.title), ["Second"]);
});

test("F2 a card first drawn in a new copy draws its remaining time, then slides to 0 one render later", () => {
  post(notice());
  const first = stackCopy();
  first.tree();
  first.cx.drain();
  const id = store().cards[0].id;
  now += 2000;
  post(notice({ title: "Second" }), "host-2");
  const second = stackCopy();
  const fill = () => findById(second.tree(), `toast-timer-fill-${id}`);
  assert.deepEqual(args(fill(), "w").at(-1), [FULL * 0.6]);
  second.cx.drain();
  assert.deepEqual(args(fill(), "w").at(-1), [0]);
});

test("F3 every handler uses the cx its own callback gets, never the render's", () => {
  const rendered = () => {
    const copy = stackCopy();
    const tree = copy.tree();
    kill(copy.cx);
    return { tree, fresh: Object.assign(timedCx(), { notify() { this.notified += 1; } }) };
  };

  post(loginNotice());
  let id = store().cards[0].id;
  let r = rendered();
  findById(r.tree, `toast-copy-${id}`).onClick({}, r.fresh);
  assert.deepEqual(r.fresh.clipboard, ["hc machine login devbox"]);
  r = rendered();
  findById(r.tree, `toast-later-${id}`).onClick({}, r.fresh);
  assert.equal(store().cards.length, 0);

  state.shared = {};
  post(notice({ title: "Open me", action: { name: "x.go", args: {} } }));
  id = store().cards[0].id;
  r = rendered();
  handler(findById(r.tree, `toast-card-${id}`), "on_hover")(true, r.fresh);
  assert.notEqual(store().cards[0].left, null);
  r = rendered();
  findById(r.tree, `toast-card-${id}`).onClick({}, r.fresh);
  assert.equal(store().cards.length, 0);
  assert.ok(r.fresh.notified > 0);

  state.shared = {};
  panes = [{ pane: "p1", app: "claude", program: { name: "Claude Code" }, branch: "b", tab: "t1" }];
  agents = [{ pane: "p1", status: "blocked" }];
  post(notice({ level: "warning", action: { name: "pane.focus", args: { pane: "p1" } } }));
  id = store().cards[0].id;
  r = rendered();
  state.runs = [];
  findById(r.tree, `toast-go-${id}`).onClick({}, r.fresh);
  assert.deepEqual(state.runs, [["pane.focus", { pane: "p1" }]]);

  state.shared = {};
  for (let i = 0; i < 4; i++) post(notice({ title: `n${i}` }), `host-${i}`);
  r = rendered();
  findById(r.tree, "toast-more").onClick({}, r.fresh);
  assert.equal(store().expanded, true);
});

test("F4 a warning notice with no pane stays, and offers Later but not Go to agent", () => {
  post(notice({ level: "warning", title: "Careful", body: "disk almost full" }));
  const copy = stackCopy();
  const id = store().cards[0].id;
  const tree = copy.tree();
  copy.cx.drain();
  assert.equal(store().cards.length, 1);
  assert.equal(findById(tree, `toast-go-${id}`), null);
  assert.deepEqual(texts(findById(tree, `toast-later-${id}`)), ["Later"]);
  assert.equal(stillNeeded({ kind: "blocked", key: null }, [], []), true);
  assert.equal(stillNeeded({ kind: "blocked", key: "p1" }, [], []), false);
});

test("F5 login cards: Later removes the card; an unknown machine is no longer needed; one card per machine", () => {
  post(loginNotice());
  const copy = stackCopy();
  const id = store().cards[0].id;
  const later = findById(copy.tree(), `toast-later-${id}`);
  assert.deepEqual(texts(later), ["Later"]);
  const kids = walk(findById(copy.tree(), `toast-card-${id}`)).filter((n) => /^toast-(code|copy|later)-/.test(n.nodeId ?? "")).map((n) => n.nodeId.split("-")[1]);
  assert.deepEqual(kids, ["code", "copy", "later"], "Later comes after Copy");
  later.onClick({}, copy.cx);
  assert.equal(store().cards.length, 0);

  const login = { kind: "error", login: "hc machine login devbox" };
  assert.equal(stillNeeded(login, [], [{ name: "other", layout: "ready" }]), false);
  assert.equal(stillNeeded(login, [], [{ name: "devbox", layout: "loading" }]), true);
  assert.equal(stillNeeded(login, [], []), true);

  state.shared = {};
  post(loginNotice(), "host-1");
  post(loginNotice(), "host-2");
  assert.equal(store().cards.length, 1, "same machine replaces in place");
  post(loginNotice("other"), "host-3");
  assert.equal(store().cards.length, 2);
});

test("F6 each card has the height the window counts; expanded mode caps the window and scrolls", () => {
  post(blockedCard());
  let copy = stackCopy();
  let id = store().cards[0].id;
  assert.deepEqual(args(findById(copy.tree(), `toast-card-${id}`), "h").at(-1), [96]);
  state.shared = {};
  post(notice());
  copy = stackCopy();
  id = store().cards[0].id;
  assert.deepEqual(args(findById(copy.tree(), `toast-card-${id}`), "h").at(-1), [60]);

  const eight = { v: 1, window: null, expanded: true, cards: Array.from({ length: 8 }, (_, i) => ({ id: i, kind: "done", key: null })) };
  assert.equal(windowSpec(eight, { vw: 1600, vh: 400, zoom: 1 }).height, 300);
  assert.equal(windowSpec(eight, { vw: 1600, zoom: 1 }).height, 8 * heightOf({ kind: "done" }) + 7 * A.gap + A.margin);
  assert.equal(windowSpec({ ...eight, expanded: false }, { vw: 1600, vh: 100, zoom: 1 }).height, 3 * 60 + 28 + 3 * 8 + 12);

  state.shared = {};
  state.viewport = { width: 1600, height: 400 };
  for (let i = 0; i < 6; i++) post(notice({ title: `n${i}` }), `host-${i}`);
  copy = stackCopy();
  copy.tree();
  findById(copy.tree(), "toast-more").onClick({}, copy.cx);
  assert.equal(opens().at(-1).spec.height, 300);
  assert.equal(args(copy.tree(), "overflow_y_scrollbar").length, 1);
});

function blockedCard() {
  panes = [{ pane: "p1", app: "claude", program: { name: "Claude Code" }, branch: "b", tab: "t1" }];
  agents = [{ pane: "p1", status: "blocked" }];
  return notice({ level: "warning", action: { name: "pane.focus", args: { pane: "p1" } } });
}

test("F7 Copied and the hover pause live in the shared store and survive a window swap", () => {
  post(loginNotice());
  let copy = stackCopy();
  const id = store().cards[0].id;
  findById(copy.tree(), `toast-copy-${id}`).onClick({}, copy.cx);
  assert.equal(store().cards[0].copied, true);
  post(notice({ title: "Second" }), "host-2");
  copy = stackCopy();
  assert.ok(texts(findById(copy.tree(), `toast-copy-${id}`)).includes("Copied"));

  state.shared = {};
  post(notice());
  copy = stackCopy();
  const timed = store().cards[0].id;
  handler(findById(copy.tree(), `toast-card-${timed}`), "on_hover")(true, copy.cx);
  now += 1000;
  post(notice({ title: "Second" }), "host-2");
  const next = stackCopy();
  next.tree();
  now += 10000;
  next.cx.tick();
  const card = store().cards.find((c) => c.id === timed);
  assert.notEqual(card.left, null, "a card under the pointer stays paused in the new copy");
});

test("F8 the tick redraws when an age label changes, also past 60 s, and not otherwise", () => {
  post(notice({ level: "error", title: "x", body: "y" }));
  now += 120000;
  const copy = stackCopy();
  copy.tree();
  const before = copy.cx.notified;
  now += 30000;
  copy.cx.tick();
  assert.equal(copy.cx.notified, before, "2 m stays 2 m");
  now += 40000;
  copy.cx.tick();
  assert.equal(copy.cx.notified, before + 1, "2 m became 3 m");
});

test("F9 the tick reopens the window when the computed spec differs from the opened one", () => {
  state.viewport = { width: 1600, height: 900 };
  post(notice());
  const copy = stackCopy();
  copy.tree();
  assert.equal(opens().length, 1);
  state.viewport = { width: 1200, height: 900 };
  copy.cx.tick();
  copy.cx.drain();
  assert.equal(opens().length, 2);
  assert.equal(opens().at(-1).spec.at.x, 1200 - (16 + A.width + A.margin));
});

test("F11 card-view takes its sizes from the model, not its own constants", () => {
  const source = readFileSync(new URL("../mods/herdsidian-toast/card-view.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /const (WIDTH|ENTER|LEAVE)\s*=\s*(\d|\{\s*duration:\s*\d)/);
  assert.match(source, /\bA\.width\b/);
  assert.match(source, /\bA\.enter\b/);
  assert.match(source, /\bA\.leave\b/);
});
