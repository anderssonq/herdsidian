// Sidebar header (hide-sidebar button over the top sheen) and footer (Settings,
// Add machine). Glass and sheen colors come from tokens.js, never from a hex.

import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window as appWindow, shared, setShared, updates, layout } from "herdr";
import { tokens } from "./tokens.js";
import { glow } from "./ui.js";
import { find } from "./layout.js";

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 248) : appWindow()?.platform === "macos" ? 76 : 44 });
}

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
    return h_flex().relative().size_full().bg(k.glass).pl(collapsed ? 0 : macos ? 84 : 14).pr(collapsed ? 0 : 10).items_center()
      .when(collapsed, el => el.justify_center())
      .when(!collapsed, el => el.justify_end())
      .child(glow(k))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!(collapsed && macos), el => el.child(div().id("sidebar-toggle").size(28).flex_none().flex().items_center().justify_center().rounded(6)
        .text_color(t.muted).hover(s => s.bg(k.pill))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(toggleSidebar)
        .child(svg("mods/workspace-chrome/sidebar.svg").size(15))));
  }
}
