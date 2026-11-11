// The agent-card toast model (pure): order, replace in place, overflow, heights, placement, wording, timers, relevance, ages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { A, cardFrom, push, remove, order, visible, heightOf, windowSpec, pause, resume, nextExpiry, expired, stillNeeded, ago } from "../mods/herdsidian-toast/stack.js";

const empty = () => ({ v: 1, window: null, expanded: false, cards: [] });
const mk = (o) => ({ id: 1, key: null, kind: "done", login: null, title: "t", sub: "s", letter: "T", icon: null, action: null, at: 0, ttl: A.ttl, expires: A.ttl, left: null, entered: false, leaving: false, ...o });
const sticky = (o) => mk({ ttl: null, expires: null, ...o });
const none = { panes: [], agents: [], spaces: [] };

test("S1 order: sticky first, then newest first", () => {
  const cards = [mk({ id: 1, at: 10 }), sticky({ id: 2, kind: "blocked", at: 5 }), mk({ id: 3, at: 30 }), sticky({ id: 4, kind: "error", at: 20 })];
  assert.deepEqual(order(cards).map((c) => c.id), [4, 2, 3, 1]);
  assert.deepEqual(cards.map((c) => c.id), [1, 2, 3, 4], "input untouched");
});

test("S2 push: same key replaces in place and restarts the timer; no key adds", () => {
  let s = empty();
  s = push(s, mk({ id: 1, key: "p1", at: 0, expires: 5000 }));
  s = push(s, mk({ id: 2, key: "p2", at: 100, expires: 5100 }));
  s = push(s, mk({ id: 3, key: "p1", at: 3000, expires: 8000, sub: "again" }));
  assert.equal(s.cards.length, 2);
  assert.deepEqual(s.cards.map((c) => c.key), ["p2", "p1"], "p1 keeps its (second) place");
  const again = s.cards.find((c) => c.key === "p1");
  assert.equal(again.id, 3);
  assert.equal(again.expires, 8000);
  assert.equal(again.sub, "again");
  const noKey = push(push(empty(), mk({ id: 1 })), mk({ id: 2 }));
  assert.equal(noKey.cards.length, 2);
  assert.equal(noKey.cards[0].id, 2, "newest on top");
  assert.equal(s.cards.length, 2);
});

test("S3 visible: max 3, +N more, expanded shows all and resets when small", () => {
  let s = empty();
  for (let i = 1; i <= 5; i++) s = push(s, mk({ id: i, at: i }));
  assert.equal(visible(s).shown.length, 3);
  assert.equal(visible(s).more, 2);
  const open = { ...s, expanded: true };
  assert.equal(visible(open).shown.length, 5);
  assert.equal(visible(open).more, 0);
  let t = open;
  t = remove(t, 1);
  t = remove(t, 2);
  assert.equal(t.cards.length, 3);
  assert.equal(t.expanded, false, "collapses at <= max");
  const big = remove({ ...s, expanded: true }, 1);
  assert.equal(big.expanded, true, "stays expanded while above max");
  assert.equal(s.cards.length, 5, "no mutation");
});

test("S4 heights: 60 plain, 96 with actions, more 28, gap 8, margin 12 below, width 364", () => {
  assert.equal(heightOf(mk({ kind: "done" })), 60);
  assert.equal(heightOf(mk({ kind: "info" })), 60);
  assert.equal(heightOf(sticky({ kind: "blocked" })), 96);
  assert.equal(heightOf(sticky({ kind: "error", login: "hc machine login x" })), 96);
  assert.equal(heightOf(sticky({ kind: "error" })), 96);
  const one = { ...empty(), cards: [mk({ id: 1 })] };
  assert.equal(windowSpec(one, { vw: 1280, zoom: 1, rightInset: 0 }).height, 60 + 12);
  assert.equal(windowSpec(one, { vw: 1280, zoom: 1, rightInset: 0 }).width, 364);
  const three = { ...empty(), cards: [sticky({ id: 1, kind: "blocked" }), mk({ id: 2 }), mk({ id: 3, kind: "info" })] };
  assert.equal(windowSpec(three, { vw: 1280, zoom: 1, rightInset: 0 }).height, 96 + 60 + 60 + 2 * 8 + 12);
  const five = { ...empty(), cards: [1, 2, 3, 4, 5].map((id) => mk({ id })) };
  assert.equal(windowSpec(five, { vw: 1280, zoom: 1, rightInset: 0 }).height, 3 * 60 + 28 + 3 * 8 + 12);
  assert.equal(windowSpec({ ...five, expanded: true }, { vw: 1280, zoom: 1, rightInset: 0 }).height, 5 * 60 + 4 * 8 + 12);
});

