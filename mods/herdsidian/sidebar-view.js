// The right sidebar's tab control and rail icons (V1). Pure view helpers: main.js owns the state.
import { div, svg } from "gpui-kit";
import { RADIUS } from "./tokens.js";
import { SIDEBAR_TABS, keyHint } from "./keys.js";

const LABELS = { notes: "Notes", files: "Files", changes: "Changes" };
const ICONS = { notes: "file-text", files: "files", changes: "git-compare" };

// Each segment's tooltip: its name and, unless key hints are off, the key bound to its command.
// `bindings` keys(), `layoutName` the active layout, `hints` the keyHints setting.
export const tabTips = (bindings, layoutName, hints) => Object.fromEntries(SIDEBAR_TABS.map((id) => {
  const key = hints === "off" ? null : keyHint(bindings, `herdsidian-tabs.${id}`, layoutName);
  return [id, key ? `${LABELS[id]}  ${key}` : LABELS[id]];
}));

// The count on the Changes segment: shown only above 0.
export const changeCount = (published) => (Number.isInteger(published?.count) && published.count > 0 ? published.count : 0);

// The 3-segment control. `t` theme, `k` tokens, `tab` the selected one, `count` the Changes badge,
// `tips` the tooltips (tabTips), `onSelect(tab, cx)` a click.
export const tabControl = (t, k, { tab, count, tips = LABELS, onSelect }) =>
  div().id("sidebar-tabs").flex_1().min_w(0).flex().flex_row().gap(2).p(3).rounded(RADIUS.card).bg(k.pill)
    .children(SIDEBAR_TABS.map((id) => {
      const on = id === tab;
      return div().id(`sidebar-tab-${id}`).flex_1().min_w(0).h(26).flex().items_center().justify_center().gap(5).rounded(RADIUS.control)
        .text_size(12).cursor_pointer().tooltip(tips[id]).on_click((_e, cx) => onSelect(id, cx))
        .when(on, (el) => el.bg(t.raised).border_t(1).border_color(k.highlight).font_weight(500).text_color(t.foreground))
        .when(!on, (el) => el.text_color(t.muted).hover((s) => s.text_color(t.foreground)))
        .child(LABELS[id])
        .when(id === "changes" && count > 0, (el) => el.child(
          div().id("sidebar-changes-badge").h(16).min_w(16).px(4).flex_none().flex().items_center().justify_center().rounded(RADIUS.control)
            .bg(k.accentSoft).text_size(10.5).text_color(t.foreground).child(String(count))));
    }));

// One rail icon per tab; the selected one sits on k.pill.
export const railTabs = (t, k, { tab, onSelect }) =>
  SIDEBAR_TABS.map((id) =>
    div().id(`sidebar-rail-${id}`).size(28).flex_none().flex().items_center().justify_center().rounded(RADIUS.control)
      .text_color(id === tab ? t.foreground : t.muted).when(id === tab, (el) => el.bg(k.pill))
      .hover((s) => s.bg(k.pill).text_color(t.foreground)).cursor_pointer().tooltip(LABELS[id]).on_click((_e, cx) => onSelect(id, cx))
      .child(svg(`mods/workspace-chrome/${ICONS[id]}.svg`).size(14)));
