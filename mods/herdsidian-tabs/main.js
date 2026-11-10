// Herdsidian's toolbar: a restyled clone of Herdr's shipped `tabs` mod (0.1.10).
// Tabs as a segmented control, +, Search, the right-sidebar toggle and the window buttons.
// Colors come from theme() through ./tokens.js (ADR-0001). The drag / rename / menu
// code is the shipped code; only the render chain is restyled.
// This mod also routes the right-sidebar keys (⇧⌘E, ⇧⌘G, ⌘⇧O) and the palette rows to the sidebar.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, setShared, layout, settings, keys, nextCommand } from "herdr";
import { RADIUS, alpha, tokens } from "./tokens.js";
import { dot, glow, headerDots, icon } from "./ui.js";
import { find } from "./layout.js";
import { keyHint, showKeyHint } from "./keys.js";
import { SIDEBAR_STORE, readSidebar, routeTab } from "./sidebar.js";
import { settings as herdsidianSettings } from "./settings.js"; // herdr has its own settings()

// The toolbar's left edge in the window: the sidebar's width plus the root divider after it,
// so the dot grid lines up across the seam. 0 when the sidebar is hidden.
export const blockX = (root, sidebar) =>
  sidebar && !sidebar.hidden ? (sidebar.size?.px ?? 0) + (root?.divider?.width ?? 0) : 0;

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.hovered = null; // the tab under the pointer: where the "modifier" key hint shows
    // keys.json "layout:herdsidian": cmd-shift-e / cmd-shift-g / cmd-shift-o -> herdsidian-tabs.files | changes | notes.
    // The palette rows run the same commands.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "files" || c === "changes" || c === "notes") this.route(c);
        cx.notify();
      }
    });
  }

  // The sidebar block hides on its own tab, shows when hidden, and only switches tab otherwise.
  route(want) {
    const block = find(layout(), "herdsidian");
    const stored = shared(SIDEBAR_STORE);
    const r = routeTab({ hidden: !block || Boolean(block.hidden), tab: readSidebar(stored).tab }, want);
    if (r.tab !== stored?.tab) setShared(SIDEBAR_STORE, { tab: r.tab });
    for (const [name, args] of r.commands) run(name, args);
  }

  render() {
    const t = theme();
    const k = tokens(t);
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    // Tooltips name the key that does the same, when one is bound (keys.json).
    const bindings = keys(), layoutName = shared("layout");
    const hint = action => keyHint(bindings, action, layoutName);
    // settings.keyHints (⌘K → Settings): inline keys beside buttons and Search only for "always";
    // tooltips carry the key for "always" and "modifier" (hover is the fallback), never for "off".
    const hints = herdsidianSettings().keyHints;
    const shownHint = hints === "always" ? hint : () => null;
    const tipFor = (label, action) => { const key = hints === "off" ? null : hint(action); return key ? `${label}  ${key}` : label; };
    // An icon with its key beside it, always shown (New, Files, Changes).
    const keyed = (icon, action) => { const key = shownHint(action);
      return h_flex().gap(6).items_center().child(icon).when(Boolean(key), el => el.child(div().text_size(11).child(key))); };
    const hover = s => s.bg(k.pill).text_color(t.foreground);
    // A 30 px muted icon button.
    const button = (id, label, action, tip = null) => div().id(id).h(30).min_w(30).px(7).flex_none().flex().items_center().justify_center().rounded(RADIUS.control)
      .text_color(t.muted).cursor_pointer().hover(hover)
      .when(tip, el => el.tooltip(tip))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const mine = panes().filter(p => p.tab === c.id);
      const program = (mine.find(p => p.program?.agent) ?? mine[0])?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      // The ⌘N key: every tab for "always", the hovered one for "modifier", none for "off" (V5).
      const key = c.index <= 9 && showKeyHint(hints, this.hovered, c.id)
        ? hint(`tab.select:${c.index}`) : null;
      return h_flex().id(`tab-${c.id}`).tooltip(tipFor(c.zoomed ? `${name} (zoomed)` : name, `tab.select:${c.index}`)).h(28).px(12).gap(8).rounded(RADIUS.control).items_center().flex_none().text_size(12.8)
        .border_t(1).border_color(c.active ? k.highlight : alpha(t.foreground, 0))
        .bg(c.active ? t.raised : alpha(t.foreground, 0)).text_color(c.active ? t.foreground : t.muted)
        .when(c.active, el => el.font_medium())
        .when(!c.active, el => el.hover(s => s.bg(k.pill)))
        .on_hover((on, cx) => {
          if (on) this.hovered = c.id;
          else if (this.hovered === c.id) this.hovered = null;
          cx.notify();
        })
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(c.status), el => el.child(dot(t, c.status, 6, 0, { pulse: false })))
        .when(Boolean(program?.icon), el => el.child(icon(program, 14, c.active ? t.foreground : t.muted)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        // The tab's key (see `key`).
        .when(Boolean(key), el => el.child(div().flex_none().text_size(11).text_color(t.muted).child(key)))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.muted).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/herdsidian-tabs/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(16, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 16;
    const search = h_flex().id("search").w(220).h(30).flex_none().px(10).gap(8).items_center().rounded(RADIUS.control).bg(k.pill).text_size(12.5).text_color(t.muted)
      .cursor_pointer().hover(s => s.bg(alpha(t.foreground, 0.10)))
      .on_mouse_down("left", stop).on_click(() => run("mod.open", { name: "herdsidian" }))
      .child(svg("mods/workspace-chrome/search.svg").size(14).flex_none())
      .child(div().flex_1().child("Search"))
      .when(Boolean(shownHint("mod.open:herdsidian")), el => el.child(div().text_size(11).child(shownHint("mod.open:herdsidian"))));
    // The right sidebar toggle: pressed while the block is shown. No key: ⌘⇧O selects Notes, it does not toggle.
    const sidebarBlock = find(root, "herdsidian");
    const sidebarShown = Boolean(sidebarBlock) && !sidebarBlock.hidden;
    const sidebarToggle = div().id("sidebar-toggle").w(30).h(30).flex_none().flex().items_center().justify_center().rounded(RADIUS.control)
      .text_color(sidebarShown ? t.foreground : t.muted).cursor_pointer()
      .when(sidebarShown, el => el.bg(alpha(t.foreground, 0.10)))
      .when(!sidebarShown, el => el.hover(hover))
      .tooltip("Right sidebar")
      .on_mouse_down("left", stop).on_click(() => run("layout.toggle", { id: "herdsidian" }))
      .child(svg("mods/workspace-chrome/panel-right.svg").size(16));
    return h_flex().size_full().min_w(0).relative().overflow_hidden().pr(12).pl(lightsPadding).gap(12).items_center().bg(k.mainGlass)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(glow(k))
      .child(headerDots(k, "herdsidian-tabs", blockX(root, sidebar)))
      .child(h_flex().id("tab-bar").min_w(0).p(3).gap(2).items_center().rounded(RADIUS.card).bg(k.pill)
        .child(h_flex().id("tab-scroll").flex_1().min_w(0).items_center().gap(2).overflow_x_scrollbar().children(shown.map(item))))
      .child(button("tab-new", keyed(svg("mods/workspace-chrome/plus.svg").size(16), "tab.new"), () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }), tipFor("New tab", "tab.new")))
      .child(div().flex_1().h_full())
      .child(search)
      .child(sidebarToggle)
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/herdsidian-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/herdsidian-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/herdsidian-tabs/win-close.svg").size(16) : svg("mods/herdsidian-tabs/close.svg").size(13), () => run("window.close"))));
  }
}
