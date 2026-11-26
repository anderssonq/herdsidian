// The Changes tab of the right sidebar (V2): the files `git status` lists for the focused pane's repo, with their
// +N / −N counts, and a per-file diff inside the tab.
// main.js makes the ChangesWatch once in init (its count feeds the tab badge) and the ChangesTab on the first render.
// `host`: { cx, selectTab, files, vault, changes, textMenu } from main.js. host.cx is valid only during init: the watch uses it in its
// constructor and nowhere else; later work uses the context each call or task is given.
import { div } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { exec, readTextFile, watchFolder, shared, setShared } from "herdr";
import { RADIUS, tokens, diffTokens } from "./tokens.js";
import { location } from "./files-view.js";
import { SIDEBAR_STORE, SIDEBAR_LAYOUT_STORE, shownTabs } from "./sidebar.js";
import { diffView, diffMenuOn, paneParts, zoomOf } from "./diff-view.js";
import { DiffPane } from "./diff-pane.js";
import { emptyFor, cleanState } from "./empty-state-view.js";
import { badgeOf, splitPath, maxChange, sizeBar, neighbors, diffKey } from "./diff.js";
import { topArgs, statusArgs, diffArgs, patchArgs, classifyTop, publishes, readRoots, parseStatus, parseNumstat, mergeRows, relevant, summary,
  sumStats, wholeFile, cappedBody, patchBody, execFailed, BINARY, DEBOUNCE_MS, MAX_WAIT_MS } from "./changes.js";

// Written when the count changes: { count } for the sidebar Changes tab badge.
const CHANGES_KEY = "herdsidian.changes";
const EMPTY = { state: "loading", root: null, branch: null, files: [], count: 0, error: null, total: { add: 0, del: 0 }, head: false, on: null };

// What git says about the focused pane's repo: { state, root, branch, files, count, error, total, head, on }.
// state: "loading", "ready", "nofolder", "norepo", "unknown" or "error". `rev` counts the reads applied; `onApply` is the tab's hook.
export class ChangesWatch {
  constructor(host) {
    this.host = host;
    this.data = EMPTY; this.key = null; this.busy = false; this.again = false; this.watched = null; this.generation = 0;
    this.attempt = null; this.readyRoot = null; this.rev = 0; this.onApply = null;
    this.dir = null; // the folder the last applied read checked (the empty state names it)
    // The diff's focus and tabs scroll handles: made here because init is the one place both are known to work (P0-a, F1).
    this.handles = { focus: host.cx.focus_handle(), tabs: ScrollHandle.new() };
    this.refresh(host.cx);
    // The 10 s timer is the fallback: it reads only when no local folder watch works (a remote repo, or the watch failed).
    host.cx.timer.every(10000, (cx) => { if (!this.watched) this.refresh(cx); });
    // Focus may move to another repo while the Changes tab is not shown: the badge follows (key compare, git only on a change).
    host.cx.timer.every(2000, (cx) => this.check(cx));
  }

  // Cheap: another repo is read as soon as the focused folder differs from the one last read.
  check(cx) {
    if (JSON.stringify(location()) !== this.key) this.refresh(cx);
  }

  refresh(cx) {
    const where = location(), key = JSON.stringify(where);
    this.key = key;
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    cx.spawn(async (cx) => {
      let next;
      try { next = await this.read(where); }
      catch (e) { next = { ...EMPTY, state: "error", error: String(e) }; }
      this.busy = false;
      // Focus moved to another folder while git ran: that answer is stale, and the rerun below reads the new one.
      if (this.key === key) { this.dir = where.cwd ?? null; this.apply(next, where.on, cx); }
      if (this.again) { this.again = false; this.refresh(cx); }
    });
  }

