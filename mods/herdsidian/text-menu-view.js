// The right-click menu on text (Notes, Files, Changes, Git): a popup copy of this mod. Notes (main.js) starts it when
// props().textMenu is set. Copy rows write the clipboard here, from the text in props; the rows that change Notes'
// state (cut, paste, select all, send, edit, open in Files) post one request to shared(TEXT_ACTION_KEY) and close.
// shared() is saved to disk, so a request never carries text: Cut and Send copy here, and Notes reads the clipboard.
// The root has an explicit width and height: a size_full root paints nothing on a frame "none" surface.
import { v_flex, h_flex } from "gpui-base";
import { div } from "gpui-kit";
import { theme, setShared, closeOverlay, props } from "herdr";
import { tokens, RADIUS } from "./tokens.js";
import { NOTES_OPS, TEXT_ACTION_KEY, TEXT_MENU, textMenuSize } from "./text-menu.js";

export class TextMenu {
  constructor(cx) {
    const p = props()?.textMenu ?? {};
    this.items = Array.isArray(p.items) ? p.items : [];
    this.texts = p.texts ?? {};
    this.target = p.target ?? null;
    // The overlay id is kept at open: props may no longer name it when a row is clicked.
    this.overlay = props()?.overlay;
    this.done = false;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  close() {
    this.done = true;
    closeOverlay(this.overlay);
  }

  // Herdr's close hook (forwarded by Notes): nothing is pending here.
  closed() {
    this.done = true;
  }

  choose(id, cx) {
    if (this.done) return;
    // Cut and Send copy here, like Copy; Notes then removes the selection, or pastes the clipboard into the agent.
    const copied = id === "cut" ? this.texts.copy : id === "send" ? this.texts.send : NOTES_OPS.includes(id) ? undefined : this.texts[id];
    if (typeof copied === "string") cx.write_to_clipboard(copied);
    if (NOTES_OPS.includes(id)) {
      setShared(TEXT_ACTION_KEY, { id: `t${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now(), op: id, target: this.target });
    }
    this.close();
  }

  key(e, cx) {
    if (e.key !== "escape") return;
    this.close();
    cx.stop_propagation();
  }

  row(t, k, item, i) {
    if (item.sep) return div().id(`text-menu-sep-${i}`).h(TEXT_MENU.sep).flex_none().flex().items_center().child(div().w_full().h(1).bg(k.line));
    const off = item.disabled;
    return h_flex().id(`text-menu-${item.id}`).h(TEXT_MENU.row).flex_none().px(10).gap(8).items_center().rounded(RADIUS.control)
      .text_size(12.5).text_color(off ? t.muted : t.foreground)
      .when(!off, (el) => el.cursor_pointer().hover((s) => s.bg(k.pill)).on_click((_e, cx) => this.choose(item.id, cx)))
      .child(div().flex_1().min_w(0).truncate().child(item.label))
      .when(Boolean(item.keys), (el) => el.child(div().flex_none().text_size(11).text_color(t.muted).child(item.keys)));
  }

  render() {
    const t = theme(), k = tokens(t), { width, height } = textMenuSize(this.items);
    return v_flex().id("text-menu").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .w(width).h(height).p(TEXT_MENU.pad / 2).rounded(RADIUS.overlay).border_1().border_color(t.border).bg(t.popover)
      .children(this.items.map((item, i) => this.row(t, k, item, i)));
  }
}
