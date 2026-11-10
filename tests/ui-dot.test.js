// lib/ui.js dot(): the status dot, pulsing while working unless { pulse: false } (the toolbar's tab dot).
import { test } from "node:test";
import assert from "node:assert/strict";
import "./support/mod-stubs.js";

const { dot } = await import("../lib/ui.js");
const t = { working: "w", done: "d", blocked: "b", idle: "i", unknown: "u" };
const hasCall = (node, name, arg) => node.calls.some(([n, args]) => n === name && (arg === undefined || args[0] === arg));

test("a working dot pulses by default", () => {
  const d = dot(t, "working", 6);
  assert.ok(hasCall(d, "bg", "w"));
  assert.ok(hasCall(d, "loop"));
});

test("with pulse: false a working dot is still: filled and no loop", () => {
  const d = dot(t, "working", 6, 0, { pulse: false });
  assert.ok(hasCall(d, "bg", "w"));
  assert.ok(!hasCall(d, "loop"));
});

test("pulse: false also works in the margin slot, and the margin still applies", () => {
  const d = dot(t, "working", 6, 3, { pulse: false });
  assert.ok(hasCall(d, "mx", 3));
  assert.ok(!hasCall(d, "loop"));
  assert.ok(!hasCall(dot(t, "working", 6, { pulse: false }), "loop"));
});

test("an idle dot is a ring with no fill, pulse or not", () => {
  const d = dot(t, "idle", 6, 0, { pulse: false });
  assert.ok(hasCall(d, "border_color", "i"));
  assert.ok(!hasCall(d, "bg"));
});
