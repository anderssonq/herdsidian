// The ⌘K palette's controller: the state, the keys and the actions of the popup copy of this mod.
// Notes (main.js) starts it when props().overlay is set. All ranking is in palette.js, all drawing in
// palette-view.js, the one Send sequence in send.js (ADR-0002: paste only, never submit).
// The two copies share no module state, so the vault, the auto links, the agent memory and the agent
// order come through shared() (ADR-0003). Send pastes, then closes (Herdr returns the keyboard by itself);
// ⌘↵ arrives as a submit with `secondary`; ⇥ reaches on_key_down; the card is as high as its content.

import { InputState } from "gpui-base";
import { theme, agents, spaces, panes, focused, keys, layout, shared, setShared, home, run, notify, props, closeOverlay,
  knownAgents, readTextFile } from "herdr";
import { base, render as toMarkdown } from "./notes.js";
import { emptyDoc, pickAgent } from "./context.js";
import { stateDir, loadContext, saveContext, allNotes, noteTime } from "./io.js";
import {
  ROW, LIST_MAX, TABS, scene, commandList, settingSections, buildList, rankNoteRows, hasMod, agentHint, topMeta, wrap, sendState, planSend, footer,
  visibleWindow, isShown, targetAgent, sameKey, rankKey, modelKey,
} from "./palette.js";
import { sendText } from "./send.js";
import { find } from "./layout.js";
import { settings, setSetting } from "./settings.js";
import { paletteCard, PLACEHOLDER, linkPlaceholder } from "./palette-view.js";

const TAB_LABELS = { all: "All", notes: "Notes", agents: "Agents", commands: "Commands", settings: "Settings" };
const PREVIEW_CHARS = 2048;
const REFOCUS_MS = 600; // Herdr may take the keyboard back right after the popup opens (AC15)
const deps = { run, focused, notify };

export class Palette {
  constructor(cx) {
    // The target is fixed here: the agent focused when ⌘K was pressed (AC27). Rows never change it.
    const all = spaces();
    const picked = pickAgent({ agents: agents(), focused: focused(), spaces: all, memory: shared("herdsidian.memory") ?? {} });
    const agent = targetAgent(picked);
    const space = all.find((s) => s.id === picked.spaceId) ?? null;
    const cwd = agent ? panes().find((p) => p.pane === agent.pane)?.cwd ?? null : null;
    this.target = { agent, space, cwd, liveIds: all.map((s) => s.id) };
    this.vault = shared("herdsidian.vault") ?? null;
    this.auto = shared("herdsidian.auto") ?? null;

    this.dead = false;
    this.query = ""; this.tab = "all"; this.linking = null; this.selectedKey = null; this.scroll = 0;
    this.notes = null; this.notesError = null; this.doc = emptyDoc(); this.stateDir = null; this.error = null; this.starter = null;
    this.guard = { sending: false }; this.checking = false; this.saving = false;
    this.mtimes = new Map(); this.statted = new Set();
    this.previewOn = false; this.previewPath = null; this.previewData = null; this.previewGen = 0;
    this.memo = null; this.list = null; this.sceneMemo = null; this.rankMemo = null;
    this.handle = cx.focus_handle();
    this.on = this.callbacks();
    this.input = this.makeInput(PLACEHOLDER);
    this.input.focus();
    cx.timer.after(REFOCUS_MS, () => { if (!this.dead) this.input.focus(); });

    // Everything slow runs off render. Agents and commands show at once; the notes arrive later (AC35, AC39).
    if (this.vault) { this.loadNotes(cx); this.loadDoc(cx); }
    if (space) this.loadStarter(cx, space);
  }

  makeInput(placeholder) {
    const input = InputState.new({ placeholder });
    input.on("change", (_e, cx) => {
      this.query = input.value(); this.selectedKey = null; this.scroll = 0;
      cx.notify();
    });
    // ↵ is a plain submit, ⌘↵ a submit with `secondary`.
    input.on("submit", (e, cx) => (e?.secondary ? this.send(cx) : this.activate(this.selectedRow(), cx)));
    return input;
  }

  loadNotes(cx) {
    const vault = this.vault;
    cx.spawn(async (cx) => {
      try { this.notes = await allNotes(vault); } catch (e) { this.notesError = String(e); }
      this.touch(cx);
    });
  }

