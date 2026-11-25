// The Git tab's upper half: header, actions bar, filter and the virtual list of 24 px rows (uncommitted row, commits, Load more).
// Pure functions of a plain model `m` plus callbacks `on`; git-view.js owns the state. Plan: .spec/herdsidian-git-tab-plan.md.
// A row made inside the list renderer has no id, no handler, no hover and no tooltip (the host throws): the click is `on.item`.
// No `herdr` import: its `window` shadows the gpui global, so lane strokes go through globalThis.window.
import { PathBuilder, div, svg } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar, Input } from "gpui-base";
import { RADIUS, tokens, diffTokens } from "./tokens.js";
import { ago } from "./diff.js";
import { GRAPH_ROW, NODE, NODE_DOT, laneX, laneSegments } from "./git-lanes.js";
import { initialsOf, authorSlot } from "./git-model.js";

const MINUS = "−";
const STROKE = 1.5;
const TAG_LANE = 3; // tags always use ansi3
const ASK_DOT = 5; // the "asks first" dot on a write button
const ICONS = {
  fetch: "mods/herdsidian/fetch.svg",
  pull: "mods/herdsidian/arrow-down.svg",
  push: "mods/herdsidian/arrow-up.svg",
  branch: "mods/workspace-chrome/git-branch.svg",
  stash: "mods/workspace-chrome/archive.svg",
  pop: "mods/herdsidian/stash-pop.svg",
};
const PILL_ICONS = { local: ICONS.branch, remote: "mods/herdsidian/cloud.svg", tag: "mods/herdsidian/tag.svg" };

// The 16 px author circle: the author's lane color with black or white initials (never t.background).
export function avatar(gk, commit) {
  const c = gk.lanes[authorSlot(commit.email, commit.author)];
  return div().size(NODE).flex_none().flex().items_center().justify_center().rounded(NODE / 2).bg(c.raw).text_color(c.ink)
    .text_size(8).font_semibold().child(initialsOf(commit.author));
}

// A ref pill: icon and name in the lane's pill colors; the current branch has a 1 px outline. `slot` colors branches.
export function pill(gk, ref, slot) {
  const c = gk.lanes[ref.kind === "tag" ? TAG_LANE : slot % gk.lanes.length];
  return h_flex().h(16).px(5).gap(3).flex_none().items_center().rounded(RADIUS.control).bg(c.pillBg).text_color(c.pillText).text_size(10.5)
    .when(Boolean(ref.current), (el) => el.border(1).border_color(c.pillText))
    .child(svg(PILL_ICONS[ref.kind] ?? PILL_ICONS.local).size(10).flex_none())
    .child(div().min_w(0).max_w(110).truncate().child(ref.name));
}

// One stroke path per lane color; `ops` are laneSegments' "M", "L" and "Q" steps.
function stroke(ops, color) {
  let b = PathBuilder.stroke(STROKE);
  for (const [op, ...n] of ops) b = op === "M" ? b.move_to(n[0], n[1]) : op === "L" ? b.line_to(n[0], n[1]) : b.curve_to(n[2], n[3], n[0], n[1]);
  return globalThis.window.paint_path(b.build(), color).absolute().top(0).left(0).size_full();
}

// The lane cell of a commit row: the strokes first, then the node (avatar, or a dot when there are many lanes).
function laneCell(gk, geo, row, commit) {
  const col = row.lane ? row.lane.col : 0;
  const slot = authorSlot(commit.email, commit.author);
  const x = laneX(col, geo);
  const size = geo.dots ? NODE_DOT : NODE;
  const node = geo.dots
    ? div().absolute().left(x - size / 2).top((GRAPH_ROW - size) / 2).size(size).rounded(size / 2).bg(gk.lanes[slot].line)
    : avatar(gk, commit).absolute().left(x - size / 2).top((GRAPH_ROW - size) / 2);
  return div().relative().w(geo.cell).h(GRAPH_ROW).flex_none()
    .children(row.lane ? laneSegments(row.lane, geo).map((s) => stroke(s.ops, gk.lanes[s.lane % gk.lanes.length].line)) : [])
    .child(node);
}

