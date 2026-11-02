// An Obsidian vault beside the terminals: browse its folders, find a note by name,
// read it rendered (wikilinks follow) or edit and save it. Obsidian can keep the same
// vault open: saves refuse to overwrite a note changed outside since it was opened.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, InputState, Input, TextView } from "gpui-base";
import { HIDDEN, base, hidden, render, linkTarget, resolve } from "./notes.js";
import { exec, readTextFile, writeTextFile, watchFolder, pickFolder, theme, settings, nextCommand, run, layout, window,
  agents, panes, spaces, focused, home, notify, props, shared, setShared } from "herdr";
import { alpha, tokens } from "./tokens.js";
import { find } from "./layout.js";
import { buildIndex, updateIndex, missingRaw, neighborhood, layout as ringLayout, toScreen, zoomAt, sectionMessage, placeLabels, AREA } from "./graph.js";
import { emptyDoc, findEntry, autoLinks, contextNotes, suggest, deliveryText, sendOrder, pickAgent, canSend, pushRecent, matchNotes,
  pendingRequest, shouldReload, changedJson } from "./context.js";
import { stateDir, loadContext, saveContext, indexNotes, gitTop, listNotes, capNotice, backoffMs, touches, afterOutage, underVault } from "./io.js";
import { graphSection, keycap } from "./graph-view.js";
import { sendText, sendToasts } from "./send.js";
import { autoFromIndex, spaceWhere } from "./palette.js";
import { Palette } from "./palette-main.js";

// The ⌘K palette is another copy of this mod; the two copies talk through shared() keys (ADR-0003).
// A key is written only when its value changed, so a write never wakes the other copy for nothing.
const publish = (key, value) => {
  if (changedJson(shared(key), value)) setShared(key, value);
};

const NO_META = new Map();
// hidden() slices the vault off a path, so it only applies to paths under the vault.
const isHidden = (vault, p) => underVault([p], vault) && hidden(vault, p);
const leaf = (path) => (path ?? "").split("/").filter(Boolean).pop() ?? "";

// The last notes opened in the reader of one vault (suggestion source b).
const recentOf = (vault) => {
  try { const list = JSON.parse(localStorage.getItem(`recent:${vault}`) ?? "[]"); return Array.isArray(list) ? list : []; } catch { return []; }
};

// Like the left sidebar: a rail of icons by width, not a flag, so dragging it narrow counts too.
const width = () => find(layout(), "herdsidian")?.size?.px;
const narrow = () => (width() ?? Infinity) < 160;

// Folders and .md files of one folder, folders first.
async function directory(path) {
  const script = 'for p in "$1"/* "$1"/.[!.]*; do [ -e "$p" ] || continue; name=${p##*/}; if [ -d "$p" ]; then printf "d\\0%s\\0" "$name"; else case "$name" in *.[mM][dD]) printf "f\\0%s\\0" "$name";; esac; fi; done; test -d "$1"';
  const r = await exec("sh", ["-c", script, "herdsidian", path]);
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) if (!HIDDEN.has(fields[i + 1])) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

