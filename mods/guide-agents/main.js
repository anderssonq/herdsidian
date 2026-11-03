// Agents in grouped or priority views; parents take their most urgent sub-agent's place.
// A viewed done agent stays in Done until left.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, layout, nextCommand } from "herdr";
import { alpha, tokens } from "./tokens.js";
import { icon, dot, alertMark, needsPill } from "./ui.js";
import { find, narrow, toggleSidebar } from "./layout.js";
import { settings } from "./settings.js";

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function lead(tab, all = panes()) {
  const mine = all.filter(p => p.tab === tab.id && p.terminal);
  return mine.find(p => p.program?.agent) ?? mine.find(p => p.focused) ?? mine[0];
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  const telling = live && live !== prog && !/^[~/]|^[A-Za-z]:\\/.test(live) && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return tab.name === prog && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export const STATUS_TEXT = { working: "Working", blocked: "Needs you", done: "Done", idle: "Idle" };

// The agent's icon tile: the program icon centered, else the first letter of `fallback`.
// 20 px (radius 6, 13 px icon) for main rows, 16 px (radius 5, 11 px icon) for sub-agents and the rail.
function tile(t, p, fallback, size, bg) {
  const big = size === 20;
  const pic = icon(p, big ? 13 : 11, t.foreground);
  return div().relative().size(size).flex_none().rounded(big ? 6 : 5).bg(bg).flex().items_center().justify_center()
    .child(pic ?? div().text_size(big ? 11 : 10).font_semibold().text_color(t.muted).child([...(fallback ?? "")][0]?.toUpperCase() ?? "?"));
}

// `over` laid on `base` at opacity `a`, as an opaque "#rrggbb" (inputs "#rrggbb" or "#rrggbbaa").
// `a` defaults to `over`'s own alpha byte, so a tokens.js color like accentSoft keeps its one source.
function blend(base, over, a = over.length === 9 ? parseInt(over.slice(7, 9), 16) / 255 : 1) {
  const ch = (c, i) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  return "#" + [0, 1, 2].map((i) => Math.round(ch(base, i) * (1 - a) + ch(over, i) * a).toString(16).padStart(2, "0")).join("");
}

// The status badge at a tile's bottom-right corner: an 8 px dot (blocked: a 12 px "!" mark) inside a
// 2 px ring, opaque so it reads as cut out of the tile. The ring is t.chrome, or on the focused row
// (accentSoft over glass) that row's composited color, so it doesn't show as a notch.
const badge = (t, status, focused) => {
  const ring = focused ? blend(t.chrome, tokens(t).accentSoft) : t.chrome;
  const blocked = status === "blocked";
  const size = blocked ? 16 : 12;
  return div().absolute().right(blocked ? -6 : -4).bottom(blocked ? -6 : -4).size(size).flex_none().rounded_full()
    .bg(ring)
    .flex().items_center().justify_center().child(blocked ? alertMark(t, 12, ring) : dot(t, status, 8, 0));
};

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    this.folded = new Set();
    // The whole section's fold (A5): per copy, not kept across restarts.
    this.sectionFolded = false;
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    cx.timer.every(30000, (cx) => cx.notify());
    // keys.json: "cmd-alt-1": "guide-agents.focus-1" shows the first agent in the list.
    this.order = [];
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        const a = this.order[Number(c.replace("focus-", "")) - 1];
        if (a) run("pane.focus", { pane: a.pane });
        cx.notify();
      }
    });
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  setPins(pins) {
    this.pins = pins;
    localStorage.setItem("pins", JSON.stringify(pins));
  }

  // Drops pins of agents that ended. Only for machines the list has heard from:
  // right after a start, or while a machine connects, its agents aren't listed yet.
  prunePins(all) {
    const machine = (addr) => (addr.includes("/") ? addr.split("/")[0] : "");
    const heard = new Set(all.map((k) => machine(k.address)));
    const live = new Set(all.filter((k) => k.state === "live").map((k) => k.address));
    const kept = this.pins.filter((p) => !heard.has(machine(p)) || live.has(p));
    if (kept.length !== this.pins.length) this.setPins(kept);
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  // Looking at a done agent makes it idle; it stays with Done until you leave
  // it rather than drop away under you. Any other change moves it at once.
  hold(list) {
    const cur = list.find((a) => a.focused);
    const same = cur && cur.address === this.held?.address;
    // Arriving, or any change but done turning idle, sets what it was.
    if (!same || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    const sawDone = a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle";
    return sawDone ? RANK.done : RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.muted).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(tokens(t).pill))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(8)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(tokens(t).pill))
      .on_click(() => this.peek(k.address))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1.5).border_color(t.input))
        .when(l === "└" || l === "├", el => el.border_b(1.5).rounded_bl(6))))
      .child(tile(t, k.program, k.program?.name || k.name || k.template, 16, tokens(t).pill).mr(6))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact, on ? t.raised : t.chrome));
  }

  toggleFold(addr) {
    this.folded.has(addr) ? this.folded.delete(addr) : this.folded.add(addr);
  }

  // With sub-agents, the icon tile folds them like the chevron does; without, a click focuses the pane.
  foldable(el, a, subs) {
    if (subs.length === 0) return el;
    return el
      .id(`agent-fold-${a.address}`)
      .cursor_pointer()
      .tooltip(this.folded.has(a.address) ? "Unfold sub-agents" : "Fold sub-agents")
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.toggleFold(a.address);
        cx.notify();
      });
  }

  // compact: a ! for blocked where a header already says "Needs you". `surface` is what lies under it.
  status(t, a, compact = false, surface = t.chrome) {
    if (a.status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).mx(1).flex_none().text_color(t.working).spin(900);
    if (a.status === "blocked" && compact) return alertMark(t, 14, surface);
    if (a.status === "blocked") return needsPill(t, tokens(t), surface);
    // Idle: a ring; done: a dot.
    return dot(t, a.status, 7, 3);
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const tk = tokens(t);
    const collapsed = narrow();
    // The 44 px rail has no room for a tile next to the number; the 76 px mac rail has.
    // Narrower than 72 px, a two-digit number would run into the tile.
    const railWide = (find(layout(), "sidebar")?.size?.px ?? Infinity) >= 72;
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    this.hold(list);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    const rankOf = (a) => urgency.get(a.address);
    if (byPriority) list = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
    this.prunePins(all);
    const pinned = this.pins.map((p) => list.find((a) => a.address === p)).filter(Boolean);
    const rest = list.filter((a) => !this.pins.includes(a.address));
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));
    this.order = list;
    // The palette's ⌥⌘N hints read this; written only when the order changes.
    const published = list.slice(0, 9).map((a) => a.address);
    if (JSON.stringify(published) !== JSON.stringify(shared("guide-agents.order") ?? null)) setShared("guide-agents.order", published);

    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(4)
        .text_size(11)
        .text_color(open ? t.muted : (t[top] ?? t.muted))
        .cursor_pointer()
        .hover((s) => s.bg(tk.pill).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.toggleFold(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    const tabs = spaces().flatMap(s => s.tabs);
    const label = (a) => {
      const tab = tabs.find(tab => tab.id === a.tab);
      return tab ? title(tab, lead(tab)) : a.title || a.program?.name || "";
    };
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    const row = (a, i, subs = []) => {
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .hover((s) => s.bg(tk.pill))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .when(railWide, el => el.child(tile(t, a.program, a.program?.name || a.title, 16, tk.pill)))
          .child(div().flex_1().min_w(0))
          .child(div().min_w(16).flex_none().whitespace_nowrap().text_right().text_color(t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = this.since(a);
      const n = list.indexOf(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = this.pins.includes(a.address);
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(4)
        .text_color(t.muted)
        .cursor_pointer()
        .hover((s) => s.bg(tk.pill).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.setPins(isPinned ? this.pins.filter((p) => p !== a.address) : [...this.pins, a.address]);
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || isPinned;
      const name = full ? a.space_name || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      return h_flex()
        .id(`ag-${a.address}`)
        .px(8)
        .py(7)
        .flex_none()
        .rounded(8)
        .items_center()
        .gap(10)
        .when(a.focused, (el) => el.bg(tk.accentSoft))
        .cursor_pointer()
        .hover((s) => s.bg(a.focused ? tk.accentSoft : tk.pill))
        .on_hover((on, cx) => {
          if (on) this.hovered = a.address;
          else if (this.hovered === a.address) this.hovered = null;
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .child(this.foldable(tile(t, a.program, a.program?.name || name, 20, a.focused ? alpha(t.foreground, 0.10) : tk.pill).child(badge(t, a.status, a.focused)), a, subs))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(h_flex().min_w(0).gap(5).items_center()
            .child(div().min_w(0).max_w(full && more ? 120 : 200).truncate().font_weight(a.focused ? 500 : 400).text_color(idle ? t.muted : t.foreground).child(name))
            .when(full && Boolean(more), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(`\u00b7 ${more}`)))
            .when(Boolean(machine), el => el.child(div().flex_none().text_size(10).text_color(t.muted).child(machine)))
            .when(subs.length > 0, el => el.child(fold(a, subs))))
          .child(div().text_size(11.5).text_color(a.status === "blocked" ? t.blocked : t.muted).font_weight(a.status === "blocked" ? 500 : 400).child(STATUS_TEXT[a.status] ?? "")))
        .child(v_flex().flex_none().items_end().gap(1).text_size(11).text_color(t.muted)
          .child(h_flex().h(18).items_center()
            .when(this.hovered === a.address, el => el.child(pin))
            .when(this.hovered !== a.address && Boolean(when), el => el.child(duration(now - when))))
          .child(div().child(n < 9 && settings().keyHints ? `\u2318\u2325${n + 1}` : "")));
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : a.space_name || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      return h_flex()
        .id(g.id)
        .px(8)
        .pt(8)
        .h(30)
        .flex_none()
        .gap(6)
        .items_center()
        .text_size(11)
        .font_medium()
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(div().truncate().text_color(t[g.status] ?? t.muted).child(g.label))
        .when(byPriority || !open, (el) => el.child(div().text_color(t.muted).child(String(g.members.length))))
        .child(div().flex_1())
        .when(!open, (el) => el
          .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
          .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.muted)));
    };
    const rows = collapsed
      ? list.flatMap(withKids)
      : this.sectionFolded
        ? []
        : groups.flatMap((g) => [header(g), ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids))]);

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(tk.glass)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .px(8)
            .h(24)
            .flex_none()
            .items_center()
            .gap(8)
            .child(h_flex()
              .id("ag-section")
              .gap(4)
              .items_center()
              .cursor_pointer()
              .text_size(11)
              .font_semibold()
              .text_color(t.muted)
              .hover((s) => s.text_color(t.foreground))
              .on_click((_e, cx) => {
                this.sectionFolded = !this.sectionFolded;
                cx.notify();
              })
              .child(svg(`mods/workspace-chrome/chevron-${this.sectionFolded ? "right" : "down"}.svg`).size(11).flex_none())
              .child("Agents"))
            .child(div().flex_1().min_w(0).truncate().text_right().text_size(11).text_color(t.muted).child(settings().keyHints ? "\u2318\u2325 1\u20139 \u00b7 \u2318[ \u2318]" : ""))
            .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(t.muted)
                .hover((s) => s.text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "guide-agents", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))
                .tooltip(`Sort agents: ${sort.label}`)
                .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
            ),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.muted).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").children(rows))
      .child(
        h_flex()
          .h(28)
          .px(12)
          .items_center()
          .justify_end()
          .when(collapsed, (el) => el.justify_center().px(0))
          .child(
            div()
              .id("collapse")
              .text_size(13)
              .text_color(t.muted)
              .hover((s) => s.text_color(t.foreground))
              .on_click(toggleSidebar)
              .child(collapsed ? "»" : ""),
          ),
      );
  }
}