  async read({ cwd, on }) {
    this.attempt = null; // the repo being read, so an error can be told from one in the repo of the last good read
    if (!cwd) return { ...EMPTY, state: "nofolder" };
    const top = await exec("git", topArgs(cwd), { on }).catch(() => null);
    const found = classifyTop(top);
    if (found.kind !== "repo") return { ...EMPTY, state: found.kind };
    const root = this.attempt = found.root;
    const status = await exec("git", statusArgs(root), { on });
    if (status.code !== 0) throw new Error(status.stderr.trim() || "Cannot read the git status");
    const { branch, entries } = parseStatus(status.stdout);
    const head = branch?.head !== false;
    const diff = await exec("git", diffArgs(root, head), { on }).catch(() => null);
    const stats = diff?.code === 0 ? parseNumstat(diff.stdout) : new Map();
    return { state: "ready", root, branch: branch?.name ?? "detached HEAD", files: mergeRows(entries, stats), count: entries.length, error: null,
      total: sumStats(stats), head, on: on ?? null };
  }

  apply(next, on, cx) {
    const changed = JSON.stringify(next) !== JSON.stringify(this.data);
    this.data = next;
    this.rev++;
    const { sameRoot, readyRoot } = readRoots(next.state, this.attempt, this.readyRoot);
    this.readyRoot = readyRoot;
    const published = shared(CHANGES_KEY);
    if (publishes(next.state, { sameRoot }) && published?.count !== next.count) setShared(CHANGES_KEY, { count: next.count });
    this.follow(next.root, on, cx);
    if (changed) cx.notify();
    this.onApply?.(cx);
  }

  // One folder watch for the repo shown. A remote repo has none: the timer reads it.
  follow(root, on, cx) {
    if (!root || on) { this.watched = null; this.generation++; return; }
    if (this.watched === root) return;
    this.watched = root;
    const generation = ++this.generation;
    cx.spawn(async (cx) => {
      let pending = null; // a watchFolder() call already started, so no batch is lost while we wait
      const next = () => (pending ??= watchFolder(root));
      try {
        while (this.generation === generation) {
          const changed = await next();
          pending = null;
          if (this.generation !== generation) return;
          if (!relevant(changed, root)) continue;
          // One git refresh per quiet period: a relevant batch inside the wait restarts it, an ignored one does not.
          // The total wait from the first relevant batch is capped, so constant writes still refresh.
          const start = Date.now();
          let timer = cx.sleep(DEBOUNCE_MS).then(() => null);
          for (;;) {
            const batch = next().then((c) => ({ c }));
            batch.catch(() => {}); // a failure is handled where the pending call is awaited
            const won = await Promise.race([timer, batch]);
            if (this.generation !== generation) return;
            if (!won) break;
            pending = null; // the batch won the race: it is consumed
            if (!relevant(won.c, root)) continue;
            const left = MAX_WAIT_MS - (Date.now() - start);
            if (left <= 0) break;
            timer = cx.sleep(Math.min(DEBOUNCE_MS, left)).then(() => null);
          }
          this.refresh(cx);
        }
      } catch { if (this.generation === generation) this.watched = null; }
    });
  }
}

const MINUS = "−";
const GONE = "This file has no changes any more.";
const BAR = 5;

// One file's diff body: an untracked file read whole, any other the patch of one git call. Never throws.
async function readBody({ root, head, on }, file) {
  if (file.status === "untracked") {
    const read = await readTextFile(`${root}/${file.path}`, { on }).then((text) => ({ text }), (error) => ({ error }));
    return cappedBody(wholeFile(read));
  }
  return patchBody(await exec("git", patchArgs(root, file.path, file.from, head), { on }).catch(execFailed));
}

export class ChangesTab {
  constructor(host) {
    this.host = host;
    // list: the last ready read ({ root, head, on, files }), so a diff kept through a git error still has its tabs.
    // shown: the diff drawn ({ root, file, rev, body }); pending: the one being read. pane: its mode, widths and wrapped rows.
    this.pane = new DiffPane(); this.list = null; this.shown = null; this.pending = null;
    this.generation = 0;
    this.hook = (cx) => this.applied(cx);
  }

  // Shows the file in the Files tab. The preview is made on that tab's next render.
  open(root, path, cx) {
    this.host.selectTab("files");
    this.host.files().open(`${root}/${path}`, cx);
  }

  // The watch applied a read: work only while this tab is the one shown; otherwise the next render catches up.
  applied(cx) {
    if (shownTabs(shared(SIDEBAR_STORE), shared(SIDEBAR_LAYOUT_STORE)).includes("changes")) this.sync(cx);
  }

