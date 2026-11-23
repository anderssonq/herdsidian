// A "needs you" card for the pane the person is already looking at is noise: it is not shown, and a shown one
// leaves once its pane takes the focus. Only while Herdr is the active window; in the background it still shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { A, watched } from "../mods/herdsidian-toast/stack.js";

const mk = (o) => ({ id: 1, key: "p1", kind: "blocked", login: null, title: "Codex needs you", sub: "", letter: "C", icon: null,
  action: null, at: 0, ttl: null, expires: null, left: null, entered: false, leaving: false, ...o });

test("F1 a needs-you card for the focused pane, Herdr active: watched", () => {
  assert.equal(watched(mk(), { pane: "p1" }, true), true);
});

test("F2 Herdr in the background: not watched, even on the focused pane", () => {
  assert.equal(watched(mk(), { pane: "p1" }, false), false);
});

test("F3 another pane focused, or no focus: not watched", () => {
  assert.equal(watched(mk(), { pane: "p2" }, true), false);
  assert.equal(watched(mk(), null, true), false);
  assert.equal(watched(mk(), { pane: null }, true), false);
});

test("F4 only needs-you cards with a pane: done, info, error and pane-less cards are never watched", () => {
  for (const kind of ["done", "info", "error"]) {
    assert.equal(watched(mk({ kind, ttl: A.ttl, expires: A.ttl }), { pane: "p1" }, true), false, kind);
  }
  assert.equal(watched(mk({ key: null }), { pane: null }, true), false);
  assert.equal(watched(mk({ key: null }), { pane: "p1" }, true), false);
});
