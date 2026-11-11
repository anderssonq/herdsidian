// The herdsidian-toast stack copy finishes a stored leaving card that has no `leavingAt`
// (older store data): it schedules a finite A.leave delay and then removes the card.
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx } from "./support/mod-stubs.js";

const host = globalThis.__herdsidianStubs.herdr;
host.panes = () => [];
host.agents = () => [];
host.machines = () => [];
host.keys = () => [];
host.window = () => ({ platform: "macos", titlebar: "none", active: true });
host.openOverlay = () => "win-2";
host.closeOverlay = () => {};

const { default: Toast } = await import("../mods/herdsidian-toast/main.js");
const { A } = await import("../mods/herdsidian-toast/stack.js");

test("a leaving card without leavingAt leaves after A.leave, never a NaN delay", () => {
  state.layout = { id: "root", children: [] };
  state.shared = { "herdsidian-toast": { v: 1, window: { id: "win-1", spec: null }, expanded: false, next: 2, hover: null,
    cards: [{ id: 1, key: null, kind: "info", login: null, title: "Old", sub: "", letter: "O", icon: null, action: null,
      at: 0, ttl: 5000, expires: 1, left: null, entered: true, leaving: true }] } };
  state.props = { stack: true, overlay: "win-1" };
  const cx = fakeCx();
  const timers = [];
  cx.timer = { after: (ms, fn) => timers.push({ ms, fn }), every() {} };
  cx.notify = () => {};
  const view = new Toast();
  view.init(state.props, cx);
  view.render(cx);
  for (let i = 0; i < 5 && state.shared["herdsidian-toast"].cards.length; i++) {
    const t = timers.shift();
    if (!t) break;
    assert.ok(Number.isFinite(t.ms), `timer delay ${t.ms}`);
    t.fn(cx);
  }
  assert.ok(!timers.some((t) => !Number.isFinite(t.ms)));
  assert.equal(state.shared["herdsidian-toast"].cards.length, 0, "the old leaving card is removed");
  assert.ok(A.leave > 0);
});
