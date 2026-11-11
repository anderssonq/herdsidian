// herdsidian-toast: one frameless window holds the card stack. The host copy pushes the card and hands off;
// the stack copy draws the cards and owns the timers.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { state, element, walk, findById, fakeCx } from "./support/mod-stubs.js";

const host = globalThis.__herdsidianStubs.herdr;
const kit = globalThis.__herdsidianStubs["gpui-kit"];
kit.image = (path) => element("image", path);

// What the Herdr calls answer, and a log of the overlay calls in order. Set before main.js is imported:
// the stubs are read once, at import.
let panes = [], agents = [], machines = [], appActive = true, bindings = [], overlayLog = [];
host.panes = () => panes;
host.agents = () => agents;
host.machines = () => machines;
host.keys = () => bindings;
host.window = () => ({ platform: "macos", titlebar: "none", active: appActive });
host.openOverlay = (spec) => { const id = `win-${overlayLog.filter((e) => e.op === "open").length + 1}`; overlayLog.push({ op: "open", id, spec }); return id; };
host.closeOverlay = (id) => { overlayLog.push({ op: "close", id }); };

const { default: Toast } = await import("../mods/herdsidian-toast/main.js");
const { A } = await import("../mods/herdsidian-toast/stack.js");

const root = new URL("..", import.meta.url).pathname;
const KEY = "herdsidian-toast";
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