  loadDoc(cx) {
    cx.spawn(async (cx) => {
      try {
        this.stateDir = await stateDir();
        this.doc = (await loadContext(this.stateDir)).doc;
      } catch (e) { this.error = String(e); }
      this.touch(cx);
    });
  }

  loadStarter(cx, space) {
    cx.spawn(async (cx) => {
      try { this.starter = (await knownAgents({ on: space.machine })).find((a) => a.installed) ?? null; } catch {}
      this.touch(cx);
    });
  }

  touch(cx) {
    if (!this.dead) cx.notify();
  }

  close() {
    closeOverlay(props().overlay);
  }

  // Herdr's close hook (forwarded by Notes). Send pastes, then closes, and Herdr returns the keyboard
  // by itself, so only the pending work needs to know that the popup is gone.
  closed() {
    this.dead = true;
  }

  selectedRow() {
    const pickable = this.list?.pickable ?? [];
    return pickable.find((r) => r.key === this.selectedKey) ?? pickable[0] ?? null;
  }

  // What ↵ and a click do on a row (AC23). The request keys are read by Notes (handleShared).
  activate(row, cx) {
    if (!row || this.saving) return;
    if (row.kind === "note") return this.linking ? this.link(row, cx) : this.openNote(row);
    if (row.kind === "agent") {
      this.close();
      if (row.agent.pane) run("pane.focus", { pane: row.agent.pane });
      else run("agent.focus", { terminal: row.agent.address });
      return;
    }
    // Settings change in place: the palette stays open and its row shows the new value.
    if (row.kind === "setting") {
      const change = row.setting.action;
      if (change.type === "setting") setSetting(change.name, change.value);
      else run(change.name, change.args);
      cx.notify();
      return;
    }
    const action = row.command.action;
    if (action.type === "link") return this.enterLink(cx);
    if (action.type === "request") return this.request(action.op);
    this.close();
    run(action.name, action.args);
  }

  // A request for the Notes copy, then Notes is shown (a hidden one starts and reads a fresh request), then close.
  request(op, path) {
    setShared("herdsidian.request", { id: `p${Date.now()}`, at: Date.now(), op, ...(path ? { path } : {}), vault: this.vault });
    run("layout.show", { id: "herdsidian" });
    this.close();
  }

  openNote(row) {
    this.request("open", row.path);
  }

  // Link mode: the Notes tab only, with its own placeholder and a chip (plan, Decision 6).
  enterLink(cx) {
    const space = this.target.space;
    if (!space || !this.vault) return;
    // The old input is left to Herdr: it is released with this short-lived copy, not inside its own event.
    this.input = this.makeInput(linkPlaceholder(space.name));
    this.linking = { space: space.name };
    this.query = ""; this.selectedKey = null; this.scroll = 0;
    this.input.focus();
    cx.timer.after(REFOCUS_MS, () => { if (!this.dead) this.input.focus(); });
    cx.notify();
  }

  // The same save as phase 2's ⌘L (saveContext), then Notes reloads the file (context-rev).
  link(row, cx) {
    const where = this.memo?.scene.where;
    if (!where) { this.error = "No space to link notes to"; return cx.notify(); }
    this.saving = true;
    cx.spawn(async (cx) => {
      try {
        this.stateDir ??= await stateDir();
        await saveContext(this.stateDir, { type: "link", note: row.path }, where, this.target.liveIds);
        setShared("herdsidian.context-rev", (Number(shared("herdsidian.context-rev")) || 0) + 1);
        notify({ title: `Linked ${row.label} to ${where.name}.`, level: "success" });
        if (!this.dead) this.close();
      } catch (e) {
        this.error = String(e);
        this.touch(cx);
      } finally {
        this.saving = false;
      }
    });
  }

