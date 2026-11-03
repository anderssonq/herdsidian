// Herdsidian's status bar: a restyled clone of Herdr's shipped `workspace-status` mod (0.1.10).
// Machine, branch, agent counts, and the current theme name at the right.
// Reads settings only, no network. Colors come from theme() through ./tokens.js (ADR-0001).

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, themes, settings, run } from "herdr";
import { tokens } from "./tokens.js";
import { needsPill } from "./ui.js";

// The pill's words: "Needs you" for one blocked agent, "Needs you · N" for several.
export const needsLabel = (n) => (n > 1 ? `Needs you · ${n}` : "Needs you");

// The first blocked agent in the list, or undefined.
export const firstBlocked = (list) => list.find(a => a.status === "blocked");

// The theme's name: settings().theme (a name, or { light, dark } by appearance), else the
// themes() entry whose accent and chrome match theme().
function themeName(t) {
  const set = settings();
  const named = set?.theme;
  if (typeof named === "string") return named;
  if (named && typeof named === "object") {
    const pick = set.dark ? named.dark : named.light;
    if (typeof pick === "string") return pick;
  }
  return themes().find(x => x.colors.accent === t.accent && x.colors.chrome === t.chrome)?.name ?? "";
}

export default class Status extends View {
  render() {
    const t = theme();
    const k = tokens(t);
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const working = list.filter(a => a.status === "working").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    const dot = (color, size) => div().size(size).flex_none().rounded_full().bg(color);
    return h_flex().size_full().px(16).gap(16).items_center().bg(k.mainGlass).text_size(11).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center()
        .child(working > 0 ? dot(t.working, 5) : dot(t.dim, 5))
        .child(working > 0 ? div().text_color(t.working).child(`${working} working`) : `${list.length} agents`)
        .when(needs > 0, el => el.child(needsPill(t, k, t.canvas, needsLabel(needs))
          .id("status-needs")
          .cursor_pointer()
          .tooltip("Go to the blocked agent")
          .on_click(() => run("pane.focus", { pane: firstBlocked(list).pane })))))
      .child(div().flex_1())
      .child(div().id("theme-name").child(themeName(t)));
  }
}