// A cx whose timers are recorded; fire() runs one, drain() runs every pending one (oldest first).
function timedCx() {
  const cx = fakeCx();
  cx.timers = [];
  cx.stops = 0;
  cx.stop_propagation = () => { cx.stops += 1; };
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
const store = () => state.shared[KEY];

// The host copy: Herdr opens the mod in an overlay, whose init gets the notice.
function post(props, hostId = "host-1") {
  state.props = { ...props, overlay: hostId };
  new Toast().init(state.props, timedCx());
}

// The stack copy of the window the store names, with its props set as Herdr would.
function stackCopy() {
  state.props = { stack: true, overlay: store().window.id };
  const cx = timedCx();
  const view = new Toast();
  view.init(state.props, cx);
  return { view, cx, tree: () => view.render(cx) };
}

const press = (node, cx) => node.onClick({}, cx);
const handler = (node, name, first) => node.calls.find(([n, a]) => n === name && (first === undefined || a[0] === first))[1].at(-1);

const blockedPane = () => {
  panes = [{ pane: "p1", app: "claude", program: { name: "Claude Code" }, branch: "feat/x", tab: "t1" }];
  agents = [{ pane: "p1", status: "blocked", space_name: "herdsidian" }];
  return notice({ level: "warning", title: "Needs you", body: "", action: { name: "pane.focus", args: { pane: "p1" } } });
};

test("W1 the host pushes the card, opens the stack window, closes its own overlay, only in init", () => {
  post(notice());
  assert.equal(store().v, 1);
  assert.equal(store().cards.length, 1);
  const opens = overlayLog.filter((e) => e.op === "open");
  assert.equal(opens.length, 1);
  const spec = opens[0].spec;
  assert.equal(spec.mod, "herdsidian-toast");
  assert.equal(spec.kind, "window");
  assert.equal(spec.frame, "none");
  assert.equal(spec.key, undefined);
  assert.deepEqual(spec.props, { stack: true });
  assert.equal(store().window.id, opens[0].id);
  assert.deepEqual(overlayLog.filter((e) => e.op === "close").map((e) => e.id), ["host-1"]);

  const before = overlayLog.length;
  const view = new Toast();
  state.props = notice({ overlay: "host-2" });
  view.render(timedCx());
  assert.equal(overlayLog.length, before, "render of a host copy opens and closes nothing");
});

test("W2 a change opens the new window before it closes the old one; x is never negative without a viewport", () => {
  post(notice());
  const first = store().window.id;
  post(notice({ title: "Second" }), "host-2");
  const log = overlayLog.map((e) => `${e.op}:${e.id}`);
  assert.ok(log.indexOf("open:win-2") >= 0 && log.indexOf(`close:${first}`) > log.indexOf("open:win-2"), log.join(" "));
  assert.equal(store().window.id, "win-2");
  for (const e of overlayLog.filter((x) => x.op === "open")) {
    assert.ok(Number.isFinite(e.spec.at.x) && e.spec.at.x >= 0);
    assert.ok(e.spec.height > 0);
  }
});

test("W3 a sidebar width or hidden change reopens the window at the new x", () => {
  state.viewport = { width: 1600, height: 900 };
  state.layout = { id: "root", children: [{ id: "herdsidian", hidden: false, size: { px: 380 } }] };
  post(notice());
  const open = () => overlayLog.filter((e) => e.op === "open").at(-1).spec;
  assert.equal(open().at.x, 1600 - (380 + 16 + A.width + A.margin));

  const { cx, tree } = stackCopy();
  tree();
  state.layout = { id: "root", children: [{ id: "herdsidian", hidden: true, size: { px: 380 } }] };
  tree();
  cx.drain();
  assert.equal(open().at.x, 1600 - (16 + A.width + A.margin));
  assert.equal(overlayLog.filter((e) => e.op === "open").length, 2);
});

test("W4 an expired card leaves after the leave delay; a paused one stays", () => {
  post(notice());
  const { cx, tree } = stackCopy();
  tree();
  now += A.ttl;
  cx.fire(A.ttl);
  assert.equal(store().cards.length, 1);
  assert.equal(store().cards[0].leaving, true);
  cx.fire(A.leave);
  assert.equal(store().cards.length, 0);
  assert.equal(store().window, null);
  assert.ok(overlayLog.some((e) => e.op === "close" && e.id === "win-1"));
});

test("W4 hover pauses a card and an inactive app pauses every timed card", () => {
  post(notice());
  let copy = stackCopy();
  const card = () => store().cards[0];
  const id = card().id;
  handler(findById(copy.tree(), `toast-card-${id}`), "on_hover")(true);
  assert.notEqual(card().left, null);
  now += A.ttl * 2;
  copy.cx.drain();
  assert.equal(store().cards.length, 1);
  assert.equal(card().leaving, false);
  handler(findById(copy.tree(), `toast-card-${id}`), "on_hover")(false);
  assert.equal(card().left, null);

  appActive = false;
  copy.cx.tick();
  assert.notEqual(card().left, null);
  appActive = true;
  copy.cx.tick();
  assert.equal(card().left, null);
});

test("W5 Go to agent runs pane.focus and removes the card", () => {
  post(blockedPane());
  const { cx, tree } = stackCopy();
  const id = store().cards[0].id;
  press(findById(tree(), `toast-go-${id}`), cx);
  assert.deepEqual(state.runs, [["pane.focus", { pane: "p1" }]]);
  assert.equal(store().cards.length, 0);
});

test("W6 a blocked card leaves when its agent is no longer blocked", () => {
  post(blockedPane());
  const { cx, tree } = stackCopy();
  tree();
  assert.equal(store().cards.length, 1);
  agents = [{ pane: "p1", status: "working" }];
  tree();
  cx.drain();
  assert.equal(store().cards.length, 0);
});

test("W7 the stack's mouse down stops propagation, so a press never drags the window", () => {
  post(notice());
  const { cx, tree } = stackCopy();
  const view = tree();
  handler(view, "on_mouse_down", "left")({}, cx);
  assert.equal(cx.stops, 1);
});

test("W8 the layout names the toast mod and Herdr accepts the mod", (t) => {
  const layout = JSON.parse(readFileSync(`${root}layouts/herdsidian.json`, "utf8"));
  assert.equal(layout.toast, "herdsidian-toast");
  const run = spawnSync("herdr-app", ["check", `${root}mods/herdsidian-toast`], { encoding: "utf8" });
  if (run.error?.code === "ENOENT") return t.skip("herdr-app is not on PATH");
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test("W9 closing the stack window clears the store's window only when it is the current one", async () => {
  post(notice());
  const own = stackCopy();
  state.props = { stack: true, overlay: "win-old" };
  await own.view.close();
  assert.equal(store().window.id, "win-1");
  state.props = { stack: true, overlay: "win-1" };
  await own.view.close();
  assert.equal(store().window, null);
});

test("W10 a login card copies its command; Go to agent shows the bound key", () => {
  bindings = [{ section: "global", keys: "cmd-j", action: "guide-agents.next-blocked" }];
  post(blockedPane());
  let copy = stackCopy();
  const texts = (n, out = []) => { typeof n === "string" ? out.push(n) : n?.kids?.forEach((k) => texts(k, out)); return out; };
  assert.ok(texts(copy.tree()).includes("⌘J"));

  state.shared = {};
  overlayLog = [];
  post(notice({ level: "error", title: "x", body: "devbox needs login; run hc machine login devbox" }));
  copy = stackCopy();
  const id = store().cards[0].id;
  press(findById(copy.tree(), `toast-copy-${id}`), copy.cx);
  assert.deepEqual(copy.cx.clipboard, ["hc machine login devbox"]);
  assert.ok(texts(copy.tree()).includes("Copied"));
  assert.equal(store().cards.length, 1, "copy keeps the card");
});