  // ⌘↵ (AC26-28). The note must still exist (AC36), then send.js pastes and the palette closes itself.
  send(cx) {
    const row = this.selectedRow();
    const { agent, space } = this.target;
    const plan = (mtime) => planSend({
      row, target: agent, space, vault: this.vault, mtime, checking: this.checking, sending: this.guard.sending,
      dead: this.dead, close: () => this.close(),
    });
    if (plan(undefined).type !== "stat") return;
    this.checking = true;
    cx.notify();
    try {
      cx.spawn(async (cx) => {
        let mtime;
        try {
          mtime = await noteTime(`${this.vault}/${row.path}`);
        } finally {
          this.checking = false;
        }
        const next = plan(mtime);
        if (next.type === "toast") {
          notify({ title: next.title, level: next.level });
          return cx.notify();
        }
        if (next.type === "send") sendText(cx, this.guard, next, deps, () => next.onDone(this.dead));
      });
    } catch (e) {
      this.checking = false; // Never leave Send stuck on "Sending…".
      throw e;
    }
  }

  callbacks() {
    return {
      key: (e, cx) => {
        if (e.key === "down" || e.key === "up") {
          const pickable = this.list?.pickable ?? [];
          const at = Math.max(0, pickable.findIndex((r) => r.key === this.selectedRow()?.key));
          this.selectedKey = pickable[wrap(at, e.key === "down" ? 1 : -1, pickable.length)]?.key ?? null;
        } else if (e.key === "tab") {
          if (this.selectedRow()?.kind === "note") this.previewOn = !this.previewOn; // AC24: nothing on other rows
        } else return;
        cx.stop_propagation();
        cx.notify();
      },
      tab: (id, cx) => {
        if (this.linking || id === this.tab) return;
        this.tab = id; this.selectedKey = null; this.scroll = 0;
        this.input.focus();
        cx.notify();
      },
      choose: (key, cx) => this.activate(this.list?.pickable.find((r) => r.key === key), cx),
      // The wheel moves the strip; the selection follows it so the next frame does not scroll back.
      scroll: (deltaY, cx) => {
        const rows = this.list?.pickable ?? [];
        const max = Math.max(0, rows.length * ROW.row - LIST_MAX);
        this.scroll = Math.max(0, Math.min(this.scroll - deltaY, max));
        const first = Math.ceil(this.scroll / ROW.row), last = Math.max(first, Math.floor((this.scroll + LIST_MAX) / ROW.row) - 1);
        const at = Math.max(0, rows.findIndex((r) => r.key === this.selectedRow()?.key));
        this.selectedKey = rows[Math.min(Math.max(at, first), last)]?.key ?? null;
        cx.notify();
      },
    };
  }

  // The context of the target space; rebuilt only when the doc or the notes change.
  sceneFor() {
    const m = this.sceneMemo;
    if (m && m.doc === this.doc && m.notes === this.notes) return m.value;
    const value = scene({ doc: this.doc, target: this.target, vault: this.vault, cwd: this.target.cwd, auto: this.auto, all: this.notes ?? [], home: home() });
    this.sceneMemo = { doc: this.doc, notes: this.notes, value };
    return value;
  }

  // The ranked note rows, memoized on (query, tab, notes, linked) apart from the agents: an animated agent
  // title must not re-rank 5,000 notes (AC37). null when this view shows no ranked notes.
  rankedFor(tab, sc) {
    if (!this.vault || !this.notes || this.notesError || this.query.trim() === "" || (tab !== "all" && tab !== "notes")) return null;
    const key = rankKey({ query: this.query, tab, notes: this.notes, linked: sc.linked });
    const m = this.rankMemo;
    if (m && sameKey(m.key, key)) return m.rows;
    const rows = rankNoteRows(this.notes, this.query, sc.linked);
    this.rankMemo = { key, rows };
    return rows;
  }