  // Three cheap compares against the watch; each read it starts runs in a task.
  sync(cx) {
    const watch = this.host.changes(), d = watch.data;
    if (d.state === "ready") this.list = { root: d.root, head: d.head, on: d.on, files: d.files };
    // Another repo closes the diff; an error in the repo of the last good read (a lock race) keeps it.
    const open = this.pending ?? this.shown;
    if (open && (d.state === "error" ? watch.readyRoot : d.root) !== open.root) this.close();
    // A newer read than the open diff's: read its patch again once, or say the file left the list.
    // A read still running is left alone: load() checks the rev when it ends and reads once more.
    if (d.state === "ready") {
      const listed = (target) => d.files.find((f) => f.path === target.file.path);
      if (this.pending && this.pending.rev !== watch.rev && !listed(this.pending)) { this.pending = null; this.generation++; }
      if (!this.pending && this.shown && this.shown.rev !== watch.rev) {
        const file = listed(this.shown);
        if (file) this.load(file, cx);
        else this.shown = { ...this.shown, rev: watch.rev, body: { notice: GONE }, rows: null };
      }
    }
  }

  // Reads `file` of the last ready list; the diff shown stays until the answer arrives.
  load(file, cx) {
    const list = this.list, gen = ++this.generation;
    this.pending = { root: list.root, file, rev: this.host.changes().rev };
    // A binary numstat needs no read.
    if (file.status !== "untracked" && file.add === null) return this.show({ notice: BINARY });
    cx.spawn(async (cx) => {
      const body = await readBody(list, file);
      if (gen !== this.generation) return;
      this.show(body);
      // The watch read again while this one ran: one more read, of the newer state, only while this tab is shown.
      if (this.shown.rev !== this.host.changes().rev) this.applied(cx);
      cx.notify();
    });
  }

  show(body) {
    const { root, file, rev } = this.pending;
    const moved = this.shown?.file.path !== file.path;
    this.pending = null;
    this.shown = { root, file, rev, body, rows: null };
    if (!moved) return;
    const index = this.list.files.findIndex((f) => f.path === file.path);
    if (index >= 0) this.host.changes().handles?.tabs?.scroll_to_item(index);
  }

  close() {
    this.shown = null; this.pending = null; this.generation++;
  }

  openFile(path, cx) {
    const file = this.list?.files.find((f) => f.path === path);
    if (!file || (!this.pending && this.shown?.file.path === path)) return;
    this.load(file, cx);
    cx.notify();
  }

  near() {
    const open = this.pending ?? this.shown;
    return neighbors(this.list?.files ?? [], open?.file.path);
  }

  key(e, cx) {
    const n = this.near();
    const act = diffKey(e.keystroke, {
      prev: () => n.prev && this.openFile(n.prev, cx),
      next: () => n.next && this.openFile(n.next, cx),
      toggle: () => this.pane.toggle(this.pane.mode().mode === "split" ? "unified" : "split"),
      close: () => this.close(),
    });
    if (!act) return;
    act();
    cx.stop_propagation();
    cx.notify();
  }

  // The tab's width in logical px: it picks split or unified before and while a diff shows.
  resized({ width }, cx) {
    if (this.pane.resized(width / zoomOf())) cx.notify();
  }

  // "+N" green, "−N" red; untracked files say "new" and binary ones "bin" (no counts).
  counts(t, file) {
    const note = (text) => [div().flex_none().text_size(11).text_color(t.muted).child(text)];
    if (file.status === "untracked") return note("new");
    if (file.add === null) return note("bin");
    return [
      ...(file.add > 0 ? [div().flex_none().text_color(t.ansi2).child(`+${file.add}`)] : []),
      ...(file.del > 0 ? [div().flex_none().text_color(t.ansi1).child(`${MINUS}${file.del}`)] : []),
    ];
  }

