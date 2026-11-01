// The command palette card (Search, tabs, rows, preview, footer). A pure function of a plain model `m`
// plus callbacks `on`; palette-main.js owns the state. Plan: .spec/herdsidian-palette-plan.md (Contracts).
//
// m = { input, focus, linking: null | { space }, tabs: [{ id, label, active }],
//       top: Row & { meta } | null, sections, empty, selected: rowKey | null,
//       window: null | visibleWindow result, preview: null | { title, markdown, error },
//       footer: [{ keys, label, active, reason }], error: string | null,
//       firstRun?: boolean }                      // no vault known yet: shows FIRST_RUN_HINT
// on = { key(e, cx), tab(id, cx), choose(key, cx), scroll(deltaY, cx) }

import { div, svg } from "gpui-kit";
import { h_flex, v_flex, Input, TextView } from "gpui-base";
import { keycap } from "./graph-view.js";
import { tokens, statusDot, PULSE } from "./tokens.js";
import { icon } from "./ui.js";
import { ROW, LIST_MAX } from "./palette.js";

export const PLACEHOLDER = "Search notes, agents and commands…";
const FIRST_RUN_HINT = "Open Notes once (⌘⇧O) to choose a vault";
export const linkPlaceholder = (space) => `Find a note to link to ${space}…`;

const CARD_WIDTH = 680;
const CARD_RADIUS = 18;
const CARD_PAD = 16;
const PREVIEW_HEIGHT = 200;

const text12 = (t, tone, s) => div().px(10).h(ROW.title).flex().items_center().flex_none().text_size(12).text_color(tone === "blocked" ? t.blocked : t.muted).child(s);

function dot(t, status) {
  const d = statusDot(t, status);
  return div().size(8).flex_none().rounded(8)
    .when(Boolean(d.fill), (el) => el.bg(d.fill))
    .when(Boolean(d.ring), (el) => el.border(1.5).border_color(d.ring))
    .when(d.pulse, (el) => el.loop("opacity", PULSE));
}

// One selectable row's frame: the selected one has the accentSoft fill; hover never selects (AC22).
function frame(k, m, row, on, height) {
  return h_flex().id(`row-${row.key}`).h(height).px(10).gap(8).items_center().flex_none().rounded(8).cursor_pointer()
    .when(row.key === m.selected, (el) => el.bg(k.accentSoft))
    .on_click((_e, cx) => on.choose(row.key, cx));
}

function agentRow(t, k, m, row, on) {
  const a = row.agent ?? {};
  const prog = icon(a.program, 14, t.foreground);
  return frame(k, m, row, on, ROW.row)
    .child(dot(t, a.status))
    .child(prog ?? div().flex_none().text_size(12.5).text_color(t.foreground).child(a.program?.name ?? row.label))
    .child(div().flex_none().text_size(12.5).text_color(t.foreground).child(a.space_name ?? row.label))
    .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.muted).child(a.title ? `— ${a.title}` : (row.detail ? `— ${row.detail}` : "")))
    .when(a.status === "blocked", (el) => el.child(div().flex_none().text_size(11.5).text_color(t.blocked).child("needs you")))
    .when(Boolean(row.hint), (el) => el.child(keycap(t, row.hint)));
}

function noteRow(t, k, m, row, on) {
  return frame(k, m, row, on, ROW.row)
    .child(div().flex_none().max_w(320).truncate().text_size(12.5).text_color(t.foreground).child(row.label))
    .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.muted).child(row.detail ? `— ${row.detail}` : ""));
}

function commandRow(t, k, m, row, on) {
  return frame(k, m, row, on, ROW.row)
    .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(row.label))
    .when(Boolean(row.hint), (el) => el.child(keycap(t, row.hint)));
}

function row(t, k, m, r, on) {
  if (r.kind === "agent") return agentRow(t, k, m, r, on);
  if (r.kind === "note") return noteRow(t, k, m, r, on);
  return commandRow(t, k, m, r, on);
}

// The Top hit: about 56 px, the title, the second line, "Open ↵" at the end (AC18).
function topHit(t, k, m, on) {
  const r = m.top;
  return frame(k, m, r, on, ROW.top).px(12).gap(10)
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(div().truncate().text_size(14).font_semibold().text_color(t.foreground).child(r.label))
      .when(Boolean(r.meta), (el) => el.child(div().truncate().text_size(12).text_color(t.muted).child(r.meta))))
    .child(div().flex_none().text_size(11.5).text_color(t.muted).child("Open ↵"));
}

// A section of the All tab: its title, its message (loading, error, none) and its rows.
function section(t, k, m, s, on) {
  if (s.rows.length === 0 && !s.message) return null;
  return v_flex().id(`section-${s.kind}`).flex_none()
    .child(div().px(10).h(ROW.title).flex().items_center().text_size(11).font_semibold().text_color(t.muted).child(s.title))
    .when(Boolean(s.message), (el) => el.child(text12(t, s.message.tone, s.message.text)))
    .children(s.rows.map((r) => row(t, k, m, r, on)));
}