  // The list is memoized on everything it reads, so a render with nothing new is cheap. The note ranking
  // has its own memo (rankedFor): only the agent rows and the commands rebuild when an agent changes.
  model() {
    const tab = this.linking ? "notes" : this.tab;
    const live = agents();
    const tree = layout();
    const hasList = hasMod(tree, "guide-agents");
    const notesHidden = !isShown(tree, "herdsidian");
    // Notes is a rail under 160 px, as Notes itself decides (main.js narrow()).
    const notesRail = (find(tree, "herdsidian")?.size?.px ?? Infinity) < 160;
    const current = settings();
    const bindings = keys(), layoutName = shared("layout"), order = shared("guide-agents.order");
    const inputs = modelKey({
      query: this.query, tab, notes: this.notes, notesError: this.notesError, doc: this.doc, linking: this.linking,
      starter: this.starter, agents: live, order, layoutName, bindings, notesHidden, hasList, settings: current, notesRail,
    });
    if (this.memo && sameKey(this.memo.inputs, inputs)) return this.memo;

    const commands = commandList({
      vault: this.vault, notesHidden, space: this.target.space, starter: this.starter, bindings, layoutName,
    });
    const sc = this.sceneFor();
    const list = buildList({
      query: this.query, tab, vault: this.vault, notes: this.notes, notesError: this.notesError, linked: sc.linked,
      contextPaths: sc.contextPaths, agents: live, commands, hintFor: (address) => agentHint(address, order, bindings, layoutName, hasList),
      rankedNotes: this.rankedFor(tab, sc), settings: settingSections({ settings: current, notesHidden, notesRail }),
    });
    this.memo = { inputs, tab, scene: sc, list };
    return this.memo;
  }

  // The second line of the Top hit. A note's edit time comes from noteTime, fetched once per top-hit path.
  topLine(row, memo, cx) {
    if (row.kind === "agent") return [row.agent.space_name, row.agent.title].filter(Boolean).join(" · ");
    if (row.kind !== "note") return "";
    this.statTop(row.path, cx);
    return topMeta({ path: row.path, linkedTo: memo.scene.linked.has(row.path) ? this.target.space?.name : null, mtime: this.mtimes.get(row.path), now: Date.now() });
  }

  // One `stat` for the top hit when it changes, off render (AC38).
  statTop(path, cx) {
    if (this.statted.has(path)) return;
    this.statted.add(path);
    cx.spawn(async (cx) => {
      await cx.sleep(0); // let the render that started this finish first
      this.mtimes.set(path, await noteTime(`${this.vault}/${path}`));
      this.touch(cx);
    });
  }

  // The read-only preview of the selected note (AC24): its first 2 KB, read on each selection change.
  previewFor(row, cx) {
    const path = this.previewOn && row?.kind === "note" ? row.path : null;
    if (path !== this.previewPath) {
      this.previewPath = path;
      const gen = ++this.previewGen;
      if (path) {
        cx.spawn(async (cx) => {
          await cx.sleep(0);
          const text = await readTextFile(`${this.vault}/${path}`).catch(() => null);
          if (this.dead || gen !== this.previewGen) return;
          this.previewData = text === null
            ? { path, title: base(path), markdown: "", error: `Cannot read ${path}` }
            : { path, title: base(path), markdown: toMarkdown(text.slice(0, PREVIEW_CHARS)), error: null };
          cx.notify();
        });
      }
    }
    const data = path && this.previewData?.path === path ? this.previewData : null;
    return data && { path: data.path, title: data.title, markdown: data.markdown, error: data.error };
  }

  render(cx) {
    const t = theme();
    const memo = this.model();
    const { list } = memo;
    this.list = list;
    const row = this.selectedRow();

    const single = memo.tab !== "all" && list.sections.length === 1;
    let strip = null;
    if (single) {
      const rows = list.sections[0].rows;
      const at = rows.findIndex((r) => r.key === row?.key);
      strip = { ...visibleWindow(rows.map(() => ROW.row), this.scroll, LIST_MAX, 2, at), viewport: LIST_MAX };
      this.scroll = strip.scroll;
    }

    const send = sendState({ row, target: this.target.agent, space: this.target.space, vault: this.vault, sending: this.checking || this.guard.sending });
    const entries = footer({ row, send, preview: { supported: true } });
    if (this.linking) entries[0] = { ...entries[0], label: "Link" };
    const ids = this.vault ? TABS : TABS.filter((id) => id !== "notes");

    const m = {
      input: this.input, focus: this.handle, linking: this.linking,
      tabs: (this.linking ? ["notes"] : ids).map((id) => ({ id, label: TAB_LABELS[id], active: id === memo.tab })),
      top: list.top && { ...list.top, meta: this.topLine(list.top, memo, cx) },
      sections: list.sections, empty: list.empty, selected: row?.key ?? null, window: strip,
      preview: this.previewFor(row, cx), footer: entries, error: this.error,
      firstRun: !this.vault,
    };
    return paletteCard(t, m, this.on);
  }
}
