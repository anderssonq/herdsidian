// The Usage control beside Search and its hover card. Colors come from theme() and tokens.js (ADR-0001).
import { div } from "gpui-kit";
import { h_flex, v_flex, HoverCard } from "gpui-base";
import { alpha } from "./tokens.js";
import { icon } from "./ui.js";
import { EMPTY_FAILED, EMPTY_NONE, ERROR_TEXT, formatAge, windowView } from "./usage.js";

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

// What one provider shows under its name.
function body(t, k, key, entry, now) {
  if (entry.state === "loading") return [note(t, "Loading…")];
  if (entry.state === "error") return [note(t, ERROR_TEXT[entry.error] ?? ERROR_TEXT.unavailable)];
  const d = entry.data;
  if (d.kind === "stats") {
    const line = (label, value) => h_flex().gap(8).text_size(12).child(div().w(44).flex_none().text_color(t.muted).child(label)).child(div().child(value));
    return [note(t, "Last 7 days, no usage limits"), line("Cost", d.cost), line("Input", d.input), line("Output", d.output)];
  }
  const age = key === "codex" ? formatAge(d.at, now) : "";
  return [...d.windows.map((w) => row(t, k, w, now, key === "codex")),
    ...(age ? [div().text_size(11).text_color(t.muted).child(age)] : [])];
}

// A provider's section: its icon and name (and Codex's plan), then its reading.
const section = (t, k, p, entry, now) => v_flex().gap(6)
  .child(h_flex().gap(6).items_center().text_size(12.5)
    .when(Boolean(p.icon), (el) => el.child(icon(p, 14, t.foreground)))
    .child(div().font_medium().child(p.name))
    .when(Boolean(p.key === "codex" && entry.state === "ok" && entry.data.plan), (el) => el.child(div().text_color(t.muted).child(entry.data.plan))))
  .children(body(t, k, p.key, entry, now));

// The card's content. `providers`: the installed, supported agents (providersFrom of knownAgents());
// `agentsKnown`: knownAgents() has answered; `failed`: knownAgents() rejected.
export function usageCard(t, k, { providers, agentsKnown, failed, view, now }) {
  const card = v_flex().w(280).p(12).gap(10).rounded(10).bg(t.raised).border(1).border_color(k.line).text_size(12).text_color(t.foreground);
  if (failed) return card.child(note(t, EMPTY_FAILED));
  if (!agentsKnown) return card.child(note(t, "Loading…"));
  if (!providers.length) return card.child(note(t, EMPTY_NONE));
  return card.children(providers.map((p) => section(t, k, p, view(p.key), now)));
}

// The pill beside Search: the word, then each provider's icon. Hovering opens the card at once and
// it closes 150 ms after the pointer has left both.
export function usageControl(t, k, { providers, onHover, card }) {
  const control = h_flex().id("usage").h(30).flex_none().px(10).gap(8).items_center().rounded(8).bg(k.pill).text_size(12.5).text_color(t.muted)
    .cursor_pointer().hover((s) => s.bg(alpha(t.foreground, 0.10)))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_hover(onHover)
    .child("Usage")
    .children(providers.map((p) => icon(p, 14, t.muted)).filter(Boolean));
  return HoverCard.new("usage-card").open_delay(0).close_delay(150).trigger(control).content(card);
}