// A single-kind tab: only the rows of the window are drawn, at fixed tops (the picker's strip).
function strip(t, k, m, s, on) {
  const w = m.window;
  const height = Math.min(w.viewport ?? LIST_MAX, w.total);
  const fixed = w.total > height;
  const last = Math.min(w.last, s.rows.length - 1);
  const shown = [];
  for (let i = Math.max(0, w.first); i <= last; i++) {
    shown.push(row(t, k, m, s.rows[i], on).absolute().left(0).right(0).top(w.tops[i] - w.scroll).h(ROW.row));
  }
  return v_flex().id("palette-list").relative().flex_none().h(height).overflow_hidden()
    .when(fixed, (el) => el.on_scroll_wheel((e, cx) => on.scroll(e.delta.y, cx)))
    .children(shown);
}

function tabs(t, k, m, on) {
  return h_flex().gap(4).items_center()
    .children(m.tabs.map((tab) => div().id(`tab-${tab.id}`).px(10).h(24).flex().items_center().rounded(6).text_size(12).cursor_pointer()
      .text_color(tab.active ? t.foreground : t.muted)
      .when(tab.active, (el) => el.bg(k.accentSoft))
      .when(!tab.active, (el) => el.hover((s) => s.text_color(t.foreground)))
      .on_click((_e, cx) => on.tab(tab.id, cx))
      .child(tab.label)));
}

function header(t, k, m, on) {
  return v_flex().flex_none().gap(8)
    .child(h_flex().h(32).gap(8).items_center()
      .child(svg("mods/workspace-chrome/search.svg").size(14).flex_none().text_color(t.muted))
      .child(Input.new(m.input).flex_1().text_size(14).text_color(t.foreground))
      .when(Boolean(m.linking), (el) => el.child(div().h(22).px(8).flex_none().flex().items_center().rounded(5).bg(k.accentSoft)
        .text_size(11.5).text_color(t.foreground).child(`Link to ${m.linking.space}`))))
    .child(tabs(t, k, m, on));
}

// Read-only preview of the selected note, under the list. Only drawn when the model carries one.
function preview(t, k, p) {
  return v_flex().id("palette-preview").flex_none().gap(4).pt(8).border_t(1).border_color(k.line)
    .child(div().px(10).truncate().text_size(11).font_semibold().text_color(t.muted).child(p.title))
    .child(p.error
      ? text12(t, "blocked", p.error)
      : div().h(PREVIEW_HEIGHT).px(10).overflow_hidden().text_size(12.5).text_color(t.foreground)
        .child(TextView.markdown(`preview-${p.path}`, p.markdown).scrollable(true)));
}

// The footer: one key cap per entry; an entry that does nothing for this row is muted, half opaque, with its reason.
function footer(t, entries) {
  return h_flex().flex_none().gap(14).items_center().px(10)
    .children(entries.map((f) => h_flex().id(`footer-${f.keys}`).gap(6).items_center()
      .child(keycap(t, f.keys))
      .child(div().text_size(11).text_color(t.muted).child(f.label))
      .when(!f.active, (el) => el.opacity(0.5))
      .when(!f.active && Boolean(f.reason), (el) => el.tooltip(f.reason))));
}

// -> Element: the opaque `popover` card, 680 px wide (the overlay clamps it), as high as its content.
export function paletteCard(t, m, on) {
  const k = tokens(t);
  const single = m.sections.length === 1 && m.window;
  const messageOnly = (s) => s.rows.length === 0 && s.message;
  const card = v_flex().id("palette-card").w(CARD_WIDTH).flex_none().p(CARD_PAD).gap(8).rounded(CARD_RADIUS).bg(t.popover).border(1).border_color(k.line)
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .child(header(t, k, m, on))
    .when(Boolean(m.error), (el) => el.child(text12(t, "blocked", m.error)))
    .when(Boolean(m.firstRun), (el) => el.child(text12(t, "muted", FIRST_RUN_HINT)))
    .when(Boolean(m.empty), (el) => el.child(text12(t, "muted", m.empty)))
    .when(Boolean(m.top), (el) => el.child(topHit(t, k, m, on)))
    .children(m.sections.map((s) => {
      if (!single) return section(t, k, m, s, on);
      return v_flex().flex_none()
        .when(Boolean(s.message), (el) => el.child(text12(t, s.message.tone, s.message.text)))
        .when(!messageOnly(s), (el) => el.child(strip(t, k, m, s, on)));
    }))
    .when(Boolean(m.preview), (el) => el.child(preview(t, k, m.preview)))
    .child(footer(t, m.footer));
  return v_flex().id("palette-root").w_full().items_center()
    .track_focus(m.focus).on_key_down(on.key)
    .child(card);
}
