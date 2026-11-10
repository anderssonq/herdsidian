// The Graph section of the Notes panel: a 32 px header, a 200 px graph area (edges painted as
// strokes, nodes as absolute divs) and the Agent context strip. A pure function of a plain
// model `m` plus callbacks `on`; main.js owns the state. Plan: .spec/herdsidian-graph-plan.md.
// No `herdr` import: its `window` shadows the gpui global, so strokes use globalThis.window.

import { PathBuilder, div, svg } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import { tokens, alpha, RADIUS } from "./tokens.js";
import { keycap } from "./ui.js";
import { base } from "./notes.js";
import { LABEL, estimateWidth, fitLabel } from "./graph.js";

const AREA_HEIGHT = 200;
const AREA_MIN = 80; // the graph area shrinks to this when the panel is short; the strip never does
const HEADER_HEIGHT = 32;
const STRIP_MAX = 96;
// The strip's fixed parts: top and bottom padding 6 + 8, two gaps of 6, the title line (18) and the actions row (28).
const STRIP_FIXED = 6 + 8 + 2 * 6 + 18 + 28;
const PICKER_MAX = 190;
const PICK_HITS = 6;

// One stroke path with a segment per edge, painted over the whole area. Callers skip an empty list.
function strokes(segments, color) {
  let b = PathBuilder.stroke(1);
  for (const s of segments) b = b.move_to(s.x1, s.y1).line_to(s.x2, s.y2);
  return globalThis.window.paint_path(b.build(), color).absolute().top(0).left(0).size_full();
}

// A small pill-shaped action. Without `act` it is disabled: muted, with the reason as tooltip.
function action(t, k, id, content, tip, act) {
  const on = typeof act === "function";
  return h_flex().id(id).h(24).px(8).gap(6).flex_none().items_center().rounded(RADIUS.control).text_size(11.5)
    .text_color(on ? t.foreground : t.muted)
    .bg(on ? t.raised : k.pill)
    .when(on, (el) => el.cursor_pointer().on_click(act))
    .when(Boolean(tip), (el) => el.tooltip(tip))
    .child(content);
}

// The primary action of the strip (V6): solid, with a ⌘↵ key cap. Disabled it is the muted pill, reason as tooltip.
function sendButton(t, k, m, on) {
  const ok = m.send.ok;
  const cap = div().flex_none().px(5).h(18).rounded(RADIUS.control).border(1).border_color(alpha(t.solid_foreground, 0.25))
    .text_size(10.5).font_weight(500).flex().items_center().child("⌘↵");
  return h_flex().id("graph-send").h(28).flex_none().items_center().gap(8).rounded(RADIUS.control).text_size(12)
    .when(ok, (el) => el.pl(12).pr(6).bg(t.solid).text_color(t.solid_foreground).font_weight(600).cursor_pointer()
      .on_click((_e, cx) => on.send(cx)))
    .when(!ok, (el) => el.px(12).bg(k.pill).text_color(t.muted))
    .when(!ok && Boolean(m.send.reason), (el) => el.tooltip(m.send.reason))
    .child("Send to agent")
    .when(ok, (el) => el.child(cap));
}

// A 16 px icon button inside a chip.
function iconButton(t, k, id, icon, tip, act) {
  return div().id(id).size(16).flex_none().flex().items_center().justify_center().rounded(RADIUS.control).text_color(t.muted)
    .hover((s) => s.bg(k.pill).text_color(t.foreground)).cursor_pointer().tooltip(tip).on_click(act)
    .child(svg(`mods/workspace-chrome/${icon}.svg`).size(10));
}

// The 1 | 2 hops switch, in the style of the Notes pills.
function hopsPill(t, k, m, on) {
  const one = (n) => div().id(`hops-${n}`).px(7).h(20).flex().items_center().rounded(RADIUS.control).text_size(11.5).cursor_pointer()
    .text_color(m.hops === n ? t.foreground : t.muted).when(m.hops === n, (el) => el.bg(t.raised))
    .hover((s) => s.text_color(t.foreground)).tooltip(n === 1 ? "Direct links only" : "Links of links").on_click((_e, cx) => on.setHops(n, cx)).child(String(n));
  return h_flex().flex_none().p(1).gap(1).items_center().rounded(RADIUS.control).bg(k.pill).child(one(1)).child(one(2));
}

