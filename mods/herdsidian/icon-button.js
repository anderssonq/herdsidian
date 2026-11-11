// The 28 px icon button of the sidebar: Notes' sub-header and the Files header use it.
// `icon`: a workspace-chrome icon name, or a path with a "/".
import { div, svg } from "gpui-kit";
import { RADIUS, tokens } from "./tokens.js";

export const iconButton = (id, t, icon, tip, action) =>
  div().id(id).size(28).flex_none().flex().items_center().justify_center().rounded(RADIUS.control).text_color(t.muted)
    .hover((s) => s.bg(tokens(t).pill).text_color(t.foreground)).cursor_pointer().tooltip(tip).on_click(action)
    .child(svg(icon.includes("/") ? icon : `mods/workspace-chrome/${icon}.svg`).size(14));
