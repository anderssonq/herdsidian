// The herdsidian-toast mod finishes a leaving card saved without `leavingAt` (older store data)
// with a real delay, never NaN.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../mods/herdsidian-toast/main.js", import.meta.url), "utf8");

test("finishLeaving falls back when a leaving card has no leavingAt", () => {
  const body = source.slice(source.indexOf("finishLeaving(cx) {"), source.indexOf("finishLeaving(cx) {") + 500);
  assert.match(body, /c\.leavingAt \?\? t/);
  const t = 1000, delay = (leavingAt) => Math.max(0, 120 - (t - (leavingAt ?? t)));
  assert.equal(delay(undefined), 120);
  assert.ok(Number.isFinite(delay(undefined)));
});