function header(t, k, m, on) {
  const count = m.count > 0 ? `${m.count} ${m.count === 1 ? "note" : "notes"}` : null;
  const shut = m.hidden || m.folded;
  const tip = m.folded ? "Folded while reading: click to show the graph for this note" : m.hidden ? "Show the graph" : "Hide the graph";
  return h_flex().h(HEADER_HEIGHT).flex_none().px(12).gap(8).items_center()
    .child(h_flex().id("graph-toggle").gap(6).flex_none().items_center().cursor_pointer().tooltip(tip)
      .on_click((_e, cx) => on.toggle(cx))
      .child(svg(`mods/files/chevron-${shut ? "right" : "down"}.svg`).size(9).flex_none().text_color(t.muted))
      .child(div().text_size(12).font_semibold().text_color(t.foreground).child("Graph"))
      .when(m.folded, (el) => el.child(div().text_size(11).text_color(t.muted).child(m.foldDetail))))
    .when(!shut, (el) => el.child(hopsPill(t, k, m, on)))
    .when(Boolean(count) && !m.folded, (el) => el.child(div().flex_none().text_size(11).text_color(t.muted).child(count)))
    .when(m.omitted > 0 && !m.folded, (el) => el.child(div().flex_none().text_size(11).text_color(t.muted).child(`+${m.omitted} more`)))
    .child(div().flex_1())
    .when(!shut, (el) => el.child(div().id("graph-fit").px(8).h(22).flex_none().flex().items_center().rounded(RADIUS.control).text_size(11.5).text_color(t.muted)
      .cursor_pointer().hover((s) => s.text_color(t.foreground)).tooltip("Reset pan and zoom").on_click((_e, cx) => on.fit(cx)).child("Fit")));
}

// One node: a filled dot, a ring when linked, a hairline circle when only suggested.
function node(t, k, n, hovered, on) {
  const size = n.size, center = n.kind === "center";
  const fill = center ? t.accent : n.linked ? k.accentSoft : n.suggested ? null : n.kind === "far" ? k.nodeFar : k.node;
  const ring = n.linked ? 2 : hovered || n.suggested ? 1 : 0;
  const ringColor = hovered ? t.foreground : n.linked ? t.accent : k.edge;
  return div().id(`gnode-${n.path}`).absolute().left(n.x - size / 2).top(n.y - size / 2).size(size).rounded(size / 2)
    .when(fill !== null, (el) => el.bg(fill))
    .when(ring > 0, (el) => el.border(ring).border_color(ringColor))
    .cursor_pointer().tooltip(n.label ?? base(n.path))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => on.open(n.path, cx))
    .on_hover((h, cx) => on.hover(n.path, h, cx));
}

// One label, in the box placeLabels chose. The center and the hovered one sit on a pill so edges do not run through them.
function label(t, box, center, hovered) {
  return div().absolute().left(box.left).top(box.top).w(box.w).h(box.h).flex().items_center()
    .when(box.side === "below", (el) => el.justify_center()).px(LABEL.pad / 2).rounded(RADIUS.control).truncate().text_size(LABEL.size)
    .text_color(center || hovered ? t.foreground : t.muted).when(center, (el) => el.font_semibold())
    .when(center || hovered, (el) => el.bg(t.raised))
    .child(box.text);
}

// The labels placeLabels kept, plus the hovered node's, which always shows.
function labels(t, m) {
  const byPath = new Map(m.nodes.map((n) => [n.path, n]));
  const shown = m.labels.filter((b) => b.path !== m.hover);
  const on = m.hover ? byPath.get(m.hover) : null;
  const hot = on && (m.labels.find((b) => b.path === m.hover) ?? hoverBox(on, m.area));
  return [...shown.map((b) => label(t, b, byPath.get(b.path)?.kind === "center", false)),
    ...(hot ? [label(t, hot, on.kind === "center", true)] : [])];
}

