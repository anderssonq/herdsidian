// The agent card of herdsidian-toast: gpui view helpers, no state. The model (stack.js) decides what shows;
// main.js passes the card, the handlers and the clock in. Numbers follow the SPEC (A) block of the reference.
import { div, svg, image } from "gpui-kit";
import { RADIUS, alpha } from "./tokens.js";
import { alertMark } from "./ui.js";
import { A, heightOf, isSticky } from "./stack.js";

const PAD_X = 14;
const TIMER_FULL = A.width - 2 * PAD_X; // the timer line runs inset 14 on each side
const MONO = "Menlo";
const ENTER = { duration: A.enter, easing: "ease-out" };
const LEAVE = { duration: A.leave, easing: "ease-in" };

// Runs `fn` with the click's own cx for a click that stops there: a button never also opens the card.
const press = (fn) => (_event, cx) => { cx.stop_propagation(); fn(cx); };

// The 24 px tile: the program icon or its letter, with the status badge at its bottom-right.
function tile(card, t) {
  const base = div().id(`toast-tile-${card.id}`).size(24).flex_none().rounded(7).flex().items_center().justify_center();
  if (card.kind === "error") {
    return base.bg(alpha(t.blocked, 0.15)).child(svg(`mods/herdsidian-toast/${card.login ? "key" : "alert"}.svg`).size(13).text_color(t.blocked));
  }
  if (card.kind === "info") {
    return base.bg(alpha(t.accent, 0.18)).text_size(12).font_weight(700).text_color(t.accent).child("i");
  }
  const glyph = card.icon
    ? (card.icon.tint ? svg(card.icon.path).size(14).flex_none().text_color(t.muted) : image(card.icon.path).w(14).h(14).flex_none())
    : div().text_size(12).font_weight(600).text_color(t.muted).child(card.letter ?? "");
  const ring = card.kind === "blocked"
    ? div().size(16).right(-6).bottom(-6).child(alertMark(t, 12, t.popover))
    : div().size(12).right(-4).bottom(-4).child(div().size(8).rounded_full().bg(t.done));
  return base.relative().bg(alpha(t.foreground, 0.1)).child(glyph)
    .child(ring.id(`toast-badge-${card.id}`).absolute().rounded_full().bg(t.popover).flex().items_center().justify_center());
}

// The X at the far left of a sticky card: it dismisses the card. Muted, lit on hover.
const closeButton = (card, t, onClose) => div().id(`toast-close-${card.id}`).flex_none().size(20).rounded(RADIUS.control)
  .flex().items_center().justify_center().text_color(t.muted).cursor_pointer().tooltip("Dismiss")
  .hover((s) => s.bg(alpha(t.foreground, 0.08)).text_color(t.foreground)).on_click(press(onClose))
  .child(svg("mods/herdsidian-toast/close.svg").size(12));

// The primary button, inline at the right of the card, with its key cap when `cap` is a string.
function goButton(card, t, onGo, cap) {
  const button = div().id(`toast-go-${card.id}`).flex_none().h(24).pl(9).pr(cap ? 4 : 9).gap(6).rounded(RADIUS.control).bg(t.solid)
    .flex().items_center().text_size(12).font_weight(600).text_color(t.solid_foreground).cursor_pointer().on_click(press(onGo)).child("Go to agent");
  return cap === null ? button : button.child(div().flex_none().h(16).px(4).rounded(4).border(1).border_color(alpha(t.solid_foreground, 0.25))
    .flex().items_center().text_size(10).font_weight(500).child(cap));
}

// Copies the login command, inline at the right of a login card.
const copyButton = (card, t, onCopy, copied) => div().id(`toast-copy-${card.id}`).flex_none().h(24).px(9).rounded(RADIUS.control).bg(t.raised)
  .flex().items_center().text_size(12).text_color(t.foreground).cursor_pointer().on_click(press(onCopy)).child(copied ? "Copied" : "Copy");

