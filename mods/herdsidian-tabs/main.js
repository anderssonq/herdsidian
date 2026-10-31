// Herdsidian's toolbar: a restyled clone of Herdr's shipped `tabs` mod (0.1.10).
// Tabs as a segmented control, Search, the Notes toggle, Files / Changes and the window buttons.
// Colors come from theme() through ./tokens.js (ADR-0001). The panel / drag / rename / menu
// code is the shipped code; only the render chain is restyled.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings } from "herdr";
import { alpha, tokens, statusDot, PULSE, HIGHLIGHT } from "./tokens.js";
import { glow, icon } from "./ui.js";
import { find } from "./layout.js";

// A status dot: a fill, or a ring for idle; a working dot pulses.
const dot = (t, status, size) => {
  const d = statusDot(t, status);
  return div().size(size).flex_none().rounded_full()
    .when(d.fill, el => el.bg(d.fill))
    .when(d.ring, el => el.border(1.5).border_color(d.ring))
    .when(d.pulse, el => el.loop("opacity", PULSE));
};

export default class Tabs extends View {
  init() {
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const stored = this.panels[space.id] ?? null, want = enabled.includes(stored) ? stored : null;
        if (want !== now) {
          this.pending = { want, until: Date.now() + 1000 };
          if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
          else run("layout.hide", { id: "panel" });
          return;
        }
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const k = tokens(t);
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    const hover = s => s.bg(k.pill).text_color(t.foreground);
    // A 30 px muted icon button; `on` is the pressed look (Files / Changes / Notes).
    const button = (id, label, action, on = false, tip = null) => div().id(id).size(30).flex_none().flex().items_center().justify_center().rounded(8)
      .text_color(on ? t.foreground : t.muted).cursor_pointer().when(on, el => el.bg(k.pill)).hover(s => on ? s.bg(alpha(t.foreground, 0.10)).text_color(t.foreground) : hover(s))
      .when(tip, el => el.tooltip(tip))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return h_flex().id(`tab-${c.id}`).h(28).px(12).gap(8).rounded(7).items_center().flex_none().text_size(12.8)
        .border_t(1).border_color(c.active ? HIGHLIGHT : alpha(t.foreground, 0))
        .bg(c.active ? t.raised : alpha(t.foreground, 0)).text_color(c.active ? t.foreground : t.muted)
        .when(c.active, el => el.font_medium())
        .when(!c.active, el => el.hover(s => s.bg(k.pill)))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(c.status), el => el.child(dot(t, c.status, 6)))
        .when(Boolean(program?.icon), el => el.child(icon(program, 14, c.active ? t.foreground : t.muted)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.muted).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/herdsidian-tabs/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(16, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 16;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return button(`panel-${id}`, svg(icon).size(16), () => {
        if (on) run("layout.hide", { id: "panel" });
        else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
      }, on, label);
    };
    const notes = find(root, "herdsidian");
    const notesOn = Boolean(notes) && !notes.hidden;
    const search = h_flex().id("search").w(220).h(30).flex_none().px(10).gap(8).items_center().rounded(8).bg(k.pill).text_size(12.5).text_color(t.muted)
      .cursor_pointer().hover(s => s.bg(alpha(t.foreground, 0.10)))
      .on_mouse_down("left", stop).on_click(() => run("mod.open", { name: "picker" }))
      .child(svg("mods/workspace-chrome/search.svg").size(14).flex_none())
      .child(div().flex_1().child("Search"))
      .child(div().text_size(11).child(w?.platform === "macos" ? "⌘K" : "Ctrl K"));
    return h_flex().size_full().min_w(0).relative().pr(12).pl(lightsPadding).gap(12).items_center().bg(k.mainGlass)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(glow(k))
      .child(h_flex().id("tab-bar").min_w(0).p(3).gap(2).items_center().rounded(10).bg(k.pill)
        .child(h_flex().id("tab-scroll").flex_1().min_w(0).items_center().gap(2).overflow_x_scrollbar().children(shown.map(item))))
      .child(button("tab-new", svg("mods/workspace-chrome/plus.svg").size(16), () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }), false, "New tab"))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .child(div().flex_1().h_full())
      .child(search)
      .child(button("notes-toggle", svg("mods/workspace-chrome/panel-right.svg").size(16), () => run("layout.toggle", { id: "herdsidian" }), notesOn, "Notes"))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/herdsidian-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/herdsidian-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/herdsidian-tabs/win-close.svg").size(16) : svg("mods/herdsidian-tabs/close.svg").size(13), () => run("window.close"))));
  }
}