export default class Notes extends View {
  init(_props, cx) {
    // The palette popup is a copy of this mod: it starts none of the Notes work below.
    if (props()?.overlay) { this.palette = new Palette(cx); return; }
    // No vault until one is chosen: the panel asks for it.
    this.vault = localStorage.getItem("vault");
    publish("herdsidian.vault", this.vault);
    // A fresh request is left to the first render; an old one was already handled.
    const request = shared("herdsidian.request");
    this.handled = pendingRequest(request, null, this.vault, Date.now()).action === "none" ? request?.id ?? null : null;
    this.contextRev = shared("herdsidian.context-rev") ?? null;
    this.entries = new Map(); this.folders = new Set(); this.all = []; this.notice = null;
    this.note = null; this.mode = "read"; this.query = ""; this.searching = false; this.generation = 0;
    this.search = InputState.new({ placeholder: "Find a note…" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value().trim(); cx.notify(); });

    // The link graph: the index (built off the UI thread), the neighborhood of the center and its layout.
    this.index = null; this.indexing = false; this.indexGen = 0; this.indexVer = 0; this.reindexAgain = null; this.indexError = null; this.refreshFailed = false;
    this.graph = null; this.graphKey = null; this.suggestions = [];
    this.view = { panX: 0, panY: 0, zoom: 1 }; this.area = { ...AREA }; this.hover = null; this.drag = null;
    this.hidden = localStorage.getItem("graph.hidden") === "1";
    this.hops = localStorage.getItem("graph.hops") === "1" ? 1 : 2;
    this.recent = this.vault ? recentOf(this.vault) : [];
    // The Agent context: the focused agent per space, the repo folder per cwd, the context file.
    this.agentMemory = {}; this.repoOf = new Map(); this.liveNotes = null;
    this.ctx = { status: "missing", doc: emptyDoc() }; this.stateDir = null; this.ctxError = null;
    this.picking = false; this.pickQuery = "";
    this.pick = InputState.new({ placeholder: "Find a note to link…" });
    this.pick.on("change", (_e, cx) => { this.pickQuery = this.pick.value().trim(); cx.notify(); });
    this.on = this.callbacks();
    this.loadCtx(cx);

    this.load(cx);
    this.watch(cx);
    // keys.json "mod:herdsidian": "cmd-s": "herdsidian.save", "cmd-e": "herdsidian.mode".
    // "layout:herdsidian": "cmd-l": "herdsidian.link" (works while an agent terminal has the keyboard).
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "save") this.save(false, cx);
        if (c === "mode" && this.note) this.setMode(this.mode === "read" ? "edit" : "read");
        // Links the open note; with none open, opens the picker without taking the keyboard (none in the rail).
        if (c === "link") { if (this.note) this.linkCurrent(cx); else if (!narrow()) this.openPicker(cx, false); }
        // From ⌘K → Settings → Layout: Notes width.
        if ((c === "expand" && narrow()) || (c === "rail" && !narrow())) this.collapse();
        cx.notify();
      }
    });
  }

  // The context file, read off the UI thread: at start, and again when the palette changed it.
  loadCtx(cx) {
    cx.spawn(async (cx) => {
      try {
        this.stateDir ??= await stateDir();
        const loaded = await loadContext(this.stateDir);
        this.ctx = { status: loaded.status, doc: loaded.doc };
        if (loaded.status === "unsupported") this.ctxError = "Cannot save the agent context: the context file is from a newer Herdsidian";
      } catch (e) { this.ctxError = String(e); }
      cx.notify();
    });
  }

  // What the palette asked for through shared(); a request id is handled once. Called from render,
  // so the work runs in a spawn after the render (no notify or state change inside it).
  handleShared(cx) {
    const request = shared("herdsidian.request");
    const { action, id } = pendingRequest(request, this.handled, this.vault, Date.now());
    if (request && id !== this.handled) {
      this.handled = id;
      cx.spawn(async (cx) => {
        await cx.sleep(0);
        if (action === "open") {
          if (narrow()) this.collapse(); // ↵ in the palette: show the note, not just the rail (AC23).
          this.open(request.path, cx);
        } else if (action === "other-vault") notify({ title: `Note is in another vault: ${leaf(request.vault)}`, level: "warning" });
        else if (action === "choose-vault") this.chooseVault(cx);
        cx.notify();
      });
    }
    const rev = shared("herdsidian.context-rev") ?? null;
    if (shouldReload(rev, this.contextRev)) {
      this.contextRev = rev;
      cx.spawn(async (cx) => {
        await cx.sleep(0);
        this.loadCtx(cx);
      });
    }
  }

  // The tree's open folders and the note list. A folder gone since it was opened closes.
  load(cx, changed = null) {
    const vault = this.vault;
    if (!vault) return;
    cx.spawn(async (cx) => {
      try {
        const root = await directory(vault);
        if (this.vault !== vault) return;
        this.entries.set("", root);
        const paths = [...this.folders];
        const lists = await Promise.all(paths.map((path) => directory(`${vault}/${path}`).catch(() => null)));
        if (this.vault !== vault) return;
        paths.forEach((path, i) => {
          if (!this.folders.has(path)) return; // closed during the await
          if (lists[i]) this.entries.set(path, lists[i]);
          else { this.folders.delete(path); this.entries.delete(path); }
        });
        const listed = await listNotes(vault);
        if (this.vault !== vault) return;
        this.all = listed.notes; this.error = null; this.notice = capNotice(listed);
        this.reindex(cx, changed);
      } catch (e) { if (this.vault === vault) this.error = String(e); }
      cx.notify();
    });
  }

  // Links of the notes, off the UI thread: all of them the first time, then only the notes the
  // watcher reported (absolute paths; null = all). A run in progress takes one coalesced re-run.
  reindex(cx, changed) {
    const vault = this.vault;
    if (!vault) return;
    // The vault root itself, a flood of folder events, or paths not under the vault (a symlinked
    // vault reported by its real path) say too little: index everything.
    if (changed && (!underVault(changed, vault) || changed.some((p) => p === vault || p === `${vault}/`)
      || changed.filter((p) => !/\.md$/i.test(p) && !isHidden(vault, p)).length > 20)) changed = null;
    if (this.indexing) {
      const queued = this.reindexAgain;
      this.reindexAgain = queued === "all" || !changed ? "all" : [...(queued ?? []), ...changed];
      return;
    }
    const gen = this.indexGen, all = this.all, full = !this.index || !changed;
    this.indexing = true;
    cx.spawn(async (cx) => {
      try {
        if (full) {
          const index = buildIndex(all, await indexNotes(vault, all));
          if (gen === this.indexGen) { this.index = index; this.indexVer++; }
        } else {
          const known = new Set(all), prefix = `${vault}/`;
          const files = changed.filter((p) => p.startsWith(prefix) && /\.md$/i.test(p)).map((p) => p.slice(prefix.length)).filter((p) => known.has(p));
          // A folder renamed or moved reports the folder, not its notes: index the notes that have no entry yet.
          const folders = changed.filter((p) => p.startsWith(prefix) && !/\.md$/i.test(p) && !isHidden(vault, p));
          if (folders.length) {
            for (const p of missingRaw(this.index, all)) if (!files.includes(p)) files.push(p);
          }
          const raw = files.length ? await indexNotes(vault, files) : new Map();
          if (gen === this.indexGen) { this.index = updateIndex(this.index, all, raw); this.indexVer++; }
        }
        if (gen === this.indexGen) { this.indexError = null; publish("herdsidian.auto", autoFromIndex(this.index?.meta, vault)); }
      } catch (e) { if (gen === this.indexGen) this.indexError = String(e); }
      if (gen !== this.indexGen) return;
      this.indexing = false;
      const again = this.reindexAgain;
      this.reindexAgain = null;
      cx.notify();
      if (again) this.reindex(cx, again === "all" ? null : again);
    });
  }

  // One watch per vault shown: a newer one (another vault, or the same again) ends this one.
  // watchFolder resolves only when something changes, so after an outage the full reload (and the
  // cleared error) waits for the next change batch; there is no periodic reload on purpose.
  watch(cx) {
    const vault = this.vault, generation = ++this.generation;
    if (!vault) return;
    cx.spawn(async (cx) => {
      // A failed watch retries after a growing wait; it ends only when the vault changes or the mod unloads.
      let failures = 0;
      while (this.generation === generation) {
        try {
          const changed = await watchFolder(vault);
          if (this.generation !== generation) return;
          const back = afterOutage(failures);
          failures = 0;
          if (back) {
            // Back after an outage: changes made meanwhile were never reported.
            this.error = null;
            this.load(cx);
            this.refreshNote(cx);
            continue;
          }
          // Obsidian rewrites .obsidian/ all the time: that's not a note changing.
          if (changed.every((p) => isHidden(vault, p))) continue;
          this.load(cx, changed);
          this.refreshNote(cx, changed);
        } catch (e) {
          if (this.generation !== generation) return;
          // Shown once per outage, not on every retry.
          if (failures === 0) { this.error = `Cannot watch the vault: ${e}`; cx.notify(); }
          failures++;
          await cx.sleep(backoffMs(failures));
        }
      }
    });
  }

  // The open note changed on disk: take the new text unless there are unsaved edits.
  // changed: the absolute paths the watcher reported; the read is skipped when the note is not among them.
  refreshNote(cx, changed = null) {
    const note = this.note;
    if (!note || this.dirty) return;
    if (!touches(changed, this.vault, note)) return;
    cx.spawn(async (cx) => {
      const text = await readTextFile(`${this.vault}/${note}`).catch(() => null);
      if (text === null || this.note !== note || this.dirty || text === this.loaded) return;
      this.loaded = text;
      this.editor.set_value(text);
      this.setMode(this.mode);
      cx.notify();
    });
  }

  setVault(path, cx) {
    if (!path) return;
    // Unsaved changes ask first; the old note closes before the vault switches.
    if (this.dirty) return this.leave((cx) => { this.close(); this.setVault(path, cx); }, cx);
    this.close();
    localStorage.setItem("vault", path);
    publish("herdsidian.vault", path);
    this.vault = path; this.entries = new Map(); this.folders = new Set(); this.all = []; this.selected = null; this.notice = null;
    this.searching = false; this.query = ""; this.error = null; this.search.set_value("");
    // Another vault: its own index, graph, view and recent notes.
    this.indexGen++; this.indexing = false; this.reindexAgain = null; this.indexError = null;
    this.index = null; this.indexVer++; this.graph = null; this.graphKey = null; this.suggestions = [];
    this.view = { panX: 0, panY: 0, zoom: 1 }; this.hover = null; this.drag = null;
    this.recent = recentOf(path); this.picking = false; this.pickQuery = ""; this.pick.set_value("");
    this.load(cx);
    this.watch(cx);
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const f of [...this.folders]) if (f === path || f.startsWith(path + "/")) { this.folders.delete(f); this.entries.delete(f); }
      return cx.notify();
    }
    this.folders.add(path);
    cx.spawn(async (cx) => {
      try { this.entries.set(path, await directory(`${this.vault}/${path}`)); } catch (e) { this.error = String(e); }
      cx.notify();
    });
  }

  // Runs `next(cx)` now, or after Save / Discard when the open note has unsaved changes.
  leave(next, cx) {
    if (!this.dirty) return next(cx);
    this.asking = next;
    cx.notify();
  }

  open(path, cx, mode = "read") {
    if (path !== this.note) return this.leave((cx) => this.read(path, cx, mode), cx);
    this.read(path, cx, mode);
  }

  read(path, cx, mode) {
    const vault = this.vault;
    cx.spawn(async (cx) => {
      const text = await readTextFile(`${vault}/${path}`).catch(() => null);
      if (this.vault !== vault) return; // the vault changed during the read: that note is not in this one
      if (text === null) { this.error = `Cannot read ${path}`; return cx.notify(); }
      const asking = path === this.note ? this.asking : null;
      this.close();
      this.note = path; this.selected = path; this.loaded = text; this.error = null; this.asking = asking;
      this.recent = pushRecent(this.recent, path);
      localStorage.setItem(`recent:${this.vault}`, JSON.stringify(this.recent));
      const t = theme();
      this.editor = EditorState.new({ language: "markdown", value: text, soft_wrap: true, line_numbers: false, folding: false,
        font_family: settings().font_family, font_size: 13,
        syntax: { keyword: t.accent, string: t.ansi2, comment: t.muted, function: t.ansi4, type: t.ansi5, punctuation: t.muted, constant: t.ansi6 } });
      this.editor.on("change", (_e, cx) => { const d = this.editor.value() !== this.loaded; if (d !== this.dirty) { this.dirty = d; cx.notify(); } });
      this.setMode(mode);
      cx.notify();
    });
  }

  // Also Herdr's teardown hook, called with cx when a popup copy closes: the palette answers first.
  close(cx) {
    if (this.palette) return this.palette.closed(cx);
    this.editor?.release();
    this.editor = null; this.note = null; this.dirty = false; this.conflict = false; this.asking = null;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === "read" && this.editor) this.preview = render(this.editor.value());
  }

  // force: overwrite even though the note changed outside since it was opened.
  // A write refused for a stale snapshot is a conflict; any other failure is an error.
  save(force, cx) {
    if (!this.note || (!this.dirty && !force)) return;
    const note = this.note, path = `${this.vault}/${note}`, text = this.editor.value();
    cx.spawn(async (cx) => {
      try {
        const expected = force ? await readTextFile(path) : this.loaded;
        await writeTextFile(path, text, expected);
      } catch (e) {
        const now = await readTextFile(path).catch(() => null);
        if (this.note === note) { if (now !== null && now !== this.loaded) this.conflict = true; else this.error = `Cannot save: ${e}`; }
        return cx.notify();
      }
      if (this.note !== note) return;
      this.loaded = text; this.dirty = this.editor.value() !== text; this.conflict = false; this.error = null;
      const next = this.asking; this.asking = null;
      if (next && !this.dirty) next(cx);
      cx.notify();
    });
  }

  newNote(cx) {
    if (!this.vault) return this.chooseVault(cx);
    const taken = new Set(this.all.map((p) => p.toLowerCase()));
    let name = "Untitled.md";
    for (let i = 2; taken.has(name.toLowerCase()); i++) name = `Untitled ${i}.md`;
    cx.spawn(async (cx) => {
      try { await writeTextFile(`${this.vault}/${name}`, "", null); this.all = [...this.all, name]; this.liveNotes = null; this.open(name, cx, "edit"); }
      catch (e) { this.error = String(e); cx.notify(); }
    });
  }

  // A link in the rendered note: another note, a web page, or a relative .md path.
  follow(url, cx) {
    if (/^https?:|^mailto:/.test(url)) return exec(window()?.platform === "macos" ? "open" : "xdg-open", [url]);
    const target = linkTarget(url);
    if (!target) return;
    const hit = resolve(this.all, this.note, target);
    if (hit) this.open(hit, cx);
    else { this.error = `No note named "${target}"`; cx.notify(); }
  }

  button(id, t, icon, tip, action) {
    return div().id(id).size(28).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.muted)
      .hover((s) => s.bg(tokens(t).pill).text_color(t.foreground)).cursor_pointer().tooltip(tip).on_click(action)
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(14));
  }

  // `tone`: "folder" (foreground name), "note" (muted name) or "selected" (the last note opened).
  row(id, t, depth, icon, label, action, extra, tone = "note") {
    const selected = tone === "selected", tk = tokens(t);
    return h_flex().id(id).h(28).flex_none().pl(8 + depth * 16).pr(8).gap(8).items_center().rounded(7).cursor_pointer()
      .when(selected, (el) => el.bg(tk.accentSoft)).when(!selected, (el) => el.hover((s) => s.bg(tk.pill))).on_click(action)
      .child(icon)
      .child(div().flex_1().min_w(0).truncate().text_color(tone === "note" ? t.muted : t.foreground).when(selected, (el) => el.font_medium()).child(label))
      .when(Boolean(extra), (el) => el.child(div().flex_none().text_size(11).text_color(t.muted).truncate().max_w(140).child(extra)));
  }

  rows(prefix, depth, out, t) {
    for (const e of this.entries.get(prefix) ?? []) {
      const path = prefix ? `${prefix}/${e.name}` : e.name, open = this.folders.has(path), selected = !e.dir && path === this.selected;
      out.push(this.row(`note-${path}`, t, depth,
        e.dir ? h_flex().gap(8).flex_none().items_center()
          .child(svg(`mods/files/chevron-${open ? "down" : "right"}.svg`).size(9).text_color(t.muted))
          .child(svg("mods/herdsidian/folder.svg").size(16).text_color(t.accent))
          : h_flex().gap(8).flex_none().items_center().child(div().w(9)).child(svg("mods/files/file.svg").size(14).text_color(selected ? t.accent : t.muted)),
        e.dir ? e.name : base(e.name),
        (_e, cx) => (e.dir ? this.toggle(path, cx) : this.open(path, cx)),
        null, e.dir ? "folder" : selected ? "selected" : "note"));
      if (e.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  found(t) {
    const q = this.query;
    const hits = matchNotes(this.all, q, 200);
    return hits.length
      ? hits.map((p) => this.row(`hit-${p}`, t, 0, svg("mods/files/file.svg").size(14).flex_none().text_color(p === this.selected ? t.accent : t.muted), base(p),
        (_e, cx) => this.open(p, cx), p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : null, p === this.selected ? "selected" : "note"))
      : [div().p(8).text_size(12).text_color(t.muted).child("No note matches")];
  }

  // To the rail, or back to the width it had.
  collapse() {
    const rail = narrow();
    if (!rail) localStorage.setItem("width", String(width() ?? 380));
    run("layout.resize", { id: "herdsidian", px: rail ? Number(localStorage.getItem("width")) || 380 : 44 });
  }

  // The search box comes and goes; hiding it clears the search.
  toggleSearch(cx) {
    const rail = narrow();
    if (rail) this.collapse();
    this.searching = !this.searching || rail;
    if (this.searching) this.search.focus();
    else { this.search.set_value(""); this.query = ""; }
    cx.notify();
  }

  rail(t) {
    return v_flex().id("herdsidian").size_full().pt(8).gap(4).items_center().bg(tokens(t).glass)
      .child(this.button("notes-expand", t, "panel-right", "Expand notes", () => this.collapse()))
      .when(Boolean(this.vault), (el) => el.child(this.button("notes-search-rail", t, "search", "Find a note", (_e, cx) => this.toggleSearch(cx))))
      .when(!this.note, (el) => el.child(this.button("notes-new-rail", t, "square-pen", "New note", (_e, cx) => { this.collapse(); this.newNote(cx); })));
  }

  chooseVault(cx) {
    cx.spawn(async (cx) => { this.setVault(await pickFolder({ prompt: "Choose an Obsidian vault" }), cx); cx.notify(); });
  }

  browser(t) {
    if (!this.vault) return v_flex().flex_1().flex_basis(0).min_h(120).p(16).gap(10).text_size(12.5).text_color(t.muted)
      .child("Choose a folder of Markdown notes, or create an empty one to start. An Obsidian vault works too; Obsidian is not needed.")
      .child(div().id("notes-choose").self_start().px(10).h(28).flex().items_center().rounded(7).bg(t.solid).text_color(t.solid_foreground)
        .cursor_pointer().on_click((_e, cx) => this.chooseVault(cx)).child("Choose a vault"));
    return v_flex().flex_1().flex_basis(0).min_h(120)
      .when(this.searching, (el) => el.child(div().px(10).pb(6).flex_none().child(h_flex().h(30).px(8).gap(6).items_center().rounded(8).bg(tokens(t).pill)
        .child(svg("mods/workspace-chrome/search.svg").size(13).flex_none().text_color(t.muted))
        .child(Input.new(this.search).flex_1().text_size(12.5).text_color(t.foreground)))))
      .child(v_flex().id("notes-tree").flex_1().min_h(0).px(6).pb(8).overflow_y_scrollbar()
        .children(this.query ? this.found(t) : this.rows("", 0, [], t)));
  }

  pill(id, t, label, on, action) {
    return div().id(id).px(8).h(22).flex().items_center().rounded(5).text_size(11.5).cursor_pointer()
      .text_color(on ? t.foreground : t.muted).when(on, (el) => el.bg(t.raised)).hover((s) => s.text_color(t.foreground))
      .on_click(action).child(label);
  }

  reader(t) {
    const read = this.mode === "read";
    const banner = (text, actions) => v_flex().mx(10).mb(6).px(10).py(8).gap(6).flex_none().rounded(7)
      .bg(alpha(t.blocked, 0.12)).text_size(12).text_color(t.foreground).child(div().child(text)).child(h_flex().gap(6).children(actions));
    const act = (id, label, action) => div().id(id).px(8).h(22).flex().items_center().rounded(5).bg(t.raised).cursor_pointer()
      .hover((s) => s.bg(tokens(t).pill)).on_click(action).child(label);
    return v_flex().flex_1().flex_basis(0).min_h(120)
      .child(h_flex().h(34).px(10).gap(6).flex_none().items_center()
        .child(this.pill("mode-read", t, "Read", read, (_e, cx) => { this.setMode("read"); cx.notify(); }))
        .child(this.pill("mode-edit", t, "Edit", !read, (_e, cx) => { this.setMode("edit"); cx.notify(); }))
        .child(keycap(t, "⌘E"))
        .child(div().flex_1())
        .when(this.dirty, (el) => el.child(div().size(7).rounded(4).bg(t.working)))
        .child(this.pill("save", t, "Save", false, (_e, cx) => this.save(false, cx)))
        .child(keycap(t, "⌘S")))
      .when(this.conflict, (el) => el.child(banner("Changed outside Herdr since you opened it.", [
        act("reload", "Reload", (_e, cx) => this.open(this.note, cx, this.mode)),
        act("overwrite", "Overwrite", (_e, cx) => this.save(true, cx)),
      ])))
      .when(Boolean(this.asking) && !this.conflict, (el) => el.child(banner("Unsaved changes.", [
        act("ask-save", "Save", (_e, cx) => this.save(false, cx)),
        act("ask-discard", "Discard", (_e, cx) => { const next = this.asking; this.dirty = false; this.asking = null; next(cx); cx.notify(); }),
        act("ask-cancel", "Cancel", (_e, cx) => { this.asking = null; cx.notify(); }),
      ])))
      .child(read
        ? div().id("notes-read").flex_1().min_h(0).px(16).pb(16).overflow_y_scrollbar().text_size(13).text_color(t.foreground)
          .child(TextView.markdown(`md-${this.note}`, this.preview).selectable(true).on_link_click((url, cx) => this.follow(url, cx)))
        : div().flex_1().min_h(0).px(6).child(Editor.new(this.editor).size_full()));
  }

  // The focused agent, its space and its folder, read live (A3, F3). The memory of the last agent
  // per space is assigned here, not notified, so clicking in this panel keeps the agent (AC21).
  // Called from render: the shared write (which re-renders every mod) is deferred to a spawn, and only when changed.
  focus(cx) {
    const all = spaces();
    const picked = pickAgent({ agents: agents(), focused: focused(), spaces: all, memory: this.agentMemory });
    this.agentMemory = picked.memory;
    if (changedJson(shared("herdsidian.memory"), picked.memory)) {
      const memory = picked.memory;
      cx.spawn(async (cx) => {
        await cx.sleep(0);
        publish("herdsidian.memory", memory);
      });
    }
    const agent = picked.agent, space = all.find((s) => s.id === picked.spaceId) ?? null;
    const cwd = agent ? panes().find((p) => p.pane === agent.pane)?.cwd ?? null : null;
    return { agent, space, cwd, liveIds: all.map((s) => s.id) };
  }

  // focus() plus this space's context notes (links, the agent's pins, auto links), in A4 order.
  scene(cx) {
    const f = this.focus(cx);
    if (this.liveNotes?.of !== this.all) this.liveNotes = { of: this.all, set: new Set(this.all) };
    const where = spaceWhere(f.space, this.vault, f.agent);
    const entry = where ? findEntry(this.ctx.doc, where, f.liveIds) : null;
    const auto = autoLinks(this.index?.meta ?? NO_META, f.cwd, home());
    return { ...f, where, notes: contextNotes(entry, f.agent?.address ?? null, auto, this.liveNotes.set) };
  }

  // The graph's center: the open note, else the first context note (AC12).
  center(notes) {
    return this.vault ? this.note ?? notes[0]?.path ?? null : null;
  }

  // The Graph section's model for graph-view.js. While hidden it does no more than the header needs.
  // The neighborhood, layout, git folder and suggestions come from refresh(), never from here (AC17).
  graphModel(cx) {
    const m = {
      hidden: this.hidden, hops: this.hops, count: 0, omitted: 0, message: null, error: null,
      nodes: [], labels: [], area: this.area, segments: [], hotSegments: [], hover: this.hover,
      agentLabel: null, agentOnlyAllowed: false, chips: [], suggestions: [],
      canAddCurrent: Boolean(this.note), send: { ok: false, reason: null },
      picking: false, pickState: this.pick, pickHits: [],
    };
    if (this.hidden) { this.focus(cx); return m; }

    const s = this.scene(cx), center = this.center(s.notes);
    const linked = new Set(s.notes.map((n) => n.path));
    const key = JSON.stringify([this.vault, this.indexVer, center, this.hops, s.cwd, s.space?.name ?? null, s.space?.machine ?? null, this.recent, [...linked]]);
    if (key !== this.graphKey) {
      this.graphKey = key;
      this.refresh(key, { center, hops: this.hops, cwd: s.cwd, space: s.space, linked: [...linked] }, cx);
    }

    const g = this.graph;
    if (g) {
      const screen = toScreen(g.positions, g.edges, this.view, this.area);
      m.segments = screen.segments;
      if (this.hover) m.hotSegments = toScreen(g.positions, g.edges.filter(([a, b]) => a === this.hover || b === this.hover), this.view, this.area).segments;
      const hinted = new Set(this.suggestions), far = this.view.zoom >= 1.5;
      for (const n of g.nodes) {
        const p = screen.nodes.get(n.path);
        if (!p?.inside) continue;
        const kind = n.hop === 0 ? "center" : n.hop === 1 ? "near" : "far";
        m.nodes.push({ path: n.path, label: base(n.path), x: p.x, y: p.y, size: kind === "center" ? 14 : kind === "near" ? 10 : 8,
          kind, linked: linked.has(n.path), suggested: hinted.has(n.path), degree: n.degree, hovered: n.path === this.hover });
      }
      // Hop-2 labels only on hover or at zoom >= 1.5 (D3); the rest are culled by priority so none overlap.
      m.labels = placeLabels(m.nodes.filter((n) => n.kind !== "far" || far || n.hovered), undefined, this.area);
      m.count = g.nodes.length; m.omitted = g.omitted;
    }
    m.message = sectionMessage({ vault: this.vault, error: this.indexError, index: this.index, center, graph: g });
    m.error = this.indexError ?? this.ctxError;

    const agent = s.agent;
    m.agentLabel = agent ? `${agent.program?.name ?? agent.app ?? "Agent"} · ${s.space?.name ?? agent.space_name}` : null;
    m.agentOnlyAllowed = Boolean(agent);
    m.chips = s.notes.map((n) => ({ path: n.path, label: base(n.path), scope: n.scope }));
    m.suggestions = this.suggestions.filter((p) => !linked.has(p)).map((p) => ({ path: p, label: base(p) }));
    m.send = this.sending ? { ok: false, reason: "Sending…" } : canSend({ agent, space: s.space, notes: s.notes });
    m.picking = this.picking;
    if (this.picking) m.pickHits = matchNotes(this.all, this.pickQuery, 6).map((p) => ({ path: p, label: base(p) }));
    return m;
  }

  // Off the render path: the repo folder of the agent's cwd (git, local spaces only), the
  // neighborhood and its layout, and the suggestions. A newer key makes this run stale.
  refresh(key, input, cx) {
    cx.spawn(async (cx) => {
      await cx.sleep(0); // let the render that started this finish first: no work or notify inside it
      try {
        const { cwd, space } = input;
        let top = null;
        if (cwd && space?.machine == null) {
          let pending = this.repoOf.get(cwd); // the in-flight or finished git call, shared by every refresh
          if (!pending) {
            pending = gitTop(cwd); // never rejects
            this.repoOf.set(cwd, pending);
          }
          top = await pending;
          if (top === null) this.repoOf.delete(cwd); // not cached: a later `git init` is seen
        }
        if (this.graphKey !== key) return;
        const index = this.index;
        const g = index && input.center ? neighborhood(index, input.center, input.hops) : null;
        this.graph = g && { ...g, positions: ringLayout(g) };
        this.suggestions = index && space
          ? suggest({ notes: index.notes, meta: index.meta, spaceName: space.name, repoName: leaf(top ?? cwd), recent: this.recent, linked: input.linked })
          : [];
        if (this.refreshFailed) { this.refreshFailed = false; this.indexError = null; }
      } catch (e) { this.indexError = String(e); this.refreshFailed = true; }
      cx.notify();
    });
  }

  // The Graph section's callbacks (graph-view.js `on`); every one ends with the gpui `cx`.
  callbacks() {
    return {
      toggle: (cx) => {
        this.hidden = !this.hidden;
        if (this.hidden) localStorage.setItem("graph.hidden", "1"); else localStorage.removeItem("graph.hidden");
        this.hover = null; this.drag = null; this.picking = false;
        cx.notify();
      },
      setHops: (n, cx) => { this.hops = n === 1 ? 1 : 2; localStorage.setItem("graph.hops", String(this.hops)); cx.notify(); },
      fit: (cx) => { this.view = { panX: 0, panY: 0, zoom: 1 }; cx.notify(); },
      open: (path, cx) => this.open(path, cx),
      hover: (path, hovered, cx) => {
        if (hovered) this.hover = path;
        else if (this.hover === path) this.hover = null;
        else return;
        cx.notify();
      },
      dragStart: (point, cx) => { this.drag = { x: point.x, y: point.y, panX: this.view.panX, panY: this.view.panY }; cx.notify(); },
      dragMove: (point, cx) => {
        const d = this.drag;
        if (!d) return;
        this.view = { ...this.view, panX: d.panX + point.x - d.x, panY: d.panY + point.y - d.y };
        cx.notify();
      },
      dragEnd: (cx) => { if (this.drag) { this.drag = null; cx.notify(); } },
      wheel: (point, deltaY, cx) => { this.view = zoomAt(this.view, point, deltaY, this.area); cx.notify(); },
      size: ({ width, height }, cx) => {
        if (width === this.area.width && height === this.area.height) return;
        this.area = { width, height };
        cx.notify();
      },
      unlink: (path, scope, cx) => this.change(scope === "auto" ? { type: "exclude", note: path } : { type: "unlink", note: path }, cx),
      scope: (path, agentOnly, cx) => this.change({ type: "scope", note: path, agentOnly }, cx),
      pin: (path, cx) => this.change({ type: "link", note: path }, cx),
      pick: (cx) => this.openPicker(cx),
      pickChoose: (path, cx) => { this.closePicker(); this.change({ type: "link", note: path }, cx); },
      pickClose: (cx) => { this.closePicker(); cx.notify(); },
      addCurrent: (cx) => this.linkCurrent(cx),
      send: (cx) => this.send(cx),
    };
  }

  // focus: the "+ add note" button focuses the input; ⌘L leaves the keyboard where it is (for example in the agent).
  openPicker(cx, focus = true) {
    if (!this.vault) return; // No vault: no section to draw the picker in.
    if (this.hidden) { this.hidden = false; localStorage.removeItem("graph.hidden"); }
    this.picking = true; this.pickQuery = ""; this.pick.set_value("");
    if (focus) this.pick.focus();
    cx.notify();
  }

  closePicker() {
    this.picking = false; this.pickQuery = ""; this.pick.set_value("");
  }

  // Links the note open in the reader to this space; nothing when none is open (AC22).
  linkCurrent(cx) {
    if (this.note) this.change({ type: "link", note: this.note }, cx);
  }

  // One change to the context file (create on first link, keep other spaces), then the new doc.
  change(change, cx) {
    const s = this.scene(cx);
    if (!s.where) { this.ctxError = this.vault ? "No space to link notes to" : "Choose a vault first"; return cx.notify(); }
    cx.spawn(async (cx) => {
      try {
        this.stateDir ??= await stateDir();
        const doc = await saveContext(this.stateDir, change, s.where, s.liveIds);
        this.ctx = { status: "ok", doc }; this.ctxError = null;
      } catch (e) { this.ctxError = String(e); }
      cx.notify();
    });
  }

  // Send to agent (plan Decision 5, D4): paths only, at most 600 characters, never submitted.
  // Copy, then focus the agent's terminal and paste; if that cannot apply the text stays copied.
  send(cx) {
    const s = this.scene(cx);
    if (this.sending) return; // A second click while the first send runs.
    if (!this.vault || !s.agent || !canSend({ agent: s.agent, space: s.space, notes: s.notes }).ok) return;
    const { text, skipped, overflow = 0 } = deliveryText(sendOrder(s.notes, this.center(s.notes)), this.vault, s.agent);
    const name = s.agent.program?.name ?? s.agent.app ?? "the agent", address = s.agent.address;
    const toasts = sendToasts(name, skipped, overflow);
    if (!text) return notify({ title: toasts.nothing, level: "warning" });
    sendText(cx, this, { text, address, name, more: toasts.more }, { run, focused, notify });
  }

  render(cx) {
    if (this.palette) return this.palette.render(cx);
    this.handleShared(cx);
    const t = theme();
    if (narrow()) return this.rail(t);
    const title = this.note ? base(this.note) : this.vault?.split("/").pop() ?? "Notes";
    return v_flex().id("herdsidian").size_full().min_h(0).bg(tokens(t).glass).text_color(t.foreground).text_size(13)
      .child(h_flex().h(52).flex_none().pl(16).pr(8).gap(4).items_center()
        .when(Boolean(this.note), (el) => el.child(this.button("notes-back", t, "chevron-left", "Back to the notes",
          (_e, cx) => this.leave((cx) => { this.close(); cx.notify(); }, cx))))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().font_semibold().child(title))
          .when(Boolean(this.note), (el) => el.child(div().truncate().text_size(10.5).text_color(t.muted).child(this.note))))
        .when(!this.note, (el) => el
          .child(div().mr(4).child(keycap(t, "\u2318\u21e7O")))
          .when(Boolean(this.vault), (el) => el.child(this.button("notes-search", t, "search", "Find a note", (_e, cx) => this.toggleSearch(cx))))
          .child(this.button("notes-new", t, "square-pen", "New note", (_e, cx) => this.newNote(cx)))
          .child(this.button("notes-vault", t, "folder", "Choose the vault", (_e, cx) => this.chooseVault(cx))))
        .child(this.button("notes-collapse", t, "panel-right", "Collapse notes (⌘⇧O hides them)", () => this.collapse())))
      .when(Boolean(this.error), (el) => el.child(div().px(12).pb(6).text_size(11.5).text_color(t.blocked).child(this.error)))
      .when(Boolean(this.notice), (el) => el.child(div().px(12).pb(6).text_size(11.5).text_color(t.muted).child(this.notice)))
      .child(this.note ? this.reader(t) : this.browser(t))
      // No vault: no graph section, only the choose-a-folder prompt above.
      .when(Boolean(this.vault), (el) => el.child(graphSection(t, this.graphModel(cx), this.on)))
      // Still remember the last agent per space while no vault is chosen (AC21).
      .when(!this.vault, (el) => { this.focus(cx); return el; });
  }
}
