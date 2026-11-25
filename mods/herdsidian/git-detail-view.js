// The Git tab's lower half: the splitter and the detail of the selected commit (subject, author, hash, refs, stats, files).
// Pure functions of a plain model `m` plus callbacks `on`; git-view.js owns the state. Plan: .spec/herdsidian-git-tab-plan.md.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { RADIUS, tokens, diffTokens } from "./tokens.js";
import { ago, badgeOf, splitPath } from "./diff.js";
import { shortHash } from "./git-model.js";
import { avatar, pill } from "./git-graph-view.js";

const MINUS = "−";
const MONO = "Menlo";
const SPLITTER = 6;

// The 6 px drag handle with a 1 px line. The press starts a drag; the window-wide move and release carry it on (R2).
function splitter(k, on) {
  return div().id("git-splitter").h(SPLITTER).w_full().flex_none().flex().items_center().cursor_row_resize()
    .hover((s) => s.bg(k.pill))
    .on_mouse_down("left", (e, cx) => on.splitDown(e, cx))
    .on_window_mouse_move((e, cx) => on.splitMove(e, cx))
    .on_window_mouse_up("left", (e, cx) => on.splitUp(e, cx))
    .child(div().h(1).w_full().bg(k.line));
}

function fileRow(t, k, dk, f, on) {
  const badge = badgeOf(f.status);
  const { dir, name } = splitPath(f.path);
  const binary = f.add === null || f.add === undefined;
  return h_flex().id(`git-file-${f.path}`).h(24).flex_none().px(6).gap(6).items_center().rounded(RADIUS.control).text_size(12).text_color(t.foreground)
    .cursor_pointer().hover((s) => s.bg(k.pill)).on_click((_e, cx) => on.file(f.path, cx))
    .child(div().w(10).flex_none().text_size(11).font_semibold().text_color(t[badge.color] ?? t.muted).child(badge.letter))
    .child(h_flex().flex_1().min_w(0)
      .when(Boolean(dir), (el) => el.child(div().min_w(0).truncate().text_color(t.muted).child(dir)))
      .child(div().min_w(0).truncate().child(name)))
    .when(binary, (el) => el.child(div().flex_none().text_size(11).text_color(t.muted).child("bin")))
    .when(!binary && f.add > 0, (el) => el.child(div().flex_none().text_size(11).text_color(dk.addText).child(`+${f.add}`)))
    .when(!binary && f.del > 0, (el) => el.child(div().flex_none().text_size(11).text_color(dk.delText).child(`${MINUS}${f.del}`)));
}

const note = (t, id, text) => div().id(id).flex_none().text_size(11.5).text_color(t.muted).child(text);

function filesBlock(t, k, gk, dk, m, on) {
  const files = m.files;
  if (!files) return note(t, "git-files-loading", "Loading files…");
  if (files.error) return div().id("git-files-error").flex_none().text_size(11.5).text_color(gk.errorText).child(files.error);
  const hidden = files.count - files.files.length;
  return v_flex().id("git-files").flex_none()
    .children(files.files.map((f) => fileRow(t, k, dk, f, on)))
    .when(hidden > 0, (el) => el.child(note(t, "git-files-more", `${hidden} more files not shown`)));
}

function stats(t, dk, total, count) {
  return h_flex().id("git-detail-stats").flex_none().gap(8).items_center().text_size(11.5)
    .child(div().text_color(t.muted).child(`${count} ${count === 1 ? "file" : "files"}`))
    .child(div().text_color(dk.addText).child(`+${total.add}`))
    .child(div().text_color(dk.delText).child(`${MINUS}${total.del}`));
}

function body(t, k, gk, dk, m, on) {
  const c = m.commit;
  const now = m.now ?? Date.now();
  const ok = Boolean(m.files) && !m.files.error;
  return [
    div().id("git-detail-subject").flex_none().text_size(13).font_semibold().child(c.subject),
    h_flex().flex_none().gap(8).items_center().text_size(11.5)
      .child(h_flex().id("git-detail-author").gap(6).items_center().min_w(0)
        .child(avatar(gk, c))
        .child(div().truncate().child(c.author)))
      .child(div().id("git-detail-time").flex_none().text_color(t.muted).child(ago(c.at, now))),
    h_flex().flex_none().gap(8).items_center().text_size(11.5)
      .child(div().id("git-detail-hash").flex_none().font_family(MONO).child(shortHash(c.hash)))
      .child(div().id("git-copy-hash").flex_none().px(7).h(20).flex().items_center().rounded(RADIUS.control).text_color(t.muted)
        .cursor_pointer().hover((s) => s.bg(k.pill).text_color(t.foreground)).on_click((_e, cx) => on.copyHash(cx)).child("Copy hash")),
    c.parents.length > 0
      ? h_flex().id("git-detail-parents").flex_none().gap(6).items_center().text_size(11.5)
        .child(div().text_color(t.muted).child(c.parents.length > 1 ? "Parents" : "Parent"))
        .children(c.parents.map((p) => div().font_family(MONO).child(shortHash(p))))
      : null,
    m.refs.length > 0
      ? h_flex().id("git-detail-refs").flex_none().flex_wrap().gap(4).children(m.refs.map((r) => pill(gk, r, m.slot ?? 0)))
      : null,
    ok ? stats(t, dk, m.files.total, m.files.count) : null,
    c.parents.length > 1 ? note(t, "git-merge-note", `Merge: compared with the first parent ${shortHash(c.parents[0])}`) : null,
    filesBlock(t, k, gk, dk, m, on),
  ].filter(Boolean);
}

// -> Element: the splitter, then the detail box (git-detail) with the fixed height `m.height`. No commit: git-detail has no child.
//   m: { height, commit: Commit | null, refs: Ref[] of the commit, slot: lane color of its row (default 0), now: ms (default Date.now()),
//        files: { files, count, total: { add, del } } | { error } | null (still loading) }
//   on: splitDown(event, cx) · splitMove(event, cx) · splitUp(event, cx) (window px) · copyHash(cx) · file(path, cx)
export function gitDetail(t, gk, m, on) {
  const k = tokens(t);
  const dk = diffTokens(t);
  return v_flex().flex_none()
    .child(splitter(k, on))
    .child(v_flex().id("git-detail").flex_none().w_full().px(12).pb(8).gap(6).overflow_y_scrollbar().h(m.height)
      .when(Boolean(m.commit), (el) => el.children(body(t, k, gk, dk, m, on))));
}
