// The Usage control in the status bar and its hover card. Colors come from theme() and tokens.js (ADR-0001).
import { div } from "gpui-kit";
import { h_flex, v_flex, HoverCard } from "gpui-base";
import { RADIUS } from "./tokens.js";
import { alertMark, icon } from "./ui.js";
import { EMPTY_FAILED, EMPTY_NONE, errorText, formatAge, windowView } from "./usage.js";
import { formatTokens } from "./agent-files.js";
import { GROK_NOTE, formatUsd, twoDecimals } from "./usage-month.js";
import { reading } from "./usage-status.js";

const BAR_WIDTH = 56;

// A thin bar: track in accentTrack, fill in accent, as wide as the percent.
const bar = (t, k, percent) => div().w(BAR_WIDTH).h(4).flex_none().rounded_full().bg(k.accentTrack).overflow_hidden()
  .child(div().h(4).w(`${percent}%`).bg(t.accent));

const row = (t, k, w, now, zeroPast) => {
  const v = windowView(w, now, zeroPast);
  return h_flex().gap(8).items_center().text_size(12)
    .child(div().w(28).flex_none().text_color(t.muted).child(v.label))
    .child(div().w(34).flex_none().child(v.percentText))
    .child(bar(t, k, v.percent))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(v.resetText));
};

const note = (t, text) => div().text_size(12).text_color(t.muted).child(text);

// A label and its value; `width` is the label column.
const line = (t, label, value, width = 44) => h_flex().gap(8).text_size(12).child(div().w(width).flex_none().text_color(t.muted).child(label)).child(div().child(value));

// What one provider shows under its name.
function body(t, k, key, entry, now) {
  if (entry.state === "loading") return [note(t, "Loading…")];
  if (entry.state === "error") return [note(t, errorText(entry.error))];
  const d = entry.data;
  if (d.kind === "stats") {
    return [note(t, "Last 7 days, no usage limits"), line(t, "Cost", d.cost), line(t, "Input", d.input), line(t, "Output", d.output)];
  }
  if (d.kind === "month") {
    const age = formatAge(d.at, now);
    const lines = key === "kiro"
      ? [line(t, "Credits", twoDecimals(d.credits), 52), line(t, "Sessions", String(d.sessions), 52), line(t, "Turns", String(d.turns), 52)]
      : [d.costUsd === null ? div().text_size(12).child("Cost unknown") : line(t, "Cost", formatUsd(d.costUsd), 52), line(t, "Tokens", formatTokens(d.tokens ?? 0), 52), line(t, "Sessions", String(d.sessions), 52)];
    return [note(t, "This month, no usage limits"),
      ...(key === "grok" ? [note(t, GROK_NOTE)] : []),
      ...lines,
      ...(age ? [div().text_size(11).text_color(t.muted).child(age)] : []),
      ...(key === "kiro" && d.skipped > 0 ? [div().text_size(11).text_color(t.muted).child(d.skipped === 1 ? "1 file skipped" : `${d.skipped} files skipped`)] : [])];
  }
  const age = key === "codex" ? formatAge(d.at, now) : "";
  return [...d.windows.map((w) => row(t, k, w, now, key === "codex")),
    ...(age ? [div().text_size(11).text_color(t.muted).child(age)] : [])];
}

// A provider's section: its icon and name (and Codex's plan), then its reading. The primary one
// carries the "focused pane" tag.
const section = (t, k, p, entry, now, primary) => v_flex().gap(6)
  .child(h_flex().gap(6).items_center().text_size(12.5)
    .when(Boolean(p.icon), (el) => el.child(icon(p, 14, t.foreground)))
    .child(div().font_medium().child(p.name))
    .when(Boolean(p.key === "codex" && entry.state === "ok" && entry.data.plan), (el) => el.child(div().text_color(t.muted).child(entry.data.plan)))
    .when(primary, (el) => el.child(div().ml_auto().flex_none().h(16).px(5).rounded(RADIUS.control).bg(k.accentSoft).text_size(10).flex().items_center().child("focused pane"))))
  .children(body(t, k, p.key, entry, now));

// The card's content. `providers`: the installed, supported agents, primary first (orderedProviders);
// `agentsKnown`: knownAgents() has answered; `failed`: knownAgents() rejected; `focusedKey`: the primary's key.
export function usageCard(t, k, { providers, agentsKnown, failed, view, now, focusedKey }) {
  const card = v_flex().w(280).p(12).gap(10).rounded(RADIUS.overlay).bg(t.raised).border(1).border_color(k.line).text_size(12).text_color(t.foreground);
  if (failed) return card.child(note(t, EMPTY_FAILED));
  if (!agentsKnown) return card.child(note(t, "Loading…"));
  if (!providers.length) return card.child(note(t, EMPTY_NONE));
  return card.children(providers.flatMap((p, i) => [
    ...(i > 0 ? [div().h(1).bg(k.line)] : []),
    section(t, k, p, view(p.key), now, p.key === focusedKey),
  ]));
}

// The primary provider in full: icon, main number, 40 x 4 bar and window label. At 90 % and over
// the number and the fill are t.blocked, with the alert mark before the number.
const primaryPart = (t, k, p, r) => {
  const color = r.high ? t.blocked : t.foreground;
  return h_flex().id("usage-primary").gap(6).items_center()
    .when(Boolean(p.icon), (el) => el.child(icon(p, 12, t.foreground)))
    .when(r.high, (el) => el.child(alertMark(t, 11, t.canvas)))
    .child(div().id("usage-percent").text_color(color).child(r.text))
    .when(r.percent !== null, (el) => el.child(div().id("usage-bar").w(40).h(4).flex_none().rounded_full().bg(k.accentTrack).overflow_hidden()
      .child(div().id("usage-fill").h(4).w(`${r.percent}%`).bg(r.high ? t.blocked : t.accent))))
    .when(Boolean(r.label), (el) => el.child(div().id("usage-label").text_color(t.muted).child(r.label)));
};

// Every other provider, compact: icon and main number, muted.
const compactPart = (t, p, r) => h_flex().id(`usage-other-${p.key}`).gap(4).items_center().text_color(t.muted)
  .when(Boolean(p.icon), (el) => el.child(icon(p, 12, t.muted)))
  .child(r.text);

// The control right of the status bar. `providers`: primary first. Hovering opens the card above it
// at once, right-aligned, and it closes 150 ms after the pointer has left both; a click loads the readings.
export function usageStatusControl(t, k, { providers, view, now, onHover, card }) {
  const [primary, ...others] = providers;
  const control = h_flex().id("usage").h(20).flex_none().px(8).gap(10).items_center().rounded(RADIUS.control).text_size(11).text_color(t.muted)
    .cursor_pointer().hover((s) => s.bg(k.pill))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_hover(onHover)
    .on_click(() => onHover(true))
    .when(!primary, (el) => el.child("Usage"))
    .when(Boolean(primary), (el) => el.child(primaryPart(t, k, primary, reading(primary.key, view(primary.key), now))))
    .when(others.length > 0, (el) => el.child(div().id("usage-divider").w(1).h(12).flex_none().bg(k.line)))
    .children(others.map((p) => compactPart(t, p, reading(p.key, view(p.key), now))));
  return HoverCard.new("usage-card").open_delay(0).close_delay(150).anchor("bottom_right").trigger(control).content(card);
}
