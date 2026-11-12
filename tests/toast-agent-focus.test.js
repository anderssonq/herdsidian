// Herdr posts its "needs you" notice with action agent.focus {terminal}, not pane.focus {pane}.
// The card finds the pane through that terminal, so it reads as needs-you with Go to agent.
import { test } from "node:test";
import assert from "node:assert/strict";

const { cardFrom, stillNeeded } = await import("../mods/herdsidian-toast/stack.js");

const pane = { pane: "p3", terminal: "t3", app: "codex", program: { name: "Codex" }, branch: "feat/x", tab: "t1" };
const spaces = [{ id: "s1", name: "acme-api", tabs: [{ id: "t1" }] }];
const notice = { level: "error", title: "Codex needs you", body: "acme-api / 2", action: { name: "agent.focus", args: { terminal: "t3" } } };

test("A1 agent.focus {terminal} finds the pane: a blocked agent is a needs-you card with its key", () => {
  const card = cardFrom(notice, { panes: [pane], agents: [{ pane: "p3", address: "t3", status: "blocked" }], spaces }, 1000, 1);
  assert.equal(card.kind, "blocked");
  assert.equal(card.key, "p3");
  assert.equal(card.title, "Codex needs you");
  assert.deepEqual(card.action, { name: "agent.focus", args: { terminal: "t3" } }, "Go to agent runs Herdr's own action");
  assert.equal(stillNeeded(card, [{ pane: "p3", status: "idle" }], []), false, "it leaves once the agent is unblocked");
});

test("A2 the terminal can also be matched through agents() when panes() has no terminal field", () => {
  const bare = { ...pane, terminal: undefined };
  const card = cardFrom(notice, { panes: [bare], agents: [{ pane: "p3", address: "t3", status: "blocked" }], spaces }, 1000, 2);
  assert.equal(card.key, "p3");
  assert.equal(card.kind, "blocked");
});

test("A3 an unknown terminal keeps the card paneless: error with only the X", () => {
  const card = cardFrom({ ...notice, action: { name: "agent.focus", args: { terminal: "t9" } } }, { panes: [pane], agents: [], spaces }, 1000, 3);
  assert.equal(card.key, null);
  assert.equal(card.kind, "error");
});
