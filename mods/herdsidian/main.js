// An Obsidian vault beside the terminals: browse its folders, find a note by name,
// read it rendered (wikilinks follow) or edit and save it. Obsidian can keep the same
// vault open: saves refuse to overwrite a note changed outside since it was opened.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, InputState, Input, TextView } from "gpui-base";
import { HIDDEN, base, hidden, render, linkTarget, resolve } from "./notes.js";
import { exec, readTextFile, writeTextFile, watchFolder, pickFolder, theme, settings, nextCommand, run, layout, window } from "herdr";

const MAX_NOTES = 5000;

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// Like the left sidebar: a rail of icons by width, not a flag, so dragging it narrow counts too.
const width = () => find(layout(), "herdsidian")?.size?.px;
const narrow = () => (width() ?? Infinity) < 160;

// The shortcut that reaches a thing, as a small key cap.
const keycap = (t, text) => div().flex_none().px(4).h(16).rounded(4).border(1).border_color(t.foreground + "14").text_size(10).text_color(t.muted).flex().items_center().child(text);

// Folders and .md files of one folder, folders first.
async function directory(path) {
  const script = 'for p in "$1"/* "$1"/.[!.]*; do [ -e "$p" ] || continue; name=${p##*/}; if [ -d "$p" ]; then printf "d\\0%s\\0" "$name"; else case "$name" in *.[mM][dD]) printf "f\\0%s\\0" "$name";; esac; fi; done; test -d "$1"';
  const r = await exec("sh", ["-c", script, "herdsidian", path]);
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) if (!HIDDEN.has(fields[i + 1])) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

// Every note in the vault, as paths relative to it: for search and wikilinks.
async function allNotes(vault) {
  const prune = [...HIDDEN].flatMap((n, i) => [...(i ? ["-o"] : []), "-name", n]);
  const r = await exec("find", [vault, "(", ...prune, ")", "-prune", "-o", "-type", "f", "-iname", "*.md", "-print"]);
  return r.stdout.split("\n").filter(Boolean).map((p) => p.slice(vault.length + 1)).sort().slice(0, MAX_NOTES);
}