test("S5 windowSpec: card right edge 16 px left of the sidebar or window edge, card top at 60, zoom, clamp, vw fallback", () => {
  const s = { ...empty(), cards: [mk({ id: 1 })] };
  const withSide = windowSpec(s, { vw: 1600, zoom: 1, rightInset: 380 });
  assert.equal(withSide.at.x, 1600 - (380 + 16 + 340 + 12));
  assert.equal(withSide.at.y, 60, "the card's top is the window's top (shadow room is below only)");
  assert.equal(windowSpec(s, { vw: 1600, zoom: 1, rightInset: 0 }).at.x, 1600 - (16 + 340 + 12));
  const z = windowSpec(s, { vw: 2000, zoom: 1.5, rightInset: 100 });
  assert.equal(z.at.x, 2000 - 1.5 * (100 + 16 + 340 + 12));
  assert.equal(z.at.y, 90);
  assert.equal(windowSpec(s, { vw: 200, zoom: 1, rightInset: 380 }).at.x, 0);
  assert.equal(windowSpec(s, { zoom: 1, rightInset: 0 }).at.x, 1280 - (16 + 340 + 12));
  assert.equal(windowSpec(s, { vw: 0, zoom: 1, rightInset: 0 }).at.x, 1280 - (16 + 340 + 12));
});

test("S6 cardFrom kind mapping, ttl and login", () => {
  const d = (props) => cardFrom(props, none, 1000, 7);
  const err = d({ level: "error", title: "x", body: "y" });
  assert.equal(err.kind, "error");
  assert.equal(err.ttl, null);
  assert.equal(err.expires, null);
  const warn = d({ level: "warning", title: "x", body: "y" });
  assert.equal(warn.kind, "blocked");
  assert.equal(warn.ttl, null);
  const ok = d({ level: "success", title: "x", body: "y" });
  assert.equal(ok.kind, "done");
  assert.equal(ok.ttl, 5000);
  assert.equal(ok.expires, 6000);
  assert.equal(ok.at, 1000);
  assert.equal(ok.id, 7);
  assert.equal(ok.entered, false);
  assert.equal(ok.leaving, false);
  assert.equal(ok.left, null);
  const info = d({ level: "info", title: "x", body: "y", timeout: 2500 });
  assert.equal(info.kind, "info");
  assert.equal(info.ttl, 2500);
  assert.equal(info.expires, 3500);
  assert.equal(d({ title: "x", body: "y", timeout: -1 }).ttl, 5000);
  assert.notEqual(d({ title: "t", body: "devbox needs login; run hc machine login other" }).kind, "error", "only the exact sentence is a login");
  const l = d({ title: "t", body: "devbox needs login; run hc machine login devbox" });
  assert.equal(l.kind, "error");
  assert.equal(l.login, "hc machine login devbox");
  assert.equal(l.title, "devbox needs a login");
  assert.equal(l.sub, "Remote machine · its agents are paused");
  assert.equal(l.ttl, null);
  assert.equal(l.key, null);
});

