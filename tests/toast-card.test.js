// The toast agent card (view only): tile and badge per kind, the actions, the timer line, the motion and the colors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { element, fakeCx, findById, walk } from "./support/mod-stubs.js";

globalThis.__herdsidianStubs["gpui-kit"].image = (path) => element("image", path);

const { cardView, moreRow } = await import("../mods/herdsidian-toast/card-view.js");
const { alpha, RADIUS } = await import("../mods/herdsidian-toast/tokens.js");

const T = { foreground: "#eeeeee", background: "#111111", popover: "#202020", solid: "#dddddd", solid_foreground: "#101010", done: "#00cc66",
  blocked: "#ffaa00", accent: "#ff00aa", muted: "#999999", chrome: "#222222", canvas: "#333333", raised: "#2a2a2a", dim: "#555555", ansi5: "#aa00ff" };
const NOW = 100000;
const card = (over = {}) => ({ id: 7, key: "pane-1", kind: "done", login: null, title: "Claude Code finished", sub: "herdsidian · feat/x", letter: "C",
  icon: null, action: null, at: NOW, ttl: 5000, expires: NOW + 5000, left: null, entered: true, leaving: false, ...over });
const handlers = () => {
  const log = [];
  return { log, onGo: () => log.push("go"), onLater: () => log.push("later"), onCopy: () => log.push("copy"), onOpen: () => log.push("open"), onHover: (h) => log.push(`hover:${h}`) };
};
const OPTS = { copied: false, cap: "⌘J", agoText: "now" };
const view = (c, opts = {}, h = handlers()) => cardView(c, T, h, NOW, { ...OPTS, ...opts });

const args = (node, name) => node.calls.filter(([n]) => n === name).map(([, a]) => a);
const has = (node, name, ...want) => args(node, name).some((a) => want.every((w, i) => a[i] === w));
const texts = (node, out = []) => {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object" && "kids" in node) node.kids.forEach((k) => texts(k, out));
  return out;
};
const click = (node, cx = fakeCx()) => { let stopped = 0; cx.stop_propagation = () => { stopped++; }; node.onClick({}, cx); return stopped; };

test("C1 the tile and the badge follow the kind", () => {
  const done = view(card());
  const tile = findById(done, "toast-tile-7");
  assert.ok(has(tile, "bg", alpha(T.foreground, 0.1)));
  assert.ok(has(tile, "rounded", 7));
  assert.ok(texts(tile).includes("C"));
  const ring = findById(done, "toast-badge-7");
  assert.ok(has(ring, "bg", T.popover));
  assert.ok(has(ring, "size", 12));
  assert.ok(walk(ring).some((n) => has(n, "size", 8) && has(n, "bg", T.done)));

  const blocked = view(card({ kind: "blocked", ttl: null, expires: null }));
  const bring = findById(blocked, "toast-badge-7");
  assert.ok(has(bring, "bg", T.popover));
  assert.ok(has(bring, "size", 16));
  assert.ok(walk(bring).some((n) => has(n, "size", 12) && has(n, "bg", T.blocked) && texts(n).includes("!")));

  const login = view(card({ kind: "error", login: "hc machine login devbox", ttl: null, expires: null }));
  assert.ok(has(findById(login, "toast-tile-7"), "bg", alpha(T.blocked, 0.15)));
  assert.equal(findById(login, "toast-badge-7"), null);
  const key = walk(login).find((n) => n.kind === "svg");
  assert.match(key.arg, /key\.svg$/);
  assert.ok(has(key, "text_color", T.blocked));
  const plain = view(card({ kind: "error", ttl: null, expires: null }));
  assert.match(walk(plain).find((n) => n.kind === "svg").arg, /alert\.svg$/);

  const info = view(card({ kind: "info" }));
  assert.ok(has(findById(info, "toast-tile-7"), "bg", alpha(T.accent, 0.18)));
  assert.ok(texts(findById(info, "toast-tile-7")).includes("i"));
  assert.ok(walk(findById(info, "toast-tile-7")).some((n) => has(n, "text_color", T.accent)));
  assert.equal(findById(info, "toast-badge-7"), null);

  const tinted = view(card({ icon: { path: "icons/claude.svg", tint: true } }));
  const glyph = walk(findById(tinted, "toast-tile-7")).find((n) => n.kind === "svg");
  assert.equal(glyph.arg, "icons/claude.svg");
  assert.ok(has(glyph, "text_color", T.muted));
  const picture = view(card({ icon: { path: "icons/codex.png", tint: false } }));
  assert.ok(walk(findById(picture, "toast-tile-7")).some((n) => n.kind === "image" && n.arg === "icons/codex.png"));
  assert.ok(!texts(findById(picture, "toast-tile-7")).includes("C"));
});

