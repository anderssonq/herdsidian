// Herdsidian's pane header: a restyled clone of Herdr's shipped `pane` mod (0.1.10), for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "herdsidian-pane" } } } }
// Shows the agent's name or the terminal's title, the folder, and the agent's status;
// buttons split, zoom and close this pane. A 14 px program icon leads the title. Props from the app: { pane, terminal }.
// Click: focus the pane. Colors come from theme() through ./tokens.js (ADR-0001).

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home } from "herdr";
import { tokens, statusDot, PULSE, HIGHLIGHT } from "./tokens.js";
import { icon } from "./ui.js";

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

export default class Pane extends View {
  init() { this.hovered = false; }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, k, id, icon, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.muted)
      .hover((s) => s.bg(k.pill).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/herdsidian-pane/${icon}.svg`).size(14));
  }

  render() {
    const t = theme();
    const k = tokens(t);
    const p = this.me();
    if (!p) return div();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const st = p.status;
    const pane = p.pane;
    const dot = st === "working" || st === "done" ? statusDot(t, st) : null;
    return h_flex()
      .id(`pane-head-${pane}`)
      .size_full()
      .px(16)
      .gap(8)
      .items_center()
      .bg(t.background)
      .border_t(1)
      .border_color(HIGHLIGHT)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_click(() => run("pane.focus", { pane }))
      .when(Boolean(p.program?.icon), el => el.child(icon(p.program, 14, t.muted)))
      .child(div().flex_none().truncate().max_w(260).font_medium().text_color(t.foreground).child(name))
      .child(div().flex_1().truncate().text_color(t.muted).child(folder(p.cwd)))
      .when(dot, el => el.child(div().size(6).flex_none().rounded_full().bg(dot.fill)
        .when(dot.pulse, d => d.loop("opacity", PULSE))))
      .when(st === "blocked", el => el.child(div().flex_none().px(6).h(18).flex().items_center().rounded(5).bg(k.blockedSoft).border(1).border_color(t.blocked).text_size(10.5).font_semibold().text_color(t.foreground).child("Needs you")))
      .when(this.hovered, el => el
        .child(this.button(t, k, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, k, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, k, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, k, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
