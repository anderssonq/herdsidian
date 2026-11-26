// The right sidebar's tab control, rail icons, body frame and split view. Pure view helpers: main.js owns the state.
// The control draws one sliding pill; the segments carry the drag handlers, the drop bar and the right-click.
import { div, svg } from "gpui-kit";
import { v_resizable, resizable_panel } from "gpui-base";
import { RADIUS } from "./tokens.js";
import { SIDEBAR_TABS, keyHint } from "./keys.js";
import { SIDEBAR_WIDTH } from "./sidebar.js";
import { PILL_MOTION, BODY_MOTION } from "./sidebar-motion.js";
import { dropSide } from "./sidebar-drag.js";
import { iconButton } from "./icon-button.js";

const LABELS = { notes: "Notes", files: "Files", changes: "Changes", git: "Git" };
const ICONS = { notes: "file-text", files: "files", changes: "git-compare", git: "git-branch" };

const PAD = 3, GAP = 2, SEG_H = 26;
const HEADER_CHROME = 56; // header: 12 + 8 padding, 8 gap, 28 px button

// Each segment's tooltip: its name and, unless key hints are off, the key bound to its command.
// `bindings` keys(), `layoutName` the active layout, `hints` the keyHints setting.
export const tabTips = (bindings, layoutName, hints) => Object.fromEntries(SIDEBAR_TABS.map((id) => {
  const key = hints === "off" ? null : keyHint(bindings, `herdsidian-tabs.${id}`, layoutName);
  return [id, key ? `${LABELS[id]}  ${key}` : LABELS[id]];
}));

// The count on the Changes segment: shown only above 0.
export const changeCount = (published) => (Number.isInteger(published?.count) && published.count > 0 ? published.count : 0);

// The control's width from the block's width, or null when the block is unknown.
export const tabsWidth = (blockWidth) => (Number.isFinite(blockWidth) ? blockWidth - HEADER_CHROME : null);

// The pill's box for slot `index` of `count`, in px. With no width it is percent: it fills the slot only roughly.
export function pillSlot(index, count, width) {
  if (!Number.isFinite(width)) return { left: `${(index * 100) / count}%`, width: `${100 / count}%` };
  const w = (width - 2 * PAD - GAP * (count - 1)) / count;
  return { left: PAD + index * (w + GAP), width: w };
}

// The one pill: first child of the control, so the segments paint over it.
const pill = (t, k, slot, slide) => {
  const el = div().id("sidebar-tabs-pill").absolute().top(PAD).h(SEG_H).left(slot.left).w(slot.width)
    .bg(t.raised).border_t(1).border_color(k.highlight).rounded(RADIUS.control);
  return slide ? el.transition("left", PILL_MOTION).transition("width", PILL_MOTION) : el;
};

// The 2 px bar on the landing side of the target segment.
const dropBar = (t, side) => {
  const bar = div().id("sidebar-tabs-drop").absolute().top(0).bottom(0).w(2).bg(t.accent);
  return side === "left" ? bar.left(0) : bar.right(0);
};

