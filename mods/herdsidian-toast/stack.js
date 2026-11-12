// The agent-card toast model: cards, order, overflow, sizes, placement, timers and relevance.
// Pure (no herdr, gpui-kit or gpui-base import), so Node tests import it. Every function returns new objects.
// Spec: the SPEC (A) block of herdsidian-toasts-a-reference.html.

// Sizes in px. width is the card; the window adds `margin` on each side (and below) for the card's shadow.
export const A = { width: 340, top: 60, gap: 8, max: 3, ttl: 5000, margin: 12, enter: 160, leave: 120, cardPlain: 60, more: 28 };

const LOGIN = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/;

// Sticky cards stay until acted on; they get the X at the left (and Go to agent or Copy at the right).
export const isSticky = (c) => c.kind === "blocked" || c.kind === "error";

// Sticky first, then newest first (ties: higher id first).
export function order(cards) {
  return [...cards].sort((a, b) => Number(isSticky(b)) - Number(isSticky(a)) || b.at - a.at || b.id - a.id);
}

// The card the toast shows for one Herdr notice. `props` is the notice ({ level, title, body, timeout, action, reason? }).
// `nextId` is the new card's id (a number, or a function returning one).
export function cardFrom(props, { panes = [], agents = [], spaces = [] }, now, nextId) {
  const id = typeof nextId === "function" ? nextId() : nextId;
  const base = { id, at: now, left: null, entered: false, leaving: false, login: null, icon: null, action: null };
  const finish = (card) => {
    const sticky = isSticky(card);
    const t = props.timeout;
    const ttl = sticky ? null : typeof t === "number" && t > 0 ? t : A.ttl;
    return { ...base, ...card, ttl, expires: ttl == null ? null : now + ttl };
  };
  const login = LOGIN.exec(props.body ?? "");
  if (login) {
    return finish({ key: null, kind: "error", login: `hc machine login ${login[1]}`, title: `${login[1]} needs a login`,
      sub: "Remote machine · its agents are paused", letter: login[1][0].toUpperCase() });
  }
  const action = props.action?.name ? { name: props.action.name, args: props.action.args ?? {} } : null;
  // Herdr's own agent notices go through agent.focus {terminal}; a mod's may use pane.focus {pane}.
  const terminal = action?.name === "agent.focus" ? action.args.terminal : null;
  const paneId = action?.name === "pane.focus" ? action.args.pane
    : terminal ? (panes.find((p) => p.terminal === terminal) ?? agents.find((a) => a.address === terminal))?.pane ?? null : null;
  const pane = paneId ? panes.find((p) => p.pane === paneId) : null;
  const level = props.level;
  if (!pane) {
    const kind = level === "error" ? "error" : level === "warning" ? "blocked" : level === "success" ? "done" : "info";
    const title = props.title ?? "";
    return finish({ key: null, kind, title, sub: props.body ?? "", letter: (title[0] ?? "?").toUpperCase(), action });
  }
  const agent = agents.find((a) => a.pane === paneId);
  const program = pane.program ?? agent?.program ?? null;
  const name = program?.name ?? pane.app ?? agent?.app ?? pane.title ?? "";
  const status = agent?.status ?? pane.status;
  const space = agent?.space_name
    ?? spaces.find((s) => s.id === agent?.space)?.name
    ?? spaces.find((s) => s.tabs?.some((t) => t.id === pane.tab))?.name ?? "";
  const line = (tail) => [space, tail].filter(Boolean).join(" · ");
  // A blocked agent wins over the level: Herdr posts its "needs you" notice as an error.
  const kind = status === "blocked" ? "blocked" : level === "error" ? "error" : level === "warning" ? "blocked"
    : level === "success" || status === "done" ? "done" : "info";
  const title = kind === "blocked" ? `${name} needs you` : kind === "done" ? `${name} finished` : props.title ?? name;
  const sub = kind === "blocked" ? line(props.reason || pane.branch) : kind === "done" ? line(pane.branch) : props.body ?? "";
  return finish({ key: paneId, kind, title, sub, letter: (name[0] ?? title[0] ?? "?").toUpperCase(), action,
    icon: program?.icon ? { path: program.icon, tint: !!program.tint } : null });
}