// The 2 px bar at the left of a row: t.accent on the selected one, empty on the others so the columns line up.
const bar = (selected, t) => div().w(2).h_full().flex_none().when(selected, (el) => el.bg(t.accent));

function commitRow(t, k, gk, geo, now, row) {
  const c = row.commit;
  const col = row.lane ? row.lane.col : 0;
  const picked = row.pill;
  return h_flex().w_full().h(24).flex_none().items_center().gap(6).pr(8).text_size(12).text_color(t.foreground)
    .when(Boolean(row.selected), (el) => el.bg(k.accentSoft))
    .child(bar(row.selected, t))
    .child(laneCell(gk, geo, row, c))
    .when(Boolean(picked), (el) => el.child(pill(gk, picked.ref, col))
      .when(picked.more > 0, (e) => e.child(div().flex_none().text_size(10.5).text_color(t.muted).child(`+${picked.more}`))))
    .child(div().flex_1().min_w(0).truncate().child(c.subject))
    .child(div().flex_none().text_size(11).text_color(row.selected ? t.foreground : t.muted).child(ago(c.at, now)));
}

// The uncommitted row: a dashed ring, the file count and the totals. It is never selected.
function wipRow(t, dk, gk, geo, row) {
  const col = row.col ?? 0;
  const x = laneX(col, geo);
  const ring = div().absolute().left(x - NODE / 2).top((GRAPH_ROW - NODE) / 2).size(NODE).rounded(NODE / 2).border(1.5).border_dashed().border_color(gk.lanes[col % gk.lanes.length].line);
  return h_flex().w_full().h(24).flex_none().items_center().gap(6).pr(8).text_size(12).text_color(t.foreground)
    .child(bar(false, t))
    .child(div().relative().w(geo.cell).h(GRAPH_ROW).flex_none().child(ring))
    .child(div().flex_none().child(`${row.count} uncommitted ${row.count === 1 ? "file" : "files"}`))
    .when(row.add > 0, (el) => el.child(div().flex_none().text_size(11).text_color(dk.addText).child(`+${row.add}`)))
    .when(row.del > 0, (el) => el.child(div().flex_none().text_size(11).text_color(dk.delText).child(`${MINUS}${row.del}`)));
}

const moreRow = (t) => h_flex().w_full().h(24).flex_none().items_center().justify_center().text_size(11.5).text_color(t.muted).child("Load more");

function header(t, m) {
  const h = m.header;
  return h_flex().id("git-header").flex_none().h(28).px(12).gap(8).items_center().text_size(12).text_color(t.foreground)
    .child(svg(ICONS.branch).size(13).flex_none().text_color(t.muted))
    .child(div().id("git-branch").min_w(0).truncate().font_semibold().child(h.label))
    .when(h.ahead > 0, (el) => el.child(div().id("git-ahead").flex_none().text_size(11).child(`↑${h.ahead}`)))
    .when(h.behind > 0, (el) => el.child(div().id("git-behind").flex_none().text_size(11).child(`↓${h.behind}`)))
    .when(h.noUpstream, (el) => el.child(div().id("git-no-upstream").flex_none().text_size(11).text_color(t.muted).child("No upstream")));
}

// One of the six buttons. Disabled: every color t.muted, no hover, no click, the reason as tooltip (R11).
function actionButton(t, k, a, on) {
  const enabled = !a.reason;
  const dot = div().id(`git-asks-${a.action}`).absolute().top(0).right(0).size(ASK_DOT).rounded(ASK_DOT / 2).bg(enabled ? t.accent : t.muted);
  const icon = div().relative().size(16).flex_none().flex().items_center().justify_center()
    .child(svg(ICONS[a.action]).size(14))
    .when(a.action !== "fetch", (el) => el.child(dot));
  return v_flex().id(`git-act-${a.action}`).flex_1().min_w(0).h(44).items_center().justify_center().gap(3).rounded(RADIUS.control).text_size(10.5)
    .text_color(enabled ? t.foreground : t.muted)
    .tooltip(enabled ? (a.action === "fetch" ? "Fetch all remotes" : `${a.label}: asks first`) : a.reason)
    .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(k.pill)).on_click((_e, cx) => on.act(a.action, cx)))
    .child(icon)
    .child(a.label);
}

