// A pane that shows another terminal (terminal.show) is not showing the agent, so its needs-you card still shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { watched } from "../mods/herdsidian-toast/stack.js";

const card = { id: 1, key: "p1", kind: "blocked", ttl: null, expires: null, left: null, leaving: false };

test("FS1 the focused pane shows another terminal: not watched", () => {
  assert.equal(watched(card, { pane: "p1", shown: "t9" }, true), false);
});

test("FS2 the focused pane shows its own terminal (shown null or absent): watched", () => {
  assert.equal(watched(card, { pane: "p1", shown: null }, true), true);
  assert.equal(watched(card, { pane: "p1" }, true), true);
});
