// Sidebar header (app icon and name, hide-sidebar button, over the top sheen and dot
// texture) and footer (Settings, Add machine). Glass, sheen and dot colors come from
// tokens.js, never from a hex.

import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window as appWindow, updates } from "herdr";
import { tokens } from "./tokens.js";
import { glow, headerDots } from "./ui.js";
import { narrow, toggleSidebar } from "./layout.js";

export default class WorkspaceChrome extends View {
  render() {
    const t = theme();
    const k = tokens(t);
    const collapsed = narrow();
    if (props()?.footer) {
      const row = (id, icon, label, action) => h_flex().id(id).h(32).flex_none().px(8).gap(10).items_center().rounded(8)
        .text_color(t.muted).hover(s => s.bg(k.pill)).cursor_pointer()
        .on_click(action).child(svg(`mods/workspace-chrome/${icon}.svg`).size(14))
        .when(!collapsed, el => el.child(label));
      return v_flex().size_full().bg(k.glass).px(8).pt(6).pb(8).gap(2).text_size(13)
        .child(row("settings", "settings", "Settings", () => run("app.settings"))
          .when(Boolean(updates().app.ready), el => el.child(div().size(6).rounded_full().bg(t.accent))))
        .child(row("machine", "plus", "Add machine", () => run("mod.open", { name: "machine-add" })));
    }
    const macos = appWindow()?.platform === "macos";
    return h_flex().relative().overflow_hidden().size_full().bg(k.glass).pl(collapsed ? 0 : macos ? 84 : 14).pr(collapsed ? 0 : 10).items_center()
      .when(collapsed, el => el.justify_center())
      .child(glow(k))
      .child(headerDots(k, "herdsidian-chrome", 0))
      // The app icon, then the name, beside the macOS traffic lights (or at the left edge elsewhere).
      .when(!collapsed, el => el.child(image("mods/herdsidian-chrome/herdsidian.svg").size(18).flex_none().mr(7)))
      .when(!collapsed, el => el.child(div().flex_1().min_w(0).truncate().text_size(13).font_medium().text_color(t.muted).child("Herdsidian")))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!(collapsed && macos), el => el.child(div().id("sidebar-toggle").size(28).flex_none().flex().items_center().justify_center().rounded(6)
        .text_color(t.muted).hover(s => s.bg(k.pill))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(toggleSidebar)
        .child(svg("mods/workspace-chrome/sidebar.svg").size(15))));
  }
}