const actionsBar = (t, k, m, on) =>
  h_flex().id("git-actions").flex_none().px(8).pb(6).gap(4).children(m.actions.map((a) => actionButton(t, k, a, on)));

function filter(t, k, m) {
  const note = String(m.query ?? "").trim() ?div().id("git-filter-note").flex_none().px(12).pb(4).text_size(11).text_color(t.muted).child(`${m.matched} of ${m.loaded} loaded commits`) : null;
  return v_flex().flex_none()
    .child(div().flex_none().px(8).pb(6).child(h_flex().id("git-filter").h(28).px(8).gap(6).items_center().rounded(RADIUS.control).bg(k.pill)
      .child(svg("mods/workspace-chrome/search.svg").size(13).flex_none().text_color(t.muted))
      .child(Input.new(m.filter).flex_1().text_size(12).text_color(t.foreground))))
    .when(Boolean(note), (el) => el.child(note));
}

function list(t, k, gk, m, on) {
  const dk = diffTokens(t);
  const now = m.now ?? Date.now();
  const rows = m.rows;
  const build = (row) => (row.kind === "wip" ? wipRow(t, dk, gk, m.geo, row) : row.kind === "more" ? moreRow(t) : commitRow(t, k, gk, m.geo, now, row));
  const rendered = v_virtual_list("git-rows", rows.length, GRAPH_ROW, (i) => rows[i].key,
    (range) => Array.from({ length: Math.max(0, range.end - range.start) }, (_, i) => build(rows[range.start + i])))
    .id("git-rows").size_full().on_item_click((key, cx) => on.item(key, cx))
    .when(Boolean(m.handle), (el) => el.track_scroll(m.handle));
  return div().id("git-graph").flex_1().min_h(0).relative()
    .child(rendered)
    .child(Scrollbar.vertical("git-rows").absolute().inset_0());
}

// A state with no graph: Loading history…, No folder, a git error, No commits yet on <branch>.
export const gitMessage = (t, text) => div().id("git-message").flex_1().min_h(0).p(12).text_size(12).text_color(t.muted).child(text);

// -> Element: header, actions bar, `between` (the card and the result panel, or null), then the filter and the list, or the message.
//   m: { header: headerOf(snap), actions: [{ action, label, reason }] in ACTIONS order (reason null = enabled, else the tooltip),
//        between: Element | null, message: string | null (drawn in place of the filter and list),
//        filter: InputState (made in init, with its placeholder), query, matched, loaded (the note shows only with a query),
//        rows: [{ key: "wip", kind: "wip", count, add, del, col (HEAD's lane column, default 0) } | { key: "more", kind: "more" }
//          | { key: hash, kind: "commit", commit, lane: LaneRow | null (no lane under a filter), pill: pickPill(...), selected }],
//        geo: laneGeometry(width) (one lane wide under a filter), now: ms (default Date.now()), handle: VirtualListScrollHandle | undefined }
//   on: act(action, cx) · item(key, cx)
export function gitGraph(t, gk, m, on) {
  const k = tokens(t);
  return v_flex().flex_1().min_h(0)
    .child(header(t, m))
    .child(actionsBar(t, k, m, on))
    .when(Boolean(m.between), (el) => el.child(m.between))
    .when(Boolean(m.message), (el) => el.child(gitMessage(t, m.message)))
    .when(!m.message, (el) => el.child(filter(t, k, m)).child(list(t, k, gk, m, on)));
}
