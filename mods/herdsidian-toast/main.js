// How notifications look in Herdsidian: agent cards stacked in one frameless window at the top right.
// The layout root names this mod ("toast"). Herdr opens the mod in a small host overlay per notice; its init
// (no props().stack) pushes the card into the shared store, opens a fresh stack window and closes the host.
// The stack copy draws the cards and owns the timers. The model lives in stack.js, the card in card-view.js.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { agents, closeOverlay, keys, layout, machines, openOverlay, panes, props, run, setShared, settings, shared, spaces, theme, window as appWindow } from "herdr";
import { A, ago, cardFrom, expired, isSticky, nextExpiry, pause, push, remove, resume, stillNeeded, visible, windowSpec } from "./stack.js";
import { cardView, moreRow } from "./card-view.js";
import { find } from "./layout.js";

const KEY = "herdsidian-toast";
const EMPTY = { v: 1, window: null, expanded: false, cards: [], next: 1 };
const GLYPHS = { cmd: "⌘", shift: "⇧", alt: "⌥", ctrl: "⌃" };

const read = () => { const s = shared(KEY); return s?.v === 1 ? s : EMPTY; };
const save = (s) => setShared(KEY, s);
const update = (fn) => { const s = fn(read()); save(s); return s; };

// The right sidebar's width in layout px: 0 when its block, or a column holding it, is hidden.
function rightInset() {
  const path = (node, id) => {
    if (node?.id === id) return [node];
    for (const child of node?.children ?? []) { const hit = path(child, id); if (hit) return [node, ...hit]; }
    return null;
  };
  const chain = path(layout(), "herdsidian");
  if (!chain || chain.some((n) => n?.hidden)) return 0;
  return find(layout(), "herdsidian")?.size?.px ?? 0;
}

const viewportSide = (side) => {
  const n = globalThis.window?.viewport_size?.()?.[side];
  return typeof n === "number" ? n : undefined;
};

const currentSpec = (s) => windowSpec(s, { vw: viewportSide("width"), vh: viewportSide("height"), zoom: settings()?.zoom ?? 1, rightInset: rightInset() });

// A copy whose window was replaced (or closed) is about to close: its timers must not act.
const replaced = () => read().window?.id !== props()?.overlay;

// Opens the window that fits the cards now, saves it, then closes the old one: no flicker between them.
function sync() {
  const s = read();
  const { shown } = visible(s);
  if (!shown.length) {
    if (s.window) { save({ ...s, window: null }); closeOverlay(s.window.id); }
    return;
  }
  const spec = currentSpec(s);
  const prev = read().window?.id;
  const id = openOverlay({ mod: "herdsidian-toast", kind: "window", frame: "none", ...spec, props: { stack: true } });
  update((cur) => ({ ...cur, window: { id, spec } }));
  if (prev) closeOverlay(prev);
}

// The cap shown on Go to agent: the key bound to next-blocked ("cmd-j" -> "⌘J"), null when unbound.
function goCap() {
  const list = keys();
  const bound = Array.isArray(list) ? list.find((k) => k.action === "guide-agents.next-blocked")?.keys : null;
  if (!bound) return null;
  const parts = bound.split("-");
  return parts.map((p, i) => (i === parts.length - 1 ? p.toUpperCase() : GLYPHS[p] ?? p)).join("");
}

export default class Toast extends View {
  init(initial, cx) {
    const p = initial ?? props() ?? {};
    this.pending = new Set(); // card ids this copy is already finishing
    this.seen = new Set(); // card ids this copy has drawn once
    this.armed = null;
    this.drawn = Date.now();
    if (p.stack) {
      cx.timer.every(1000, (cx) => this.tick(cx));
      this.arm(cx);
      return;
    }
    // Host copy: never forward its own `overlay` prop.
    const s = read();
    const card = cardFrom(p, { panes: panes(), agents: agents(), spaces: spaces() }, Date.now(), s.next ?? 1);
    save({ ...push(s, card), next: (s.next ?? 1) + 1 });
    sync();
    if (typeof p.overlay === "string") closeOverlay(p.overlay); // herdr-app check runs it without one
  }

  // One timer, for the soonest running card; it re-checks the model when it fires.
  arm(cx) {
    const next = nextExpiry(read().cards);
    if (next == null || next === this.armed) return;
    this.armed = next;
    cx.timer.after(Math.max(0, next - Date.now()), (cx) => {
      if (replaced()) return;
      if (this.armed === next) this.armed = null;
      const ids = expired(read().cards, Date.now()).map((c) => c.id);
      if (ids.length) this.leave(ids, cx);
      this.arm(cx);
    });
  }

  // Marks the cards leaving (they fade out), then removes them and reopens the window.
  leave(ids, cx) {
    const fresh = ids.filter((id) => !this.pending.has(id));
    if (!fresh.length) return;
    const t = Date.now();
    update((s) => ({ ...s, cards: s.cards.map((c) => (fresh.includes(c.id) ? { ...c, leaving: true, leavingAt: t } : c)) }));
    cx.notify();
    this.finish(fresh, A.leave, cx);
  }

  // Removes the cards after `delay` ms and reopens the window.
  finish(ids, delay, cx) {
    ids.forEach((id) => this.pending.add(id));
    cx.timer.after(delay, (cx) => {
      if (replaced()) return;
      update((s) => ids.reduce(remove, s));
      ids.forEach((id) => this.pending.delete(id));
      sync();
      cx.notify();
    });
  }

