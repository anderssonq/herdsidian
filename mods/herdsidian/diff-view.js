// The diff view of the Changes and Git tabs: header, file tabs, note and the virtual list of rows. Plans:
// .spec/herdsidian-changes-v2-plan.md and .spec/herdsidian-git-tab-plan.md.
// diffView is a function of a plain model `m` plus callbacks `on`; changes-view.js and git-view.js own the state, and
// paneParts builds the part of `m` and `on` that comes from their DiffPane.
// A row made inside the list renderer has no id, no handler, no hover and no tooltip (the host throws): the handlers sit outside it.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar } from "gpui-base";
import { settings } from "herdr";
import { RADIUS, CLEAR, tokens } from "./tokens.js";
import { iconButton } from "./icon-button.js";
import { ROW_H, CODE_SIZE, MAX_LINES, SIGN_W, splitPath, numWidth } from "./diff.js";
import { diffMenu } from "./text-menu.js";

const MINUS = "−";
const HATCH = "mods/herdsidian/diff-hatch.svg";
const ARROW_UP = "mods/herdsidian/arrow-up.svg";
const ARROW_DOWN = "mods/herdsidian/arrow-down.svg";
const MONO = "Menlo";
const SIGNS = { context: " ", add: "+", del: MINUS };

// A header button that cannot act: muted, no hover, no click.
const idleButton = (id, t, icon, tip) =>
  div().id(id).size(28).flex_none().flex().items_center().justify_center().text_color(t.muted).tooltip(tip)
    .child(svg(icon).size(14));

const modeButton = (t, m, on, mode, label) =>
  div().id(`diff-mode-${mode}`).px(7).h(20).flex().items_center().rounded(RADIUS.control).text_size(11.5).cursor_pointer()
    .text_color(m.mode === mode ? t.foreground : t.muted).when(m.mode === mode, (el) => el.bg(t.raised))
    .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => on.toggle(mode, cx)).child(label);

function header(t, k, m, on) {
  const { dir, name } = splitPath(m.file.path);
  return h_flex().id("diff-header").flex_none().pt(2).pr(8).pb(6).pl(8).gap(4).items_center()
    .child(iconButton("diff-back", t, "chevron-left", m.backTip ?? "Back to the changes", (_e, cx) => on.back(cx)))
    .child(v_flex().id("diff-path").flex_1().min_w(0)
      .child(div().truncate().font_semibold().child(name))
      .child(div().truncate().text_size(10.5).text_color(t.muted).child(`${dir}${name}`)))
    .child(h_flex().flex_none().p(1).gap(1).items_center().rounded(RADIUS.control).bg(k.pill)
      .child(modeButton(t, m, on, "unified", "Unified"))
      .child(modeButton(t, m, on, "split", "Split")))
    .child(m.prev ? iconButton("diff-prev", t, ARROW_UP, "Previous file", (_e, cx) => on.prev(cx)) : idleButton("diff-prev", t, ARROW_UP, "Previous file"))
    .child(m.next ? iconButton("diff-next", t, ARROW_DOWN, "Next file", (_e, cx) => on.next(cx)) : idleButton("diff-next", t, ARROW_DOWN, "Next file"))
    .when(!m.hideOpenFiles, (el) => el.child(iconButton("diff-open-files", t, "file-text", "Open in Files", (_e, cx) => on.openFiles(cx))));
}

// One tab per listed file; the open one has a 2 px accent line under it.
function tab(t, dk, file, open, on) {
  return v_flex().id(`diff-tab-${file.path}`).flex_none().cursor_pointer().tooltip(file.path)
    .on_click((_e, cx) => on.pick(file.path, cx))
    .child(h_flex().h(26).px(10).gap(6).items_center().text_size(12).text_color(open ? t.foreground : t.muted)
      .child(div().child(splitPath(file.path).name))
      .when(file.add > 0, (el) => el.child(div().text_size(11).text_color(dk.addText).child(`+${file.add}`)))
      .when(file.del > 0, (el) => el.child(div().text_size(11).text_color(dk.delText).child(`${MINUS}${file.del}`))))
    .child(div().h(2).w_full().when(open, (el) => el.bg(t.accent)));
}

function tabs(t, dk, m, on) {
  return h_flex().id("diff-tabs").flex_none().overflow_x_scroll()
    .when(Boolean(m.handles?.tabs), (el) => el.track_scroll(m.handles.tabs))
    .children(m.files.map((file, i) => tab(t, dk, file, i === m.index, on)));
}

// The code of one side, clipped; a line too long for the cell already comes cut into rows (wrapRows).
const codeCell = (dk, cell) => {
  const text = cell.text;
  const word = cell.word;
  const piece = (str, tint) => div().flex_none().whitespace_nowrap().when(Boolean(tint), (el) => el.bg(tint)).child(str);
  const tint = cell.kind === "add" ? dk.addWord : dk.delWord;
  const pieces = word && text.length > 0
    ? [text.slice(0, word[0]), text.slice(word[0], word[1]), text.slice(word[1])].map((s, i) => (s ? piece(s, i === 1 ? tint : null) : null)).filter(Boolean)
    : text ? [piece(text, null)] : [];
  return div().flex_1().min_w(0).h_full().overflow_hidden()
    .child(h_flex().h_full().flex_none().items_center().text_color(dk.text).children(pieces));
};

