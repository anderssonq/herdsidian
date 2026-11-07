// Herdsidian's toolbar: a restyled clone of Herdr's shipped `tabs` mod (0.1.10).
// Tabs as a segmented control, Search, the Notes toggle, Files / Changes and the window buttons.
// Colors come from theme() through ./tokens.js (ADR-0001). The panel / drag / rename / menu
// code is the shipped code; only the render chain is restyled.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings, keys, nextCommand, exec, knownAgents } from "herdr";
import { alpha, tokens } from "./tokens.js";
import { glow, headerDots, icon, dot } from "./ui.js";
import { find } from "./layout.js";
import { keyHint } from "./keys.js";
import { settings as herdsidianSettings } from "./settings.js"; // herdr has its own settings()
import { createUsage, providersFrom } from "./usage.js";
import { usageCard, usageControl } from "./usage-view.js";

// The toolbar's left edge in the window: the sidebar's width plus the root divider after it,
// so the dot grid lines up across the seam. 0 when the sidebar is hidden.
export const blockX = (root, sidebar) =>
  sidebar && !sidebar.hidden ? (sidebar.size?.px ?? 0) + (root?.divider?.width ?? 0) : 0;

export default class Tabs extends View {
  init(_props, cx) {
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
    // Usage: nothing is fetched until the pointer first enters the control (AC13). The cache is in memory.
    this.cx = cx;
    this.agents = null; this.agentsFailed = false; this.agentsLoad = null;
    this.usage = createUsage({
      exec,
      after: (ms, fn) => { const task = this.cx.timer.after(ms, fn); return () => task.cancel(); },
      onChange: () => this.cx.notify(),
    });
    this.loadAgents();
    // keys.json "layout:herdsidian": "cmd-shift-e": "herdsidian-tabs.files", "cmd-shift-g": "herdsidian-tabs.changes".
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "files" || c === "changes") this.togglePanel(c);
        cx.notify();
      }
    });
  }

  // The installed agents, asked again on every hover (Herdr caches the answer for a minute).
  // A rejection leaves the list empty and `agentsFailed` set. Never rejects.
  loadAgents() {
    this.agentsLoad ??= (async () => {
      await null; // so the assignment below lands before this clears it
      try { this.agents = await knownAgents(); this.agentsFailed = false; }
      catch { this.agents = null; this.agentsFailed = true; }
      this.agentsLoad = null;
      this.cx.notify();
    })();
    return this.agentsLoad;
  }

  // The pointer entered (or left) the Usage control: refresh the agents, then fetch what is stale.
  async hoverUsage(hovered) {
    if (!hovered) return;
    await this.loadAgents();
    this.usage.hover(providersFrom(this.agents).map((p) => p.key));
    this.cx.notify();
  }

  // Shows the side panel on `id`, or hides it when it already shows `id`.
  togglePanel(id) {
    const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
    if (panel && !panel.hidden && body?.active === id) run("layout.hide", { id: "panel" });
    else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (closed if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      const first = this.space === undefined;
      this.space = space.id; this.pending = null;
      if (!(first && !(space.id in this.panels))) {
        const want = this.panels[space.id] ?? null;
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
    // Tooltips name the key that does the same, when one is bound (keys.json).
    const bindings = keys(), layoutName = shared("layout");
    const hint = action => keyHint(bindings, action, layoutName);
    // The keys always shown beside tabs, buttons and Search; settings.keyHints (⌘K → Settings) hides them.
    const shownHint = herdsidianSettings().keyHints ? hint : () => null;
    const tipFor = (label, action) => { const key = hint(action); return key ? `${label}  ${key}` : label; };
    // An icon with its key beside it, always shown (New, Files, Changes).
    const keyed = (icon, action) => { const key = shownHint(action);
      return h_flex().gap(6).items_center().child(icon).when(Boolean(key), el => el.child(div().text_size(11).child(key))); };
    const hover = s => s.bg(k.pill).text_color(t.foreground);
    // A 30 px muted icon button; `on` is the pressed look (Files / Changes / Notes).
    const button = (id, label, action, on = false, tip = null) => div().id(id).h(30).min_w(30).px(7).flex_none().flex().items_center().justify_center().rounded(8)
      .text_color(on ? t.foreground : t.muted).cursor_pointer().when(on, el => el.bg(k.pill)).hover(s => on ? s.bg(alpha(t.foreground, 0.10)).text_color(t.foreground) : hover(s))
      .when(tip, el => el.tooltip(tip))
      .on_mouse_down("left", stop).on_click(action).child(label);
    const item = (c, i) => {
      const mine = panes().filter(p => p.tab === c.id);
      const program = (mine.find(p => p.program?.agent) ?? mine[0])?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      const key = shownHint(`tab.select:${c.index}`);
      return h_flex().id(`tab-${c.id}`).tooltip(tipFor(c.zoomed ? `${name} (zoomed)` : name, `tab.select:${c.index}`)).h(28).px(12).gap(8).rounded(7).items_center().flex_none().text_size(12.8)
        .border_t(1).border_color(c.active ? k.highlight : alpha(t.foreground, 0))
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
        // The tab's key, always shown.
        .when(Boolean(key), el => el.child(div().flex_none().text_size(11).text_color(t.muted).child(key)))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.muted).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/herdsidian-tabs/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(16, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 16;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    // Files and Changes are always on here. Herdr's "workspace.panels" is ignored: its welcome
    // writes [] when none is picked, which would hide them after an install.
    this.syncPanel(space, panel, body);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return button(`panel-${id}`, keyed(svg(icon).size(16), `herdsidian-tabs.${id}`), () => this.togglePanel(id), on, label);
    };
    const notes = find(root, "herdsidian");
    const notesOn = Boolean(notes) && !notes.hidden;
    const search = h_flex().id("search").w(220).h(30).flex_none().px(10).gap(8).items_center().rounded(8).bg(k.pill).text_size(12.5).text_color(t.muted)
      .cursor_pointer().hover(s => s.bg(alpha(t.foreground, 0.10)))
      .on_mouse_down("left", stop).on_click(() => run("mod.open", { name: "herdsidian" }))
      .child(svg("mods/workspace-chrome/search.svg").size(14).flex_none())
      .child(div().flex_1().child("Search"))
      .when(Boolean(shownHint("mod.open:herdsidian")), el => el.child(div().text_size(11).child(shownHint("mod.open:herdsidian"))));
    const providers = providersFrom(this.agents);
    const usage = usageControl(t, k, {
      providers,
      onHover: hovered => { this.hoverUsage(hovered); },
      card: usageCard(t, k, { providers, agentsKnown: this.agents !== null, failed: this.agentsFailed, view: key => this.usage.view(key), now: Date.now() }),
    });
    return h_flex().size_full().min_w(0).relative().overflow_hidden().pr(12).pl(lightsPadding).gap(12).items_center().bg(k.mainGlass)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(glow(k))
      .child(headerDots(k, "herdsidian-tabs", blockX(root, sidebar)))
      .child(h_flex().id("tab-bar").min_w(0).p(3).gap(2).items_center().rounded(10).bg(k.pill)
        .child(h_flex().id("tab-scroll").flex_1().min_w(0).items_center().gap(2).overflow_x_scrollbar().children(shown.map(item))))
      .child(button("tab-new", keyed(svg("mods/workspace-chrome/plus.svg").size(16), "tab.new"), () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }), false, "New tab"))
      .child(panelButton("files", "Files", "mods/files/file.svg"))
      .child(panelButton("changes", "Changes", "mods/changes/changes.svg"))
      .child(div().flex_1().h_full())
      .child(usage)
      .child(search)
      .child(button("notes-toggle", svg("mods/workspace-chrome/panel-right.svg").size(16), () => run("layout.toggle", { id: "herdsidian" }), notesOn, tipFor("Notes", "layout.toggle:herdsidian")))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/herdsidian-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/herdsidian-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/herdsidian-tabs/win-close.svg").size(16) : svg("mods/herdsidian-tabs/close.svg").size(13), () => run("window.close"))));
  }
}