test("C2 the actions follow the kind; the cap hides without a key; Copy turns into Copied", () => {
  const h = handlers();
  const blocked = view(card({ kind: "blocked", ttl: null, expires: null }), {}, h);
  const go = findById(blocked, "toast-go-7");
  assert.ok(has(go, "bg", T.solid) && has(go, "h", 26) && has(go, "text_color", T.solid_foreground));
  assert.ok(texts(go).includes("Go to agent") && texts(go).includes("⌘J"));
  assert.ok(walk(go).some((n) => has(n, "h", 16) && has(n, "border_color", alpha(T.solid_foreground, 0.25))));
  const later = findById(blocked, "toast-later-7");
  assert.ok(has(later, "bg", alpha(T.foreground, 0.06)) && has(later, "text_color", T.muted));
  assert.ok(texts(later).includes("Later"));
  assert.equal(click(go), 1);
  assert.equal(click(later), 1);
  assert.deepEqual(h.log, ["go", "later"]);

  const noKey = view(card({ kind: "blocked", ttl: null, expires: null }), { cap: null });
  assert.deepEqual(texts(findById(noKey, "toast-go-7")), ["Go to agent"]);

  const login = view(card({ kind: "error", login: "hc machine login devbox", ttl: null, expires: null }), {}, h);
  const code = findById(login, "toast-code-7");
  assert.ok(texts(code).includes("hc machine login devbox"));
  assert.ok(has(code, "bg", T.background) && has(code, "h", 26) && has(code, "border_color", alpha(T.foreground, 0.07)));
  assert.ok(has(code, "text_size", 11.5));
  const copy = findById(login, "toast-copy-7");
  assert.ok(has(copy, "bg", T.raised));
  assert.deepEqual(texts(copy), ["Copy"]);
  h.log.length = 0;
  assert.equal(click(copy), 1);
  assert.deepEqual(h.log, ["copy"]);
  const copied = view(card({ kind: "error", login: "x", ttl: null, expires: null }), { copied: true });
  assert.deepEqual(texts(findById(copied, "toast-copy-7")), ["Copied"]);
  assert.equal(findById(login, "toast-dismiss-7"), null);

  const err = view(card({ kind: "error", ttl: null, expires: null }), {}, h);
  const dismiss = findById(err, "toast-dismiss-7");
  assert.ok(texts(dismiss).includes("Dismiss"));
  assert.equal(findById(err, "toast-copy-7"), null);
  assert.equal(findById(err, "toast-go-7"), null);

  for (const kind of ["done", "info"]) {
    const t = view(card({ kind }));
    for (const id of ["go", "later", "copy", "dismiss"]) assert.equal(findById(t, `toast-${id}-7`), null);
  }
});

test("C3 the timer line exists on timed cards only and stands still while paused", () => {
  const FULL = 340 - 28;
  assert.equal(findById(view(card({ kind: "blocked", ttl: null, expires: null })), "toast-timer-7"), null);
  assert.equal(findById(view(card({ kind: "error", ttl: null, expires: null })), "toast-timer-7"), null);

  const running = view(card({ expires: NOW + 2000 }));
  const track = findById(running, "toast-timer-7");
  assert.ok(has(track, "h", 2) && has(track, "bottom", 0) && has(track, "left", 14) && has(track, "right", 14));
  assert.ok(has(track, "bg", alpha(T.accent, 0.12)));
  const fill = findById(running, "toast-timer-fill-7");
  assert.ok(has(fill, "bg", T.accent));
  const tr = args(fill, "transition").find(([prop]) => prop === "width");
  assert.deepEqual(tr[1], { duration: 2000, easing: "linear" });
  assert.deepEqual(args(fill, "w").at(-1), [0]);

  const paused = view(card({ left: 2000, expires: NOW + 9999 }));
  const frozen = findById(paused, "toast-timer-fill-7");
  assert.deepEqual(args(frozen, "w").at(-1), [FULL * 0.4]);
  assert.equal(args(frozen, "transition").length, 0);
});

test("C4 only a card that has not entered yet starts off-screen; leaving fades", () => {
  const fresh = view(card({ entered: false }));
  assert.ok(has(fresh, "top", -8) && has(fresh, "opacity", 0));
  const settled = view(card({ entered: true }));
  assert.ok(has(settled, "top", 0) && has(settled, "opacity", 1));
  assert.ok(!has(settled, "top", -8) && !has(settled, "opacity", 0));
  for (const prop of ["top", "opacity"]) {
    const t = args(settled, "transition").find(([p]) => p === prop);
    assert.deepEqual(t[1], { duration: 160, easing: "ease-out" });
  }
  const leaving = view(card({ leaving: true }));
  assert.ok(has(leaving, "opacity", 0));
  assert.deepEqual(args(leaving, "transition").filter(([p]) => p === "opacity").at(-1)[1], { duration: 120, easing: "ease-in" });
});

test("C5 colors come from the theme through alpha(), and the lint passes", () => {
  const source = readFileSync(new URL("../mods/herdsidian-toast/card-view.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b/i);
  const used = new Set();
  for (const kind of ["done", "blocked", "error", "info"]) {
    for (const c of [card({ kind }), card({ kind, login: "x" })]) {
      for (const n of walk(view(c))) for (const [name, a] of n.calls) {
        if (/color$|^bg$/.test(name) && typeof a[0] === "string") used.add(a[0]);
      }
    }
  }
  const allowed = new Set([...Object.values(T), ...Object.values(T).flatMap((v) => [.06, .07, .1, .12, .15, .18, .25, .35].map((x) => alpha(v, x)))]);
  for (const color of used) assert.ok(allowed.has(color), `${color} is not a theme token`);
  const more = moreRow(3, T, () => {});
  assert.ok(has(more, "bg", alpha(T.foreground, 0.06)) && has(more, "rounded", RADIUS.card) && has(more, "h", 28));
  assert.deepEqual(texts(more), ["+3 more"]);
  const hover = handlers();
  const root = view(card(), {}, hover);
  args(root, "on_hover")[0][0](true, fakeCx());
  click(root);
  assert.deepEqual(hover.log, ["hover:true", "open"]);
  assert.ok(has(findById(view(card()), "toast-card-7"), "rounded", RADIUS.overlay));
  assert.equal(findById(more, "toast-more") === more, true);
  execFileSync(process.execPath, ["scripts/lint.js"], { stdio: "pipe" });
});