const numCell = (dk, nw, n) => div().w(nw).flex_none().px(4).text_right().text_color(dk.numText).child(n === null || n === undefined ? "" : String(n));

// A row that goes on from the line above (cont) shows no sign.
const signCell = (dk, kind, cont) => div().w(SIGN_W).flex_none().text_center()
  .text_color(kind === "add" ? dk.addText : kind === "del" ? dk.delText : dk.numText).child(cont ? "" : SIGNS[kind]);

const lineTint = (dk, kind) => (kind === "add" ? dk.addLine : kind === "del" ? dk.delLine : null);

// A muted line over the whole row: hunk titles use the tint, banners and notes do not.
const banner = (dk, text, tint) =>
  div().w_full().h(ROW_H).flex_none().px(8).flex().items_center().truncate().text_color(dk.numText).when(Boolean(tint), (el) => el.bg(tint)).child(text);

function unifiedRow(dk, nw, row) {
  if (row.type === "hunk") return banner(dk, row.title, dk.hunk);
  if (row.type === "note") return h_flex().w_full().h(ROW_H).flex_none().items_center().child(div().w(nw * 2 + SIGN_W).flex_none()).child(div().truncate().text_color(dk.numText).child(row.text));
  return h_flex().w_full().h(ROW_H).flex_none().items_center().when(Boolean(lineTint(dk, row.kind)), (el) => el.bg(lineTint(dk, row.kind)))
    .child(numCell(dk, nw, row.old)).child(numCell(dk, nw, row.new)).child(signCell(dk, row.kind, row.cont))
    .child(codeCell(dk, row));
}

// One side of a split row; a null cell is the filler of the side that has no line.
function splitSide(k, dk, nw, cell) {
  if (!cell) {
    return div().flex_1().min_w(0).h_full().relative().overflow_hidden()
      .child(svg(HATCH).w(2400).h(ROW_H).absolute().top(0).left(0).text_color(k.line));
  }
  if (cell.kind === "note") return h_flex().flex_1().min_w(0).h_full().items_center().child(div().w(nw + SIGN_W).flex_none()).child(div().truncate().text_color(dk.numText).child(cell.text));
  return h_flex().flex_1().min_w(0).h_full().items_center().when(Boolean(lineTint(dk, cell.kind)), (el) => el.bg(lineTint(dk, cell.kind)))
    .child(numCell(dk, nw, cell.no)).child(signCell(dk, cell.kind, cell.cont))
    .child(codeCell(dk, cell));
}

function splitRow(k, dk, nw, row) {
  if (row.type === "hunk") return banner(dk, row.title, dk.hunk);
  return h_flex().w_full().h(ROW_H).flex_none()
    .child(splitSide(k, dk, nw, row.left))
    .child(div().w(1).h_full().flex_none().bg(k.line))
    .child(splitSide(k, dk, nw, row.right));
}

const renamed = (file) => `Renamed from ${file.from}`;

// The rows the list shows: a rename note first, the model's rows, the cap note last. Only indexes are mapped, nothing is copied.
function listing(m) {
  const { rows, more } = m.body;
  const head = m.file.from ? [{ type: "banner", text: renamed(m.file) }] : [];
  const tail = more ? [{ type: "banner", text: `Showing the first ${MAX_LINES} of ${more} lines.` }] : [];
  return { head: head.length, count: head.length + rows.length + tail.length, at: (i) => (i < head.length ? head[i] : i < head.length + rows.length ? rows[i - head.length] : tail[i - head.length - rows.length]) };
}

// A right-click on a row: the index in m.body.rows (the rename banner comes first) and, in split, the side under the
// pointer. The banners have no menu.
function menuAt(m, on, key, e, cx) {
  const index = key - listing(m).head;
  if (!Number.isInteger(index) || index < 0 || index >= m.body.rows.length) return;
  const x = e?.local_position?.x, w = e?.bounds?.width;
  const side = m.mode === "split" && Number.isFinite(x) && Number.isFinite(w) && x < w / 2 ? "left" : "right";
  on.menu(index, side, e, cx);
}

