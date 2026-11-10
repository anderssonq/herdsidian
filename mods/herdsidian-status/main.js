// Herdsidian's status bar: a restyled clone of Herdr's shipped `workspace-status` mod (0.1.10).
// Machine, branch, agent counts, the "Needs you" pill, and Usage at the right.
// Usage fetches nothing until the pointer first enters it (see usage.js). Colors come from theme()
// through ./tokens.js (ADR-0001).

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, panes, focused, keys, shared, theme, run, exec, readTextFile, knownAgents } from "herdr";
import { tokens } from "./tokens.js";
import { keycap, needsPill } from "./ui.js";
import { keyHint } from "./keys.js";
import { settings } from "./settings.js";
import { createUsage, providersFrom } from "./usage.js";
import { focusedProgramKey, orderedProviders } from "./usage-status.js";
import { usageCard, usageStatusControl } from "./usage-view.js";
import { nextBlocked } from "./blocked.js";

// The pill's words: "Needs you" for one blocked agent, "Needs you · N" for several.
export const needsLabel = (n) => (n > 1 ? `Needs you · ${n}` : "Needs you");

// The agents in the Agents list's published order (shared "guide-agents.order", its first nine);
// the rest keep their model order after them.
export const inListOrder = (list, order) => {
  const at = (a) => { const i = Array.isArray(order) ? order.indexOf(a.address) : -1; return i < 0 ? Infinity : i; };
  return [...list].sort((a, b) => at(a) - at(b));
};

const NEXT_BLOCKED = "guide-agents.next-blocked";

// A failed knownAgents() at load is asked again once after this long (see loadAgents).
const AGENTS_RETRY_MS = 5000;

export default class Status extends View {
  init(_props, cx) {
    // Usage: no reading is fetched until the pointer first enters the control (the cache is in
    // memory). The agent list loads at init and is retried once if that load fails.
    this.cx = cx;
    this.agents = null; this.agentsFailed = false; this.agentsLoad = null; this.agentsRetried = false;
    this.usage = createUsage({
      exec,
      readTextFile,
      after: (ms, fn) => { const task = this.cx.timer.after(ms, fn); return () => task?.cancel(); },
      onChange: () => this.cx.notify(),
    });
    if (settings().usageInStatus) this.loadAgents();
  }

  // The installed agents, asked again on every hover (Herdr caches the answer for a minute).
  // A rejection leaves the list empty and `agentsFailed` set, and asks once more 5 s later
  // (one retry per failure streak, so a broken shell never loops). Never rejects.
  loadAgents() {
    this.agentsLoad ??= (async () => {
      await null; // so the assignment below lands before this clears it
      try { this.agents = await knownAgents(); this.agentsFailed = false; this.agentsRetried = false; }
      catch {
        this.agents = null; this.agentsFailed = true;
        if (!this.agentsRetried) {
          this.agentsRetried = true;
          this.cx.timer.after(AGENTS_RETRY_MS, () => { this.loadAgents(); });
        }
      }
      this.agentsLoad = null;
      this.cx.notify();
    })();
    return this.agentsLoad;
  }

  // The pointer entered the Usage control (or it was clicked): refresh the agents, then fetch what
  // is stale. Does nothing when Usage is off in the status bar.
  async hoverUsage(hovered) {
    if (!hovered || !this.usage || !settings().usageInStatus) return;
    await this.loadAgents();
    this.usage.hover(providersFrom(this.agents).map((p) => p.key));
    this.cx.notify();
  }

  // The Usage control, or null when it is off or Usage has not started (no init).
  usageControl(t, k) {
    if (!this.usage || !settings().usageInStatus) return null;
    // Usage was turned on after init: load the agents once, outside render work.
    if (this.agents === null && !this.agentsFailed && !this.agentsLoad && !this.lazyAgents) {
      this.lazyAgents = true;
      this.cx.spawn(() => this.loadAgents());
    }
    const programKey = focusedProgramKey(focused(), panes());
    const providers = orderedProviders(providersFrom(this.agents), programKey);
    const view = key => this.usage.view(key);
    return usageStatusControl(t, k, {
      providers, view, now: Date.now(),
      onHover: hovered => { this.hoverUsage(hovered); },
      card: usageCard(t, k, {
        providers, agentsKnown: this.agents !== null, failed: this.agentsFailed, view, now: Date.now(),
        // Tag only when the focused pane itself runs this provider, not for the fallback primary.
        focusedKey: programKey && providers.some(p => p.key === programKey) ? programKey : null,
      }),
    });
  }

  render() {
    const t = theme();
    const k = tokens(t);
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const working = list.filter(a => a.status === "working").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    const dot = (color, size) => div().size(size).flex_none().rounded_full().bg(color);
    const usage = this.usageControl(t, k);
    const hints = settings().keyHints;
    const chord = keyHint(keys(), NEXT_BLOCKED, shared("layout")) ?? "⌘J";
    return h_flex().size_full().px(16).gap(16).items_center().bg(k.mainGlass).text_size(11).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center()
        .child(working > 0 ? dot(t.working, 5) : dot(t.dim, 5))
        .child(working > 0 ? div().text_color(t.working).child(`${working} working`) : `${list.length} agents`)
        .when(needs > 0, el => el.child(h_flex().gap(4).items_center()
          .child(needsPill(t, k, t.canvas, needsLabel(needs))
            .id("status-needs")
            .cursor_pointer()
            .tooltip(hints === "off" ? "Go to the blocked agent" : `Go to the blocked agent · ${chord}`)
            .on_click(() => {
              // Same as ⌘J (guide-agents.next-blocked): the next blocked agent after the focused one.
              const next = nextBlocked(inListOrder(list, shared("guide-agents.order")), focused()?.pane);
              if (next) run("pane.focus", { pane: next.pane });
            }))
          .when(hints === "always", row => row.child(keycap(t, chord))))))
      .child(div().flex_1())
      .when(Boolean(usage), el => el.child(usage));
  }
}