// The inline button at the right: null when the card has none.
function inlineButton(card, t, handlers, opts) {
  if (card.login) return copyButton(card, t, handlers.onCopy, opts.copied);
  if (isSticky(card) && card.key) return goButton(card, t, handlers.onGo, opts.cap ?? null); // no pane: nowhere to go
  return null;
}

// The 2 px timer line on a timed card. Running: it draws the time left, then slides to 0 over that time
// (the target changes on the render after the card entered, and after a copy's first render of it: `fresh`).
// Paused: a fixed width, no transition.
function timerLine(card, t, now, fresh) {
  const left = card.left ?? Math.max(0, card.expires - now);
  const fraction = Math.min(1, left / card.ttl);
  const paused = card.left != null;
  const sliding = !paused && card.entered && !fresh;
  const fill = div().id(`toast-timer-fill-${card.id}`).absolute().top(0).left(0).h(2).bg(t.accent).w(sliding ? 0 : TIMER_FULL * fraction);
  return div().id(`toast-timer-${card.id}`).absolute().bottom(0).left(PAD_X).right(PAD_X).h(2).bg(alpha(t.accent, 0.12)).overflow_hidden()
    .child(paused ? fill : fill.transition("width", { duration: Math.max(1, left), easing: "linear" }));
}

// One card. `opts`: { copied, cap (string or null: hidden), agoText, fresh (first render in this window copy) }.
// The root's height is the one stack.js counts for the window, so a card never gets clipped.
export function cardView(card, t, handlers, now, opts) {
  const button = inlineButton(card, t, handlers, opts);
  // The time never truncates. With a button at the right the title gets the room and the time ends the second line.
  const ago = div().id(`toast-ago-${card.id}`).flex_none().text_size(11).text_color(t.muted).child(opts.agoText);
  const title = div().flex().items_baseline().gap(6)
    .child(div().flex_1().min_w_0().truncate().text_size(13).font_weight(600).text_color(t.foreground).child(card.title))
    .when(button === null, (el) => el.child(ago));
  // A login card shows its command on the second line, where the Copy button next to it can be read.
  const text = card.login
    ? div().id(`toast-code-${card.id}`).flex_1().min_w_0().truncate().font_family(MONO).text_size(11.5).text_color(t.foreground).tooltip(card.sub).child(card.login)
    : div().id(`toast-sub-${card.id}`).flex_1().min_w_0().truncate().text_size(12).text_color(t.muted).tooltip(card.sub).child(card.sub);
  const sub = div().flex().items_baseline().gap(6).child(text).when(button !== null, (el) => el.child(ago));
  const lines = div().flex_1().min_w_0().flex().flex_col().gap(2).child(title).child(sub);
  const main = div().flex().items_center().gap(10)
    .when(isSticky(card), (el) => el.child(closeButton(card, t, handlers.onClose)))
    .child(tile(card, t)).child(lines)
    .when(button !== null, (el) => el.child(button));
  return div().id(`toast-card-${card.id}`).relative().w_full().h(heightOf(card)).flex().flex_col().justify_center().px(PAD_X).py(12)
    .rounded(RADIUS.overlay).bg(t.popover).border(1).border_color(alpha(t.foreground, 0.07)).shadow_xl().overflow_hidden().cursor_pointer()
    .top(card.entered ? 0 : -8).opacity(card.entered && !card.leaving ? 1 : 0)
    .transition("top", ENTER).transition("opacity", card.leaving ? LEAVE : ENTER)
    .on_hover((hovered, cx) => handlers.onHover(hovered, cx))
    .on_click((_event, cx) => handlers.onOpen(cx))
    .child(main)
    .when(card.ttl != null, (el) => el.child(timerLine(card, t, now, opts.fresh)));
}

// The "+N more" row under the third card.
export const moreRow = (n, t, onExpand) => div().id("toast-more").w_full().h(A.more).rounded(RADIUS.card).bg(alpha(t.foreground, 0.06))
  .flex().items_center().justify_center().text_size(12).text_color(t.muted).cursor_pointer().on_click(press(onExpand)).child(`+${n} more`);