test("S7 cardFrom wording from panes/agents/spaces, fallback to Herdr's text", () => {
  const panes = [{ pane: "p1", tab: "t1", branch: "feat/x", status: "blocked", program: { name: "Codex", icon: "icons/codex.svg", tint: true } },
    { pane: "p2", tab: "t2", branch: "main", status: "done", program: { name: "Claude Code", icon: null, tint: false } }];
  const agents = [{ pane: "p1", space: "s1", space_name: "portfolio2026", status: "blocked" }];
  const spaces = [{ id: "s2", name: "herdsidian", tabs: [{ id: "t2" }] }];
  const data = { panes, agents, spaces };
  const act = (pane) => ({ name: "pane.focus", args: { pane } });
  const b = cardFrom({ level: "warning", title: "codex needs", body: "necesita tu respuesta", action: act("p1") }, data, 0, 1);
  assert.equal(b.kind, "blocked");
  assert.equal(b.title, "Codex needs you");
  assert.equal(b.sub, "portfolio2026 · feat/x");
  assert.equal(b.key, "p1");
  assert.equal(b.letter, "C");
  assert.deepEqual(b.icon, { path: "icons/codex.svg", tint: true });
  assert.deepEqual(b.action, act("p1"));
  const r = cardFrom({ level: "warning", reason: "wants to run npm install", action: act("p1") }, data, 0, 1);
  assert.equal(r.sub, "portfolio2026 · wants to run npm install");
  const dn = cardFrom({ level: "success", title: "claude terminó", body: "", action: act("p2") }, data, 0, 2);
  assert.equal(dn.kind, "done");
  assert.equal(dn.title, "Claude Code finished");
  assert.equal(dn.sub, "herdsidian · main", "space from spaces() by tab when no agent");
  assert.equal(dn.icon, null);
  const st = cardFrom({ title: "claude terminó", body: "", action: act("p1") }, { panes: [{ ...panes[0], status: "blocked" }], agents, spaces }, 0, 3);
  assert.equal(st.kind, "blocked", "the agent's blocked status makes it blocked");
  const fb = cardFrom({ level: "success", title: "claude terminó", body: "en repo", action: act("nope") }, data, 0, 4);
  assert.equal(fb.title, "claude terminó");
  assert.equal(fb.sub, "en repo");
  assert.equal(fb.key, null);
  assert.equal(fb.letter, "C");
  const noAct = cardFrom({ title: "hola", body: "b" }, data, 0, 5);
  assert.equal(noAct.kind, "info");
  assert.equal(noAct.action, null);
  assert.equal(noAct.letter, "H");
});

test("S8 pause/resume keep the time left and are idempotent", () => {
  const c = mk({ at: 0, expires: 5000 });
  const p = pause(c, 2000);
  assert.equal(p.left, 3000);
  assert.equal(pause(p, 4000).left, 3000, "pausing twice keeps the first");
  const r = resume(p, 10000);
  assert.equal(r.expires, 13000);
  assert.equal(r.left, null);
  assert.deepEqual(resume(r, 11000), r, "resume when running is a no-op");
  assert.equal(pause(mk({ expires: 100 }), 500).left, 0, "never negative");
  const s = sticky({ kind: "blocked" });
  assert.deepEqual(pause(s, 100), s);
  assert.equal(c.left, null, "no mutation");
  const cards = [mk({ id: 1, expires: 9000 }), pause(mk({ id: 2, expires: 1000 }), 500), mk({ id: 3, expires: 4000 }), sticky({ id: 4, kind: "error" })];
  assert.equal(nextExpiry(cards), 4000, "paused and sticky cards have no expiry");
  assert.equal(nextExpiry([sticky({ kind: "error" })]), null);
  assert.deepEqual(expired(cards, 4000).map((x) => x.id), [3]);
  assert.deepEqual(expired(cards, 9500).map((x) => x.id), [1, 3]);
});

test("S9 stillNeeded: blocked follows the agent, login follows the machine", () => {
  const blocked = sticky({ kind: "blocked", key: "p1" });
  assert.equal(stillNeeded(blocked, [{ pane: "p1", status: "blocked" }], []), true);
  assert.equal(stillNeeded(blocked, [{ pane: "p1", status: "working" }], []), false);
  assert.equal(stillNeeded(blocked, [{ pane: "p1", status: "idle" }], []), false);
  assert.equal(stillNeeded(blocked, [{ pane: "p2", status: "blocked" }], []), false);
  assert.equal(stillNeeded(blocked, [], []), false);
  const login = sticky({ kind: "error", login: "hc machine login devbox" });
  assert.equal(stillNeeded(login, [], [{ name: "devbox", layout: "unavailable" }]), true);
  assert.equal(stillNeeded(login, [], [{ name: "devbox", layout: "loading" }]), true);
  assert.equal(stillNeeded(login, [], [{ name: "devbox", layout: "ready" }]), false);
  assert.equal(stillNeeded(login, [], []), true);
  assert.equal(stillNeeded(sticky({ kind: "error" }), [], []), true);
  assert.equal(stillNeeded(mk({ kind: "done", key: "p1" }), [], []), true);
});

test("S10 ago: now, seconds, minutes", () => {
  assert.equal(ago(1000, 1000), "now");
  assert.equal(ago(1000, 2900), "now");
  assert.equal(ago(1000, 3000), "2 s");
  assert.equal(ago(0, 59000), "59 s");
  assert.equal(ago(0, 60000), "1 m");
  assert.equal(ago(0, 150000), "2 m");
});
