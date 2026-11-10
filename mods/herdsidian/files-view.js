// The Files tab of the right sidebar (V1): the tree and bounded read-only preview of the focused pane's folder,
// moved from mods/herdsidian-files (a clone of Herdr's `files` mod) into the sidebar. main.js makes it on the
// init (its 10 s timer needs host.cx, valid only there) and calls render(); `host`: { cx, selectTab, files, vault, changes }.
// The tab keeps no gpui Context: each call that needs one gets it as an argument.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings, window, shared, home } from "herdr";
import { RADIUS } from "./tokens.js";
import { SIDEBAR_STORE, readSidebar } from "./sidebar.js";
import { PER_FOLDER, TOTAL, locate, parseListing, capEntries, languageOf, parseMarks, relativeTo, ancestors, tildePath } from "./files-tree.js";

// The focused pane's folder; Changes looks at the same one.
export const location = () => locate({ space: spaces().find((s) => s.active), focus: focused(), panes: panes() });
const key = () => JSON.stringify(location());

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  return parseListing(r.stdout);
}

export class FilesTab {
  constructor(host) {
    this.host = host;
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.context = null; this.request = null; this.stale = false;
    this.file = null; this.full = null; this.code = null;
    // host.cx is valid in the constructor only (main.js makes this tab during init): the timer starts here, never in render.
    host.cx?.timer.every(10000, (cx) => this.tick(cx));
  }

  // Shows `abs` (an absolute path): its preview, and its folder revealed in the tree when it lies under the root.
  // A folder path (ending in "/") opens that folder. Takes effect on the next render; `cx`, when given, asks for it.
  open(abs, cx) {
    this.request = abs;
    cx?.notify();
  }

  // The timer and the folder watch: work only while this tab is the one shown; otherwise the next render catches up.
  tick(cx) {
    if (readSidebar(shared(SIDEBAR_STORE)).tab === "files") this.refresh(cx);
    else this.stale = true;
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async (cx) => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.tick(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    const { list, limited } = capEntries(entries, used);
    this.entries.set(path, list);
    if (limited) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file, full: this.full });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(null); this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx, saved.full);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async (cx) => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        let marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) marks = parseMarks(top.stdout.trim(), status.stdout);
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async (cx) => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  // The preview of `path` (below the root), or of `full` when the file lies elsewhere; null closes it.
  show(path, cx, full = null) {
    this.code?.release(); this.code = null; this.file = path; this.full = full; this.fileError = null;
    if (!path || !cx) return;
    const context = this.context, on = this.on, target = full ?? `${this.root}/${path}`;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(target, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const t = theme();
        this.code = EditorState.new({ language: languageOf(path), readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          font_family: settings().font_family, font_size: 12,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.muted, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  // open(): open the folders above the file, then its preview.
  reveal(abs, cx) {
    const rel = relativeTo(this.root, abs);
    if (rel === null) return this.show(abs, cx, abs);
    const folder = abs.endsWith("/"), folders = ancestors(folder ? `${rel}/.` : rel);
    const missing = folders.filter((f) => !this.entries.has(f));
    for (const f of folders) this.folders.add(f);
    if (missing.length) {
      const context = this.context;
      cx.spawn(async (cx) => {
        try { for (const f of missing) await this.loadFolder(f, context); }
        catch (e) { if (this.current(context)) this.error = String(e); }
        finally { cx.notify(); }
      });
    }
    if (folder || !rel) this.show(null);
    else this.show(rel, cx);
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(RADIUS.control).cursor_pointer().hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => (entry.dir ? this.toggle(path, cx) : this.show(path, cx)))
        .child(entry.dir ? svg(`mods/files/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.muted) : div().w(12).flex_none())
        // Folders in the accent color, like the vault tree in Notes; files stay muted.
        .child(entry.dir ? svg("mods/herdsidian/folder.svg").size(16).flex_none().text_color(t.accent) : svg("mods/files/file.svg").size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), (el) => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  render(t, cx) {
    if (this.stale || key() !== this.context?.key) { this.stale = false; this.refresh(cx); }
    if (this.request) {
      const abs = this.request;
      this.request = null;
      this.reveal(abs, cx);
    }
    const line = h_flex().id("files-path").h(30).flex_none().px(14).gap(6).items_center().text_size(12).text_color(t.muted)
      .when(Boolean(this.file), (el) => el.child(div().id("files-back").w(20).flex_none().cursor_pointer().hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
      .child(div().flex_1().min_w(0).truncate().child(this.file ?? tildePath(this.root ?? "", home())));
    return v_flex().id("tab-files").flex_1().min_h(0).text_color(t.foreground).text_size(13)
      .child(line)
      .when(!this.file, (el) => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().px(6).pb(8).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, (el) => el.child(div().p(8).text_size(12).text_color(t.muted).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, (el) => el.child(div().p(8).text_size(11).text_color(t.muted).child(`File list limited to ${PER_FOLDER} entries per folder and ${TOTAL.toLocaleString("en-US")} total`)))))
      .when(Boolean(this.file), (el) => el.child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.muted).child(this.fileError || "Loading file…")));
  }
}