// The segmented control. `t` theme, `k` tokens, `tab` the selected one, `count` the Changes badge, `tips` the tooltips,
// `onSelect(tab, cx)` a click, `order` the stored order, `pillTab` where the pill sits, `width` the control's px (or null),
// `slide` whether the pill moves with a transition, `drag` the drag state, `on` the pointer handlers (a missing one is not attached).
export const tabControl = (t, k, { tab, count, tips = LABELS, onSelect, order = SIDEBAR_TABS, pillTab = tab, width = null, slide = false, drag = null, on = {} }) => {
  const at = Math.max(0, order.indexOf(pillTab));
  const dragging = drag && drag.over !== drag.from;
  return div().id("sidebar-tabs").relative().flex_1().min_w(0).flex().flex_row().gap(GAP).p(PAD).rounded(RADIUS.card).bg(k.pill)
    .when(Boolean(on.up), (el) => el.on_mouse_up("left", (e, cx) => on.up(e, cx)))
    .when(Boolean(on.windowMove), (el) => el.on_window_mouse_move((e, cx) => on.windowMove(e, cx)))
    .when(Boolean(on.size), (el) => el.on_size_change((size, cx) => on.size(size, cx)))
    .child(pill(t, k, pillSlot(at, order.length, width), slide))
    .children(order.map((id) => {
      const selected = id === tab;
      const side = dropSide(order, drag, id);
      return div().id(`sidebar-tab-${id}`).relative().flex_1().min_w(0).h(SEG_H).flex().items_center().justify_center().gap(5).rounded(RADIUS.control)
        .text_size(12).cursor_pointer().tooltip(tips[id]).on_click((_e, cx) => onSelect(id, cx))
        .when(Boolean(on.press), (el) => el.on_mouse_down("left", (e, cx) => on.press(id, e, cx)))
        .when(Boolean(on.move), (el) => el.on_mouse_move((e, cx) => on.move(id, e, cx)))
        .when(Boolean(on.release), (el) => el.on_mouse_up("left", (e, cx) => on.release(id, e, cx)))
        .when(Boolean(on.menu), (el) => el.on_mouse_down("right", (e, cx) => on.menu(id, e, cx)))
        .when(dragging && drag.from === id, (el) => el.opacity(0.5))
        .when(selected, (el) => el.font_weight(500).text_color(t.foreground))
        .when(!selected, (el) => el.text_color(t.muted).hover((s) => s.text_color(t.foreground)))
        .child(LABELS[id])
        .when(id === "changes" && count > 0, (el) => el.child(
          div().id("sidebar-changes-badge").h(16).min_w(16).px(4).flex_none().flex().items_center().justify_center().rounded(RADIUS.control)
            .bg(k.accentSoft).text_size(10.5).text_color(t.foreground).child(String(count))))
        .when(Boolean(side), (el) => el.child(dropBar(t, side)));
    }));
};

// One rail icon per tab, in the stored order; the top tab sits on k.pill.
export const railTabs = (t, k, { tab, onSelect, order = SIDEBAR_TABS }) =>
  order.map((id) =>
    div().id(`sidebar-rail-${id}`).size(28).flex_none().flex().items_center().justify_center().rounded(RADIUS.control)
      .text_color(id === tab ? t.foreground : t.muted).when(id === tab, (el) => el.bg(k.pill))
      .hover((s) => s.bg(k.pill).text_color(t.foreground)).cursor_pointer().tooltip(LABELS[id]).on_click((_e, cx) => onSelect(id, cx))
      .child(svg(`mods/workspace-chrome/${ICONS[id]}.svg`).size(14)));

// The frame around one tab body. `motion` is the step's body ({ tab, opacity, left }) or null: it applies to its own tab only.
export const bodyFrame = (tab, body, motion) => {
  const own = motion?.tab === tab ? motion : null;
  return div().id(`sidebar-body-${tab}`).relative().flex_1().min_h(0).flex().flex_col().overflow_hidden()
    .opacity(own ? own.opacity : 1).left(own ? own.left : 0)
    .transition("opacity", BODY_MOTION).transition("left", BODY_MOTION)
    .child(body);
};

// Two sections with a draggable divider. top and bottom: { tab, frame }. `splitTop` the stored height of the top one.
export const splitFrame = (t, k, { top, bottom, splitTop = null, onResize, onClose }) =>
  v_resizable("sidebar-split").flex_1().min_h(0).on_resize((sizes, cx) => onResize(sizes, cx))
    .child(resizable_panel().size_range(SIDEBAR_WIDTH.minPanel).when(Number.isFinite(splitTop), (el) => el.size(splitTop)).child(top.frame))
    .child(resizable_panel().size_range(SIDEBAR_WIDTH.minPanel).child(
      div().id("sidebar-below").size_full().flex().flex_col().min_h(0)
        .child(div().id("sidebar-below-header").h(28).flex_none().flex().flex_row().items_center().gap(6).px(8)
          .border_t(1).border_color(k.line).text_size(12).text_color(t.muted)
          .child(svg(`mods/workspace-chrome/${ICONS[bottom.tab]}.svg`).size(14))
          .child(div().flex_1().min_w(0).child(LABELS[bottom.tab]))
          .child(iconButton("sidebar-below-close", t, "x", "Close", (e, cx) => onClose(e, cx)))
        )
        .child(bottom.frame)));
