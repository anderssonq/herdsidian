// An error notice tied to an agent's pane: a blocked agent reads as "needs you" with Go to agent,
// and any other error with a pane also offers Go to agent. An error with no pane keeps only the X.
import { test } from "node:test";
import assert from "node:assert/strict";
import { walk } from "./support/mod-stubs.js";

const { cardFrom, stillNeeded } = await import("../mods/herdsidian-toast/stack.js");
const { cardView } = await import("../mods/herdsidian-toast/card-view.js");

const T = { foreground: "#eeeeee", background: "#111111", popover: "#202020", solid: "#dddddd", solid_foreground: "#101010", done: "#00cc66",
  blocked: "#ffaa00", accent: "#ff00aa", muted: "#999999", raised: "#2a2a2a" };
const handlers = { onGo() {}, onClose() {}, onCopy() {}, onOpen() {}, onHover() {} };
const ids = (card) => walk(cardView(card, T, handlers, 1000, { copied: false, cap: "⌘J", agoText: "now" }))
  .map((n) => n.nodeId ?? "").filter((id) => /^toast-(close|go|copy)-/.test(id)).map((id) => id.split("-")[1]);

const pane = { pane: "p1", app: "codex", program: { name: "Codex" }, branch: "feat/x", tab: "t1" };
const spaces = [{ id: "s1", name: "acme-api", tabs: [{ id: "t1" }] }];
const focus = { name: "pane.focus", args: { pane: "p1" } };

test("E1 an error notice for a blocked agent's pane is a needs-you card with Go to agent", () => {
  const ctx = { panes: [pane], agents: [{ pane: "p1", status: "blocked" }], spaces };
  const card = cardFrom({ level: "error", title: "Codex needs you", body: "acme-api / 2", action: focus }, ctx, 1000, 1);
  assert.equal(card.kind, "blocked");
  assert.equal(card.key, "p1");
  assert.equal(card.title, "Codex needs you");
  assert.equal(card.ttl, null, "it stays until acted on");
  assert.deepEqual(ids(card), ["close", "go"]);
  assert.equal(stillNeeded(card, [{ pane: "p1", status: "blocked" }], []), true);
  assert.equal(stillNeeded(card, [{ pane: "p1", status: "working" }], []), false, "it leaves once the agent is unblocked");
});

test("E2 any other error notice with a pane keeps its error look and offers Go to agent", () => {
  const ctx = { panes: [pane], agents: [{ pane: "p1", status: "working" }], spaces };
  const card = cardFrom({ level: "error", title: "Codex crashed", body: "exit 1", action: focus }, ctx, 1000, 2);
  assert.equal(card.kind, "error");
  assert.equal(card.key, "p1");
  assert.equal(card.title, "Codex crashed");
  assert.deepEqual(ids(card), ["close", "go"]);
});

test("E3 an error notice with no pane keeps only the X", () => {
  const card = cardFrom({ level: "error", title: "Disk full", body: "y" }, { panes: [], agents: [], spaces: [] }, 1000, 3);
  assert.equal(card.kind, "error");
  assert.equal(card.key, null);
  assert.deepEqual(ids(card), ["close"]);
  const login = cardFrom({ level: "error", title: "x", body: "devbox needs login; run hc machine login devbox" }, { panes: [pane], agents: [], spaces }, 1000, 4);
  assert.deepEqual(ids(login), ["close", "copy"], "a login card never gets Go to agent");
});