const settle = (store, cards) => ({ ...store, cards, expanded: cards.length > A.max ? store.expanded : false });

// A card with the same key (the pane) takes the old one's place and restarts its timer; else it goes on top of its group.
// Cards are kept sticky-first, newest first, without re-sorting by time, so a replaced card does not move.
export function push(store, card) {
  // A login card has no pane: the same machine's command is its key.
  const same = (c) => (card.key ? c.key === card.key : !!card.login && c.login === card.login);
  const i = card.key || card.login ? store.cards.findIndex(same) : -1;
  if (i >= 0) {
    const cards = store.cards.map((c, n) => (n === i ? card : c));
    // A card that turns sticky (or stops being) changes group, so it moves with its group.
    return settle(store, isSticky(card) === isSticky(store.cards[i]) ? cards : [...cards.filter(isSticky), ...cards.filter((c) => !isSticky(c))]);
  }
  const all = [card, ...store.cards];
  return settle(store, [...all.filter(isSticky), ...all.filter((c) => !isSticky(c))]);
}

export const remove = (store, id) => settle(store, store.cards.filter((c) => c.id !== id));

export function visible(store) {
  const shown = store.expanded ? store.cards : store.cards.slice(0, A.max);
  return { shown, more: store.cards.length - shown.length };
}

export const heightOf = () => A.cardPlain; // every card is one row: buttons sit inline

// The overlay window, in the app's pixels. The card's right edge sits 16 px left of the right sidebar (or of the window edge
// when `rightInset` is 0); the window is `margin` wider on each side, so x subtracts `margin` too.
// The card starts at the window's top, so y = zoom * top; `margin` is shadow room at the sides and below only.
// x and y scale with `zoom`; width and height are the window's own size. Expanded, the height stops 100 short of the viewport
// height `vh` (the list scrolls).
export function windowSpec(store, { vw, vh, zoom = 1, rightInset = 0 } = {}) {
  const { shown, more } = visible(store);
  const items = shown.map(heightOf).concat(more > 0 ? [A.more] : []);
  let height = items.length ? items.reduce((a, b) => a + b, 0) + (items.length - 1) * A.gap + A.margin : 0;
  if (store.expanded && vh > 0) height = Math.min(height, Math.max(vh / zoom - 100, A.cardPlain + A.margin));
  const width = vw > 0 ? vw : 1280;
  const x = Math.max(0, width - zoom * (rightInset + 16 + A.width + A.margin));
  return { at: { x, y: zoom * A.top }, width: A.width + 2 * A.margin, height };
}

// Timed cards keep the time left while paused (hover, or Herdr not the active window). Both are idempotent.
export function pause(card, now) {
  if (card.expires == null || card.left != null) return card;
  return { ...card, left: Math.max(0, card.expires - now) };
}

export function resume(card, now) {
  if (card.left == null) return card;
  return { ...card, expires: now + card.left, left: null };
}

const running = (c) => c.expires != null && c.left == null && !c.leaving;

export function nextExpiry(cards) {
  const times = cards.filter(running).map((c) => c.expires);
  return times.length ? Math.min(...times) : null;
}

export const expired = (cards, now) => cards.filter((c) => running(c) && c.expires <= now);

// Does the card's reason still hold? Blocked: the agent is still blocked (a card with no pane has nothing to follow).
// Login: its machine is not ready yet, or Herdr does not know it (when it lists machines at all).
export function stillNeeded(card, agents, machines) {
  if (card.kind === "blocked") return !card.key || agents.some((a) => a.pane === card.key && a.status === "blocked");
  if (card.login) {
    const name = card.login.split(" ").pop();
    const known = machines.find((m) => m.name === name);
    return machines.length === 0 || (!!known && known.layout !== "ready");
  }
  return true;
}

export function ago(at, now) {
  const s = Math.floor((now - at) / 1000);
  return s < 2 ? "now" : s < 60 ? `${s} s` : `${Math.floor(s / 60)} m`;
}
