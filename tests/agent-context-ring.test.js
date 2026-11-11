// The context ring: which ring-NNN.svg a percent picks, and the 21 files themselves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { ringStep } from "../mods/guide-agents/agent-context.js";

const dir = new URL("../mods/guide-agents/ring/", import.meta.url).pathname;

test("ringStep rounds to the nearest 5, clamps 0-100 and pads to 3 digits", () => {
  assert.equal(ringStep(62), "060");
  assert.equal(ringStep(90), "090");
  assert.equal(ringStep(140), "100");
  assert.equal(ringStep(3), "005");
  assert.equal(ringStep(2), "000");
  assert.equal(ringStep(0), "000");
  assert.equal(ringStep(-8), "000");
  assert.equal(ringStep(100), "100");
  assert.equal(ringStep(98), "100");
  assert.equal(ringStep(97), "095");
});

test("all 21 ring files exist and use only currentColor", () => {
  for (let p = 0; p <= 100; p += 5) {
    const file = `${dir}ring-${String(p).padStart(3, "0")}.svg`;
    assert.ok(existsSync(file), `${file} exists`);
    const text = readFileSync(file, "utf8");
    assert.ok(text.includes("<svg"), `${file} is an svg`);
    assert.ok(text.includes("currentColor"), `${file} uses currentColor`);
    assert.ok(!text.includes("#"), `${file} has no # color`);
  }
});