  // Cards left fading by a replaced window: this copy ends the fade (the time left of it, or at once when it is over).
  finishLeaving(cx) {
    if (replaced()) return;
    const t = Date.now();
    read().cards.filter((c) => c.leaving && !this.pending.has(c.id)).forEach((c) => {
      this.finish([c.id], Math.max(0, A.leave - (t - (c.leavingAt ?? t))), cx);
    });
  }

  // Herdr inactive: timed cards pause; active again: they resume (unless hovered). Redraws the age labels that changed.
  tick(cx) {
    if (replaced()) return;
    const s = read(), t = Date.now();
    const active = appWindow()?.active !== false;
    const cards = s.cards.map((c) => (active ? (s.hover === c.id ? c : resume(c, t)) : pause(c, t)));
    if (cards.some((c, i) => c !== s.cards[i])) { save({ ...s, cards }); this.armed = null; this.arm(cx); }
    if (cards.some((c) => ago(c.at, t) !== ago(c.at, this.drawn))) cx.notify();
    this.resync(read(), cx);
  }

  // Reopens the window when the one the cards need now differs from the opened one (a resize, a sidebar change).
  resync(s, cx) {
    if (this.resyncing || !s.window || JSON.stringify(currentSpec(s)) === JSON.stringify(s.window.spec)) return;
    this.resyncing = true;
    cx.timer.after(0, (cx) => {
      this.resyncing = false;
      if (replaced()) return;
      sync();
      cx.notify();
    });
  }

  // `cx` is the hover callback's own; a host that gives none still gets the pause.
  hovered(id, on, cx) {
    const t = Date.now();
    update((s) => ({
      ...s,
      hover: on ? id : s.hover === id ? null : s.hover,
      cards: s.cards.map((c) => (c.id === id ? (on ? pause(c, t) : resume(c, t)) : c)),
    }));
    this.armed = null;
    if (cx) this.arm(cx);
  }

  dismiss(id, cx) {
    update((s) => remove(s, id));
    sync();
    cx.notify();
  }

  goTo(card, cx) {
    if (card.action?.name) run(card.action.name, card.action.args ?? {});
    else if (card.key) run("pane.focus", { pane: card.key });
    else run("agent.next", {});
    this.dismiss(card.id, cx);
  }

  // What render may not do itself: schedules it with a zero timer.
  watch(s, cx) {
    if (replaced()) return; // an old window about to close
    const gone = s.cards.filter((c) => isSticky(c) && !c.leaving && !this.pending.has(c.id) && !stillNeeded(c, agents(), machines())).map((c) => c.id);
    if (gone.length) cx.timer.after(0, (cx) => { if (!replaced()) this.leave(gone, cx); });
    this.finishLeaving(cx);
    this.resync(s, cx);
    if (!this.entering && s.cards.some((c) => !c.entered)) {
      this.entering = true;
      cx.timer.after(30, (cx) => {
        this.entering = false;
        if (replaced()) return;
        update((cur) => ({ ...cur, cards: cur.cards.map((c) => (c.entered ? c : { ...c, entered: true })) }));
        cx.notify();
      });
    }
  }

  // A card drawn for the first time by this copy keeps its timer line at the time left; the next render slides it to 0.
  redrawFresh(cx) {
    if (this.redrawing) return;
    this.redrawing = true;
    cx.timer.after(30, (cx) => {
      this.redrawing = false;
      if (!replaced()) cx.notify();
    });
  }

  render(cx) {
    const p = props() ?? {};
    if (!p.stack) return div();
    const s = read(), t = theme(), now = Date.now();
    this.watch(s, cx);
    const { shown, more } = visible(s);
    const cap = goCap();
    // Every handler uses the cx its own callback gets: this render's cx is gone when it runs.
    const cards = shown.map((card) => {
      const handlers = {
        onGo: (c) => this.goTo(card, c),
        onClose: (c) => this.dismiss(card.id, c),
        onCopy: (c) => {
          c.write_to_clipboard(card.login);
          update((cur) => ({ ...cur, cards: cur.cards.map((x) => (x.id === card.id ? { ...x, copied: true } : x)) }));
          c.notify();
        },
        onOpen: (c) => {
          if (card.kind !== "done" && card.kind !== "info") return;
          if (card.action?.name) run(card.action.name, card.action.args ?? {});
          this.dismiss(card.id, c);
        },
        onHover: (on, c) => this.hovered(card.id, on, c),
      };
      const fresh = !this.seen.has(card.id);
      this.seen.add(card.id);
      if (fresh && card.ttl != null) this.redrawFresh(cx);
      return div().flex_none().w_full().child(cardView(card, t, handlers, now, { copied: !!card.copied, cap, agoText: ago(card.at, now), fresh }));
    });
    this.drawn = now;
    const root = v_flex().id("toast-stack").size_full().gap(A.gap).px(A.margin).pb(A.margin)
      .on_mouse_down("left", (_e, c) => c.stop_propagation());
    if (s.expanded) root.overflow_y_scrollbar();
    cards.forEach((card) => root.child(card));
    if (more > 0) {
      root.child(div().flex_none().w_full().child(moreRow(more, t, (c) => {
        update((cur) => ({ ...cur, expanded: true }));
        sync();
        c.notify();
      })));
    }
    return root;
  }

  // The stack window closed (a layout switch closes windows): drop the timed cards, keep the sticky ones.
  async close() {
    const p = props();
    if (!p?.stack) return;
    const s = read();
    if (s.window?.id === p.overlay) save({ ...s, window: null, cards: s.cards.filter(isSticky) });
  }
}