export default class Notes extends View {
  init(_props, cx) {
    // No vault until one is chosen: the panel asks for it.
    this.vault = localStorage.getItem("vault");
    this.entries = new Map(); this.folders = new Set(); this.all = [];
    this.note = null; this.mode = "read"; this.query = ""; this.searching = false; this.generation = 0;
    this.search = InputState.new({ placeholder: "Find a note…" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value().trim().toLowerCase(); cx.notify(); });
    this.load(cx);
    this.watch(cx);
    // keys.json "mod:herdsidian": "cmd-s": "herdsidian.save", "cmd-e": "herdsidian.mode".
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "save") this.save(false, cx);
        if (c === "mode" && this.note) this.setMode(this.mode === "read" ? "edit" : "read");
        cx.notify();
      }
    });
  }

  // The tree's open folders and the note list. A folder gone since it was opened closes.
  load(cx) {
    const vault = this.vault;
    if (!vault) return;
    cx.spawn(async (cx) => {
      try {
        const root = await directory(vault);
        if (this.vault !== vault) return;
        this.entries.set("", root);
        for (const path of [...this.folders]) {
          const list = await directory(`${vault}/${path}`).catch(() => null);
          if (this.vault !== vault) return;
          if (list) this.entries.set(path, list);
          else { this.folders.delete(path); this.entries.delete(path); }
        }
        const all = await allNotes(vault);
        if (this.vault !== vault) return;
        this.all = all; this.error = null;
      } catch (e) { if (this.vault === vault) this.error = String(e); }
      cx.notify();
    });
  }

  // One watch per vault shown: a newer one (another vault, or the same again) ends this one.
  watch(cx) {
    const vault = this.vault, generation = ++this.generation;
    if (!vault) return;
    cx.spawn(async (cx) => {
      try {
        for (;;) {
          const changed = await watchFolder(vault);
          if (this.generation !== generation) return;
          // Obsidian rewrites .obsidian/ all the time: that's not a note changing.
          if (changed.every((p) => hidden(vault, p))) continue;
          this.load(cx);
          this.refreshNote(cx);
        }
      } catch {}
    });
  }

  // The open note changed on disk: take the new text unless there are unsaved edits.
  refreshNote(cx) {
    const note = this.note;
    if (!note || this.dirty) return;
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
    localStorage.setItem("vault", path);
    this.vault = path; this.entries = new Map(); this.folders = new Set(); this.all = [];
    this.searching = false; this.query = ""; this.error = null; this.search.set_value("");
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
    cx.spawn(async (cx) => {
      const text = await readTextFile(`${this.vault}/${path}`).catch(() => null);
      if (text === null) { this.error = `Cannot read ${path}`; return cx.notify(); }
      const asking = path === this.note ? this.asking : null;
      this.close();
      this.note = path; this.loaded = text; this.error = null; this.asking = asking;
      const t = theme();
      this.editor = EditorState.new({ language: "markdown", value: text, soft_wrap: true, line_numbers: false, folding: false,
        font_family: settings().font_family, font_size: 13,
        syntax: { keyword: t.accent, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi5, punctuation: t.dim, constant: t.ansi6 } });
      this.editor.on("change", (_e, cx) => { const d = this.editor.value() !== this.loaded; if (d !== this.dirty) { this.dirty = d; cx.notify(); } });
      this.setMode(mode);
      cx.notify();
    });
  }

  close() {
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
      try { await writeTextFile(`${this.vault}/${name}`, "", null); this.all.push(name); this.open(name, cx, "edit"); }
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
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(6).text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).cursor_pointer().tooltip(tip).on_click(action)
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(14));
  }

  row(id, t, depth, icon, label, action, extra) {
    return h_flex().id(id).h(28).flex_none().pl(8 + depth * 16).pr(8).gap(7).items_center().rounded(7).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click(action)
      .child(icon)
      .child(div().flex_1().min_w(0).truncate().child(label))
      .when(Boolean(extra), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).truncate().max_w(140).child(extra)));
  }

  rows(prefix, depth, out, t) {
    for (const e of this.entries.get(prefix) ?? []) {
      const path = prefix ? `${prefix}/${e.name}` : e.name, open = this.folders.has(path);
      out.push(this.row(`note-${path}`, t, depth,
        e.dir ? h_flex().gap(4).flex_none().items_center()
          .child(svg(`mods/files/chevron-${open ? "down" : "right"}.svg`).size(12).text_color(t.dim))
          .child(svg("mods/files/folder.svg").size(14).text_color(t.accent))
          : h_flex().gap(4).flex_none().items_center().child(div().w(12)).child(svg("mods/files/file.svg").size(14).text_color(t.muted)),
        e.dir ? e.name : base(e.name),
        (_e, cx) => (e.dir ? this.toggle(path, cx) : this.open(path, cx))));
      if (e.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  found(t) {
    const q = this.query;
    const hits = this.all.filter((p) => base(p).toLowerCase().includes(q)).slice(0, 200);
    return hits.length
      ? hits.map((p) => this.row(`hit-${p}`, t, 0, svg("mods/files/file.svg").size(14).flex_none().text_color(t.muted), base(p),
        (_e, cx) => this.open(p, cx), p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : null))
      : [div().p(8).text_size(12).text_color(t.dim).child("No note matches")];
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
    return v_flex().id("herdsidian").size_full().pt(8).gap(4).items_center().bg(t.chrome)
      .child(this.button("notes-expand", t, "panel-right", "Expand notes", () => this.collapse()))
      .when(Boolean(this.vault), (el) => el.child(this.button("notes-search-rail", t, "search", "Find a note", (_e, cx) => this.toggleSearch(cx))))
      .when(!this.note, (el) => el.child(this.button("notes-new-rail", t, "square-pen", "New note", (_e, cx) => { this.collapse(); this.newNote(cx); })));
  }

  chooseVault(cx) {
    cx.spawn(async (cx) => { this.setVault(await pickFolder({ prompt: "Choose an Obsidian vault" }), cx); cx.notify(); });
  }

  browser(t) {
    if (!this.vault) return v_flex().flex_1().p(16).gap(10).text_size(12.5).text_color(t.muted)
      .child("Pick the folder of your Obsidian vault (or any folder of Markdown notes).")
      .child(div().id("notes-choose").self_start().px(10).h(28).flex().items_center().rounded(7).bg(t.solid).text_color(t.solid_foreground)
        .cursor_pointer().on_click((_e, cx) => this.chooseVault(cx)).child("Choose a vault"));
    return v_flex().flex_1().min_h(0)
      .when(this.searching, (el) => el.child(div().px(10).pb(6).flex_none().child(h_flex().h(30).px(8).gap(6).items_center().rounded(8).bg(t.foreground + "0f")
        .child(svg("mods/workspace-chrome/search.svg").size(13).flex_none().text_color(t.dim))
        .child(Input.new(this.search).flex_1().text_size(12.5).text_color(t.foreground)))))
      .child(v_flex().id("notes-tree").flex_1().min_h(0).px(6).pb(8).overflow_y_scrollbar()
        .children(this.query ? this.found(t) : this.rows("", 0, [], t)));
  }

  pill(id, t, label, on, action) {
    return div().id(id).px(8).h(22).flex().items_center().rounded(5).text_size(11.5).cursor_pointer()
      .text_color(on ? t.foreground : t.dim).when(on, (el) => el.bg(t.raised)).hover((s) => s.text_color(t.foreground))
      .on_click(action).child(label);
  }

  reader(t) {
    const read = this.mode === "read";
    const banner = (text, actions) => v_flex().mx(10).mb(6).px(10).py(8).gap(6).flex_none().rounded(7)
      .bg(t.blocked + "1f").text_size(12).text_color(t.foreground).child(div().child(text)).child(h_flex().gap(6).children(actions));
    const act = (id, label, action) => div().id(id).px(8).h(22).flex().items_center().rounded(5).bg(t.raised).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click(action).child(label);
    return v_flex().flex_1().min_h(0)
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

  render() {
    const t = theme();
    if (narrow()) return this.rail(t);
    const title = this.note ? base(this.note) : this.vault?.split("/").pop() ?? "Notes";
    return v_flex().id("herdsidian").size_full().min_h(0).bg(t.chrome).text_color(t.foreground).text_size(13)
      .child(h_flex().h(52).flex_none().pl(14).pr(8).gap(4).items_center()
        .when(Boolean(this.note), (el) => el.child(this.button("notes-back", t, "chevron-left", "Back to the notes",
          (_e, cx) => this.leave((cx) => { this.close(); cx.notify(); }, cx))))
        .child(v_flex().flex_1().min_w(0)
          .child(div().truncate().font_semibold().child(title))
          .when(Boolean(this.note), (el) => el.child(div().truncate().text_size(10.5).text_color(t.dim).child(this.note))))
        .when(!this.note, (el) => el
          .child(div().mr(4).child(keycap(t, "\u2318\u21e7O")))
          .when(Boolean(this.vault), (el) => el.child(this.button("notes-search", t, "search", "Find a note", (_e, cx) => this.toggleSearch(cx))))
          .child(this.button("notes-new", t, "square-pen", "New note", (_e, cx) => this.newNote(cx)))
          .child(this.button("notes-vault", t, "folder", "Choose the vault", (_e, cx) => this.chooseVault(cx))))
        .child(this.button("notes-collapse", t, "panel-right", "Collapse notes (⌘⇧O hides them)", () => this.collapse())))
      .when(Boolean(this.error), (el) => el.child(div().px(12).pb(6).text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(this.note ? this.reader(t) : this.browser(t));
  }
}
