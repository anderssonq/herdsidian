// The popup menu of a right-clicked sidebar tab: one row, "Open below" or "Close below". Notes (main.js) starts it
// when props().sidebarMenu is set. It writes the layout store itself, from fresh reads, and closes.
// The root has an explicit width and height: a size_full root paints nothing on a frame "none" surface.
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, setShared, closeOverlay, props } from "herdr";
import { tokens, RADIUS } from "./tokens.js";
import { MENU } from "./actions.js";
import { SIDEBAR_TABS } from "./keys.js";
import { SIDEBAR_STORE, SIDEBAR_LAYOUT_STORE, readSidebar, readSidebarLayout, resolveSplit } from "./sidebar.js";

const LABELS = { "open-below": "Open below", "close-below": "Close below" };

export class TabMenu {
  constructor(cx) {
    const p = props()?.sidebarMenu ?? {};
    this.tab = p.tab;
    this.op = p.op === "close-below" ? "close-below" : "open-below";
    // The overlay id is kept at open: props may no longer name it when a row is clicked.
    this.overlay = props()?.overlay;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  close() {
    closeOverlay(this.overlay);
  }

  // Herdr's close hook (forwarded by Notes): nothing is pending here.
  closed() {}

  // Both stores are read again: the tab may have become the top since the menu opened.
  choose() {
    const top = readSidebar(shared(SIDEBAR_STORE)).tab;
    const stored = readSidebarLayout(shared(SIDEBAR_LAYOUT_STORE));
    // Close only when this tab is still the bottom one: a stale menu must not close another pair.
    if (this.op === "close-below") {
      if (resolveSplit(top, stored.split).bottom === this.tab) setShared(SIDEBAR_LAYOUT_STORE, { ...stored, split: null });
    }
    else if (SIDEBAR_TABS.includes(this.tab) && this.tab !== top) setShared(SIDEBAR_LAYOUT_STORE, { ...stored, split: { top, below: this.tab } });
    this.close();
  }

  key(e, cx) {
    if (e.key !== "escape") return;
    this.close();
    cx.stop_propagation();
  }

  render() {
    const t = theme();
    return v_flex().id("sidebar-menu").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .w(MENU.width).h(MENU.row + MENU.pad).p(MENU.pad / 2).rounded(RADIUS.overlay).border_1().border_color(t.border).bg(t.popover)
      .child(h_flex().id(`sidebar-menu-${this.op}`).h(MENU.row).px(10).items_center().rounded(RADIUS.control)
        .text_size(12.5).text_color(t.foreground).cursor_pointer()
        .hover((s) => s.bg(tokens(t).pill)).on_click(() => this.choose()).child(LABELS[this.op]));
  }
}