// A box for a hovered node placeLabels culled: below the node, kept inside the area.
function hoverBox(n, area) {
  const text = fitLabel(n.label ?? base(n.path)), w = estimateWidth(text);
  return { path: n.path, text, w, h: LABEL.height, side: "below",
    left: Math.max(0, Math.min(area.width - w, n.x - w / 2)), top: Math.max(0, Math.min(area.height - LABEL.height, n.y + n.size / 2 + LABEL.gap)) };
}

function area(t, k, m, on) {
  const line = m.error ?? m.message;
  const empty = m.nodes.length === 0;
  return div().id("graph-area").relative().w_full().h(AREA_HEIGHT).flex_shrink(1).min_h(AREA_MIN).overflow_hidden()
    .on_size_change((size, cx) => on.size(size, cx))
    .on_mouse_down("left", (e, cx) => on.dragStart(e.position, cx))
    .on_mouse_move((e, cx) => on.dragMove(e.position, cx))
    .on_mouse_up("left", (_e, cx) => on.dragEnd(cx))
    .on_hover((h, cx) => { if (!h) on.dragEnd(cx); })
    .on_scroll_wheel((e, cx) => { if (e.local_position) on.wheel(e.local_position, e.delta.y, cx); })
    .when(m.segments.length > 0, (el) => el.child(strokes(m.segments, k.edge)))
    .when(m.hotSegments.length > 0, (el) => el.child(strokes(m.hotSegments, k.edgeHot)))
    .children(m.nodes.map((n) => node(t, k, n, n.path === m.hover, on)))
    .children(labels(t, m))
    .when(Boolean(line) && empty, (el) => el.child(div().absolute().top(0).left(0).size_full().flex().items_center().justify_center().px(12).text_center()
      .text_size(12).text_color(m.error ? t.blocked : t.muted).child(line)))
    .when(Boolean(line) && !empty, (el) => el.child(div().absolute().bottom(6).left(0).w_full().px(12).text_center().truncate()
      .text_size(12).text_color(m.error ? t.blocked : t.muted).child(line)));
}

function chip(t, k, c, m, on) {
  const auto = c.scope === "auto", pinned = c.scope === "agent";
  return h_flex().h(22).pl(8).pr(4).gap(4).flex_none().items_center().rounded(RADIUS.control).bg(k.accentSoft).text_size(11.5).text_color(t.foreground)
    .child(div().id(`chip-${c.path}`).truncate().max_w(120).cursor_pointer().tooltip(c.path).on_click((_e, cx) => on.open(c.path, cx)).child(c.label ?? base(c.path)))
    .when(auto, (el) => el.child(div().flex_none().text_size(10).text_color(t.muted).child("auto")))
    .when(m.agentOnlyAllowed && !auto, (el) => el.child(iconButton(t, k, `chip-scope-${c.path}`, pinned ? "pin" : "pin-off",
      pinned ? "This agent only" : "Whole space", (_e, cx) => on.scope(c.path, !pinned, cx))))
    .child(iconButton(t, k, `chip-x-${c.path}`, "x", "Unlink", (_e, cx) => on.unlink(c.path, c.scope, cx)));
}

function suggestion(t, k, s, on) {
  return h_flex().id(`sugg-${s.path}`).h(22).pl(8).pr(6).gap(4).flex_none().items_center().rounded(RADIUS.control).border(1).border_color(k.line)
    .text_size(11.5).text_color(t.muted).cursor_pointer().hover((s2) => s2.text_color(t.foreground)).tooltip("Link this note")
    .on_click((_e, cx) => on.pin(s.path, cx))
    .child(div().truncate().max_w(120).child(s.label ?? base(s.path)))
    .child(svg("mods/workspace-chrome/plus.svg").size(10).flex_none());
}