  // Five blocks: green, red, then empty.
  bar(t, k, file, max) {
    const { add, del } = sizeBar(file, max);
    const color = (i) => (i < add ? t.ansi2 : i < add + del ? t.ansi1 : k.pill);
    return h_flex().id(`changes-bar-${file.path}`).flex_none().gap(1).items_center()
      .children(Array.from({ length: BAR }, (_v, i) => div().w(3).h(9).bg(color(i))));
  }

  row(t, k, file, max) {
    const badge = badgeOf(file.status), { dir, name } = splitPath(file.path);
    return h_flex().id(`change-${file.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(RADIUS.control)
      .cursor_pointer().hover((s) => s.bg(k.pill)).on_click((_e, cx) => this.openFile(file.path, cx))
      .child(div().w(10).flex_none().text_size(11).font_semibold().text_color(t[badge.color] ?? t.muted).child(badge.letter))
      .child(h_flex().flex_1().min_w(0).items_center()
        .when(dir !== "", (el) => el.child(div().min_w(0).truncate().text_color(t.muted).child(dir)))
        .child(div().min_w(0).truncate().text_color(t.foreground).child(name)))
      .children(this.counts(t, file))
      .child(this.bar(t, k, file, max));
  }

  // A read of another file shows its header over "Loading diff…"; a re-read of the same file keeps its rows.
  diff(t) {
    const loading = this.pending && this.pending.file.path !== this.shown?.file.path;
    const open = loading ? this.pending : this.shown, file = open.file, files = this.list?.files ?? [];
    const { index, prev, next } = neighbors(files, file.path);
    const parts = paneParts(t, this.pane, open, loading);
    const m = { ...parts.m, file, files, index, prev, next, handles: this.host.changes().handles };
    return diffView(t, diffTokens(t), m, {
      ...parts.on,
      back: (cx) => { this.close(); cx.notify(); },
      openFiles: (cx) => this.open(open.root, file.path, cx),
      prev: (cx) => this.openFile(prev, cx),
      next: (cx) => this.openFile(next, cx),
      pick: (path, cx) => this.openFile(path, cx),
      key: (e, cx) => this.key(e, cx),
      press: () => this.host.changes().handles?.focus?.focus(),
      menu: diffMenuOn(this.host, parts, open, loading, { root: open.root ?? null, canOpen: Boolean(open.root) }),
    });
  }

  render(t, cx) {
    const watch = this.host.changes();
    watch.check(cx);
    watch.onApply = this.hook;
    this.sync(cx);
    const d = watch.data, k = tokens(t);
    const root = v_flex().id("tab-changes").flex_1().min_h(0).text_color(t.foreground).text_size(12.5)
      .on_size_change((size, cx) => this.resized(size, cx));
    if (this.shown || this.pending) return root.child(this.diff(t));
    const empty = emptyFor(t, k, d.state, watch.dir);
    if (empty) return root.child(empty);
    if (d.state === "ready" && d.count === 0) return root.child(cleanState(t, k, summary(0, d.branch), d.root ?? watch.dir));
    const line = d.state === "ready" ? summary(d.count, d.branch) : d.state === "loading" ? "Loading changes…" : d.error;
    const more = d.count - d.files.length, max = maxChange(d.files);
    const { add, del } = d.total ?? { add: 0, del: 0 };
    return root
      .child(h_flex().id("changes-head").h(30).flex_none().pr(14).items_center()
        .child(div().id("changes-summary").h(30).flex_1().min_w(0).px(14).flex().items_center().text_size(12).text_color(t.muted).truncate().child(line))
        .when(d.state === "ready" && (add > 0 || del > 0), (el) => el.child(h_flex().id("changes-total").flex_none().gap(6).text_size(12)
          .when(add > 0, (el) => el.child(div().text_color(t.ansi2).child(`+${add}`)))
          .when(del > 0, (el) => el.child(div().text_color(t.ansi1).child(`${MINUS}${del}`))))))
      .child(v_flex().id("changes-list").flex_1().min_h(0).overflow_y_scrollbar().px(6).pb(8)
        .children(d.files.map((file) => this.row(t, k, file, max)))
        .when(more > 0, (el) => el.child(div().px(8).py(6).text_size(11).text_color(t.muted).child(`${more} more files not shown`))));
  }
}