function code(t, k, dk, m, on) {
  const list = listing(m);
  const nw = numWidth(m.body.rows);
  const row = (r) => (r.type === "banner" ? banner(dk, r.text, null) : m.mode === "split" ? splitRow(k, dk, nw, r) : unifiedRow(dk, nw, r));
  const lines = v_virtual_list("diff-lines", list.count, ROW_H, (i) => String(i),
    (range) => Array.from({ length: Math.max(0, range.end - range.start) }, (_, i) => row(list.at(range.start + i))))
    .w_full().when(Number.isFinite(m.height), (el) => el.h(m.height)).when(!Number.isFinite(m.height), (el) => el.size_full())
    .when(Boolean(on.menu), (el) => el.on_item_secondary_click((key, e, cx) => menuAt(m, on, Number(key), e, cx)));
  return div().id("diff-code").flex_1().min_h(0).relative().overflow_hidden().font_family(m.font ?? MONO).text_size(CODE_SIZE).text_color(dk.text)
    .when(Boolean(m.wellOn && dk.well), (el) => el.bg(dk.well))
    .on_size_change((size, cx) => on.size(size, cx))
    .child(lines)
    .child(Scrollbar.vertical("diff-lines").viewport_from_layout().absolute().inset_0());
}

const notice = (t, text) => div().id("diff-notice").flex_1().min_h(0).p(12).text_size(12).text_color(t.muted).child(text);

// The header and tabs are the real ones; only the code area waits.
const loading = (t) => div().flex_1().min_h(0).p(12).text_size(12).text_color(t.muted).child("Loading diff…");

// Herdr's zoom (1 when unknown): sizes and event positions come in window px.
export const zoomOf = () => {
  const zoom = settings()?.zoom;
  return typeof zoom === "number" && zoom > 0 ? zoom : 1;
};

// The right-click handler of a shown diff for diffView's `on.menu`, or null while it loads or shows a notice (Changes
// and Git). `root`: the repo root, for the full path and Open in Files; `canOpen`: the Files tab can show the file.
export function diffMenuOn(host, parts, open, loading, { root, canOpen }) {
  if (loading || !open.body.hunks) return null;
  const file = open.file;
  return (index, side, e, cx) => host.textMenu(e, cx, {
    ...diffMenu({ rows: parts.m.body.rows, hunks: open.body.hunks, index, side, path: file.path, full: root ? `${root}/${file.path}` : null,
      from: file.from ?? null, status: file.status ?? null, canOpen }),
    target: { surface: "diff", root, path: file.path },
  });
}

// The part of diffView's `m` and `on` that comes from a tab's DiffPane: the mode, the body (loading, rows or a notice),
// the sizes, the font, and the toggle and size callbacks. `open` is the diff named in the header, with
// `reading` while another file is read.
export function paneParts(t, pane, open, reading) {
  const { mode, note } = pane.mode();
  const body = reading ? { loading: true } : open.body.hunks ? { rows: pane.rowsOf(open, mode), more: open.body.more } : open.body;
  const font = settings()?.font_family;
  return {
    m: { mode, note, body, height: pane.code?.height ?? null, wellOn: t.background === CLEAR,
      font: typeof font === "string" && font ? font : undefined },
    on: {
      toggle: (mode, cx) => { pane.toggle(mode); cx.notify(); },
      size: ({ width, height }, cx) => {
        const zoom = zoomOf();
        if (pane.sized({ width: width / zoom, height: height / zoom })) cx.notify();
      },
    },
  };
}

// -> Element. `m`: { file, files, index, prev, next, mode, note, body, height, wellOn, handles, font?, hideOpenFiles?, backTip? }
//   file/files: list rows { path, from, status, add, del } · prev/next: a path or null · mode: "unified" | "split" as shown
//   note: show the narrow-sidebar note
//   hideOpenFiles: true leaves out the "Open in Files" button (then openFiles is not needed) · backTip: the tooltip of the
//   back button (default "Back to the changes")
//   body: { rows, more } (rows from unifiedRows or splitRows; `more` is the real line count when capped) or { notice } or { loading: true }
//   height: the code area's height in css px, or null · handles: { focus, tabs } made in a spawn task, or undefined
// `on`, each with the gpui `cx` last: back(cx) · openFiles(cx) · prev(cx) · next(cx) · pick(path, cx) · toggle(mode, cx)
//   key(event, cx) · press(event, cx) · size({ width, height }, cx) (raw window px; the caller divides by the zoom)
//   menu(index, side, event, cx) (optional): a right-click on row `index` of m.body.rows, `side` "left" or "right"
export function diffView(t, dk, m, on) {
  const k = tokens(t);
  return v_flex().id("diff-view").flex_1().min_h(0)
    .when(Boolean(m.handles?.focus), (el) => el.track_focus(m.handles.focus))
    .on_key_down((e, cx) => on.key(e, cx))
    .on_mouse_down("left", (e, cx) => on.press(e, cx))
    .child(header(t, k, m, on))
    .child(tabs(t, dk, m, on))
    .when(Boolean(m.note), (el) => el.child(div().id("diff-note").flex_none().px(10).pb(4).text_size(11).text_color(t.muted).child("Split needs a sidebar of 520 px or more: shown unified.")))
    .when(Boolean(m.body.notice && m.file.from), (el) => el.child(banner(dk, renamed(m.file), null)))
    .child(m.body.loading ? loading(t) : m.body.notice ? notice(t, m.body.notice) : code(t, k, dk, m, on));
}