// The find-a-note box and its hits. Esc or the x closes it.
function picker(t, k, m, on) {
  return v_flex().gap(2)
    .on_key_down((e, cx) => { if (e.key === "escape") { on.pickClose(cx); cx.stop_propagation(); } })
    .child(h_flex().id("pick-input").h(26).px(8).gap(6).items_center().rounded(RADIUS.control).bg(k.pill).on_click(() => m.pickState.focus())
      .child(Input.new(m.pickState).flex_1().text_size(12).text_color(t.foreground))
      .child(iconButton(t, k, "pick-close", "x", "Close", (_e, cx) => on.pickClose(cx))))
    .child(action(t, k, "graph-add-current", h_flex().gap(6).items_center().child("Add current note").child(keycap(t, "⌘L")),
      m.canAddCurrent ? null : "Open a note first", m.canAddCurrent ? (_e, cx) => on.addCurrent(cx) : null))
    .children(m.pickHits.slice(0, PICK_HITS).map((h) => h_flex().id(`pick-${h.path}`).h(24).px(8).items_center().rounded(RADIUS.control).text_size(12)
      .text_color(t.muted).cursor_pointer().hover((s) => s.bg(k.pill).text_color(t.foreground)).on_click((_e, cx) => on.pickChoose(h.path, cx))
      .child(div().truncate().child(h.label ?? base(h.path)))));
}

function strip(t, k, m, on) {
  const n = m.chips.length;
  // The title line and the actions come first and are fixed; only the chips, suggestions and picker scroll.
  return v_flex().id("graph-strip").flex_none().px(12).pt(6).pb(8).gap(6)
    .child(h_flex().flex_none().gap(8).items_center()
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).font_medium().text_color(t.foreground).child(m.agentLabel ?? "No agent focused"))
      .child(div().flex_none().text_size(11).text_color(t.muted).child(`${n} ${n === 1 ? "note" : "notes"}`)))
    .child(h_flex().flex_none().gap(6).items_center()
      .child(h_flex().id("graph-add").h(28).px(10).flex_none().items_center().rounded(RADIUS.control).text_size(12)
        .bg(t.raised).text_color(t.foreground).cursor_pointer().on_click((_e, cx) => on.pick(cx)).child("+ Add note"))
      .child(div().flex_1())
      .child(sendButton(t, k, m, on)))
    .child(v_flex().id("graph-strip-body").flex_none().max_h(m.picking ? PICKER_MAX : STRIP_MAX).overflow_y_scrollbar().gap(6)
      .when(n === 0, (el) => el.child(div().text_size(12).text_color(t.muted).child("No notes linked yet")))
      .when(n > 0 || m.suggestions.length > 0, (el) => el.child(h_flex().flex_wrap().gap(4)
        .children(m.chips.map((c) => chip(t, k, c, m, on)))
        .children(m.suggestions.map((s) => suggestion(t, k, s, on)))))
      .when(m.picking, (el) => el.child(picker(t, k, m, on))));
}

// -> Element: header + area + strip, or the header only when m.hidden (AC10).
// `on` callbacks, each with the gpui `cx` last:
//   toggle(cx) · setHops(n, cx) · fit(cx) · open(path, cx) · hover(path, hovered, cx)
//   dragStart(point, cx) · dragMove(point, cx) · dragEnd(cx) · wheel(point, deltaY, cx) · size({width, height}, cx)
//   unlink(path, scope, cx) · scope(path, agentOnly, cx) · pin(path, cx)
//   pick(cx) · pickChoose(path, cx) · pickClose(cx) · addCurrent(cx) · send(cx)
export function graphSection(t, m, on) {
  const k = tokens(t);
  // Open: the section may shrink with the panel, but only through the area (its min_h is AREA_MIN). Its own
  // min_h is the divider + header + the smallest area + the strip's fixed parts, so the actions stay visible.
  // Folded while reading (V6): the area is gone but the strip stays under the header. Hidden: the header only.
  return v_flex().id("graph-section").w_full().when(m.hidden, (el) => el.flex_none())
    .when(m.folded, (el) => el.flex_shrink(1).min_h(1 + HEADER_HEIGHT + STRIP_FIXED))
    .when(!m.hidden && !m.folded, (el) => el.flex_shrink(1).min_h(1 + HEADER_HEIGHT + AREA_MIN + STRIP_FIXED))
    .child(div().h(1).w_full().flex_none().bg(k.line))
    .child(header(t, k, m, on))
    .when(!m.hidden && !m.folded, (el) => el.child(area(t, k, m, on)))
    .when(!m.hidden, (el) => el.child(strip(t, k, m, on)));
}
