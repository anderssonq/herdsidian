// The Git tab of the right sidebar: the repo state, the commit graph, the detail of the selected commit, its per-file
// diff and the six actions behind ActionGate (the one place a write runs, ADR-0009). Plan: .spec/herdsidian-git-tab-plan.md.
// main.js makes the GitTab in init (its input states and handles need init's cx) and calls left() when another tab or
// the rail shows. `host`: { cx, selectTab, files, vault, changes }; host.cx is used in the constructor only.
// render never awaits and never runs a command: each read starts in cx.spawn with a generation number and the repo key.
import { div } from "gpui-kit";
import { v_flex, InputState, ScrollHandle, VirtualListScrollHandle } from "gpui-base";
import { exec, readTextFile, shared, notify } from "herdr";
import { diffTokens, gitTokens, tokens } from "./tokens.js";
import { emptyFor } from "./empty-state-view.js";
import { location } from "./files-view.js";
import { SIDEBAR_STORE, SIDEBAR_LAYOUT_STORE, shownTabs } from "./sidebar.js";
import { DiffPane } from "./diff-pane.js";
import { diffView, paneParts, zoomOf } from "./diff-view.js";
import { neighbors, diffKey } from "./diff.js";
import { BINARY, firstLine, execFailed, patchBody } from "./changes.js";
import { LOG_PAGE, logArgs, parseLog, commitFilesArgs, parseCommitFiles, commitPatchArgs } from "./git-log.js";
import { layoutLanes, laneGeometry } from "./git-lanes.js";
import { refsByCommit, shownRefs, refsKey, pickPill, matchCommits, headerOf, clampSplit } from "./git-model.js";
import { ACTIONS, LABELS, disabledReason, confirmText } from "./git-actions.js";
import { readSnapshot, ActionGate } from "./git-run.js";
import { gitGraph, gitMessage } from "./git-graph-view.js";
import { gitDetail } from "./git-detail-view.js";
import { gitCard } from "./git-card-view.js";

const LOADING = "Loading history…";
const DETAIL_KEY = "git.detail";
const DETAIL_START = 220;
// What sits above and below the graph besides the list, the card and the detail (header, actions bar, filter, splitter),
// so the clamp keeps the graph's 96 px. The card is measured (cardHeight).
const FIXED = 118;
// git-filter-note ("N of M loaded commits", 11 px text and 4 px under it), drawn only while a filter is set.
const FILTER_NOTE = 19;
const DETAIL_CACHE = 50;
const YES = { pull: "Pull", push: "Push", branch: "Create branch", stash: "Stash", pop: "Pop" };

const folderOf = (root) => String(root ?? "").split("/").filter(Boolean).pop() ?? "";

const shownNow = () => shownTabs(shared(SIDEBAR_STORE), shared(SIDEBAR_LAYOUT_STORE)).includes("git");

export class GitTab {
  constructor(host) {
    this.host = host;
    // The gate's exec wakes the view first: the write starts after the re-check, outside any handler, and the buttons must show it.
    this.tasks = new Set();
    this.gate = new ActionGate({ exec: (cmd, args, opts) => { this.wake(); return exec(cmd, args, opts); }, readTextFile });
    this.filter = InputState.new({ placeholder: "Filter commits, branches, authors…" });
    this.filter.on("change", (_e, cx) => { this.query = this.filter.value(); cx.notify(); });
    this.branchName = InputState.new({ placeholder: "Branch name" });
    this.stashMessage = InputState.new({ placeholder: "Message (optional)" });
    for (const input of [this.branchName, this.stashMessage]) {
      input.on("change", (_e, cx) => cx.notify());
      input.on("submit", (_e, cx) => this.confirm(cx));
    }
    this.handles = { focus: host.cx.focus_handle(), tabs: ScrollHandle.new() };
    this.list = VirtualListScrollHandle.new();
    const stored = Number(localStorage.getItem(DETAIL_KEY));
    this.detailHeight = Number.isFinite(stored) && stored > 0 ? stored : DETAIL_START;
    this.pane = new DiffPane();
    this.query = ""; this.size = null; this.drag = null; this.cardHeight = 0; this.splitterDrawn = false;
    // away: not shown since the last left(); the next render reloads (AC17).
    this.away = true; this.key = null; this.repo = null;
    this.gen = 0; this.loading = false; this.again = false;
    this.reset();
    this.hook = (cx) => { if (!this.away && shownNow()) this.sync(cx, true); };
  }

  // Another repo: nothing of the old one is kept.
  reset() {
    this.snap = null; this.byCommit = new Map(); this.history = null; this.lanes = null; this.byHash = new Map(); this.logError = null;
    this.selected = null; this.details = new Map(); this.reading = new Set(); this.diff = null; this.pending = null; this.diffGen = (this.diffGen ?? 0) + 1;
  }

  // main.js: another tab or the rail shows. An open card goes (AC45); a running action does not stop. No command.
  left() {
    this.gate.drop();
    this.away = true;
    this.endDrag();
  }

  // A drag ends on the release, on a move with the button up (released outside the window), on another repo, or
  // when the splitter is not drawn. The height reached is kept and stored.
  endDrag() {
    if (!this.drag) return false;
    this.drag = null;
    localStorage.setItem(DETAIL_KEY, String(this.detailHeight));
    return true;
  }

  // The repo the watch reads now. An error in the repo of the last good read (a lock race) keeps the repo, as Changes does.
  keyOf(watch) {
    const d = watch.data;
    if (d.state === "error" && this.repo && watch.readyRoot === this.repo.root) return { key: this.key, repo: this.repo };
    if (d.state !== "ready") return { key: JSON.stringify([d.state]), repo: null };
    return { key: JSON.stringify([d.root, d.on ?? null]), repo: { root: d.root, on: d.on ?? null } };
  }

  // Called from render (shown) and from the watch's hook (fromWatch). Starts reads in tasks; runs none itself.
  sync(cx, fromWatch) {
    const next = this.keyOf(this.host.changes());
    if (next.key !== this.key) {
      this.key = next.key; this.repo = next.repo; this.away = false;
      this.gate.drop(next.repo?.root ?? null, next.repo?.on ?? null);
      this.gen++; this.loading = false; this.again = false;
      this.endDrag();
      this.reset();
      if (this.repo) this.load("full", cx);
      return;
    }
    if (this.away) {
      this.away = false;
      if (this.repo) this.load("full", cx);
      return;
    }
    if (fromWatch && this.repo) this.load("watch", cx);
  }

  current(gen, key) {
    return gen === this.gen && key === this.key;
  }

  // full: the snapshot, then the log of max(loaded, 300). watch: the snapshot, the log only when the refs moved.
  // more: the next page when the refs did not move, else the whole history again with one more page (Decision 3).
  // Watch reads are merged (one running, one waiting); the others start at once and make older answers stale.
  load(kind, cx) {
    if (kind === "watch" && this.loading) { this.again = true; return; }
    const gen = ++this.gen, key = this.key, { root, on } = this.repo, had = this.history;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const snap = await readSnapshot({ exec, readTextFile }, { cwd: root, on });
        if (!this.current(gen, key)) return;
        this.snap = snap; this.byCommit = refsByCommit(snap.error ? [] : shownRefs(snap));
        if (snap.error) return;
        const refs = refsKey(snap);
        // A repo with no commit runs no log (AC12).
        if (!snap.head) return this.setHistory([], false, refs, cx);
        const loaded = had?.commits.length ?? 0, same = had?.refsKey === refs;
        if (kind === "watch" && same) return;
        const append = kind === "more" && same;
        const count = append ? LOG_PAGE : kind === "more" ? loaded + LOG_PAGE : Math.max(loaded, LOG_PAGE);
        cx.notify();
        const r = await exec("git", logArgs(root, count, append ? loaded : 0), { on }).catch(execFailed);
        if (!this.current(gen, key)) return;
        if (r.code !== 0) { this.logError = firstLine(r.stderr) || "Cannot read the history"; return; }
        const page = parseLog(r.stdout);
        if (!append) return this.setHistory(page, page.length >= count, refs, cx);
        const seen = new Set(had.commits.map((c) => c.hash));
        this.setHistory([...had.commits, ...page.filter((c) => !seen.has(c.hash))], page.length >= LOG_PAGE, refs, cx);
      } finally {
        if (gen === this.gen) {
          this.loading = false;
          if (this.again) { this.again = false; this.load("watch", cx); }
        }
        cx.notify();
      }
    });
  }

  // A new history: lanes once per history, the selection kept when still loaded, else HEAD (AC35), else none.
  setHistory(commits, more, refs, cx) {
    this.history = { commits, more, refsKey: refs }; this.logError = null;
    this.lanes = layoutLanes(commits);
    this.byHash = new Map(commits.map((c, i) => [c.hash, i]));
    if (!this.byHash.has(this.selected)) this.selected = this.byHash.has(this.snap?.head) ? this.snap.head : null;
    this.readDetail(cx);
  }

  commitOf(hash) {
    const i = this.byHash.get(hash);
    return i === undefined ? null : this.history.commits[i];
  }

  // The files of the selected commit, once per commit (a commit never changes). A failed read is shown but not kept:
  // selecting the commit again reads it again.
  readDetail(cx) {
    const commit = this.commitOf(this.selected), details = this.details;
    if (!commit || (details.has(commit.hash) && !details.get(commit.hash).error) || this.reading.has(commit.hash)) return;
    const { root, on } = this.repo, reading = this.reading;
    reading.add(commit.hash);
    cx.spawn(async (cx) => {
      const r = await exec("git", commitFilesArgs(root, commit), { on }).catch(execFailed);
      reading.delete(commit.hash);
      if (details !== this.details) return; // another repo since
      if (details.size >= DETAIL_CACHE) details.delete(details.keys().next().value);
      details.set(commit.hash, r.code === 0 ? parseCommitFiles(r.stdout) : { error: firstLine(r.stderr) || "Cannot read the commit" });
      cx.notify();
    });
  }

  select(hash, cx) {
    this.selected = hash;
    this.readDetail(cx);
    cx.notify();
  }

  item(key, cx) {
    if (key === "wip") { this.host.selectTab("changes"); return cx.notify(); }
    if (key === "more") return this.history?.more && this.repo && this.load("more", cx);
    if (this.byHash.has(key)) this.select(key, cx);
  }

  // A button: Fetch runs at once, the others only open a card (AC45). No await between press() and run().
  act(action, cx) {
    const answer = this.gate.press(action, this.snap);
    if (answer === "run") this.finish(this.gate.run(), cx);
    if (answer === "card") {
      this.branchName.set_value(""); this.stashMessage.set_value("");
      if (action === "branch") this.branchName.focus();
      if (action === "stash") this.stashMessage.focus();
    }
    cx.notify();
  }

  inputOf(card) {
    return card?.action === "branch" ? this.branchName : card?.action === "stash" ? this.stashMessage : null;
  }

  // The card's confirm button and its input's submit: the gate re-checks the folder focused now, then runs.
  confirm(cx) {
    const card = this.gate.card;
    if (!card) return;
    this.finish(this.gate.confirm(location(), this.inputOf(card)?.value() ?? ""), cx);
    cx.notify();
  }

  // An outcome of the repo shown: same root and same machine.
  here(outcome) {
    return Boolean(this.repo) && outcome.root === this.repo.root && (outcome.on ?? null) === (this.repo.on ?? null);
  }

  // A redraw through every live action task. A failed redraw is ignored: it must never turn a started write into a failure.
  wake() {
    for (const task of this.tasks) {
      try { task.cx.notify(); } catch { /* a dead context: the next redraw shows the state */ }
    }
  }

  // The end of an action (D3): the panel when this repo is shown, else a notice; the reload waits until Git shows.
  // Each task is its own entry, so a second confirm that ends at once does not stop the first one's redraws.
  finish(promise, cx) {
    cx.spawn(async (cx) => {
      const task = { cx };
      this.tasks.add(task);
      try {
        const outcome = await promise;
        if (!outcome) return;
        const here = this.here(outcome);
        const shown = !this.away && shownNow();
        if (!here || !shown) {
          notify({ title: `${folderOf(outcome.root)}: ${outcome.title}`, ...(outcome.lines[0] ? { body: outcome.lines[0] } : {}),
            level: outcome.kind === "done" ? "success" : outcome.kind === "stale" ? "warning" : "error" });
        }
        if (!here && this.gate.result === outcome) this.gate.dismiss();
        if (here && shown) this.load("full", cx);
      } finally {
        this.tasks.delete(task);
        cx.notify();
      }
    });
  }

  // The commit diff (AC42, AC43): one patch read per file shown; a binary file needs none.
  // diff: the file drawn ({ commit, file, body, rows, long }); pending: the one being read. The drawn one stays meanwhile.
  openFile(path, cx) {
    if (!this.repo) return; // a kept handler after the repo went
    const commit = this.commitOf(this.selected), files = commit ? this.details.get(commit.hash)?.files : null;
    const file = files?.find((f) => f.path === path);
    if (!file) return;
    const gen = ++this.diffGen, { root, on } = this.repo;
    // Back to the file drawn: a commit never changes, so its patch is not read again.
    if (this.diff?.commit === commit && this.diff.file.path === path) { this.pending = null; return cx.notify(); }
    this.pending = { commit, file };
    cx.notify();
    if (file.add === null) return this.showBody(gen, { notice: BINARY }, files);
    cx.spawn(async (cx) => {
      const r = await exec("git", commitPatchArgs(root, commit, file), { on }).catch(execFailed);
      if (gen !== this.diffGen) return;
      this.showBody(gen, patchBody(r), files);
      cx.notify();
    });
  }

  showBody(gen, body, files) {
    if (gen !== this.diffGen || !this.pending) return;
    const { commit, file } = this.pending;
    this.pending = null;
    this.diff = { commit, file, body, rows: null };
    const index = files.indexOf(file);
    if (index >= 0) this.handles.tabs?.scroll_to_item?.(index);
  }

  // Back and Esc: the graph again, scrolled to the selected commit.
  closeDiff() {
    this.diff = null; this.pending = null; this.diffGen++;
    const index = this.rows().findIndex((r) => r.key === this.selected);
    if (index >= 0) this.list.scroll_to_item(index);
  }

  // The file named in the header: the one being read, else the one drawn.
  openDiff() {
    return this.pending ?? this.diff;
  }

  diffFiles() {
    const open = this.openDiff();
    return this.details.get(open.commit.hash)?.files ?? [open.file];
  }

  keyDown(e, cx) {
    if (!this.repo || !this.openDiff()) return; // a kept diff handler after the diff closed or the repo changed
    const n = neighbors(this.diffFiles(), this.openDiff().file.path);
    const act = diffKey(e.keystroke, {
      prev: () => n.prev && this.openFile(n.prev, cx),
      next: () => n.next && this.openFile(n.next, cx),
      toggle: () => this.pane.toggle(this.pane.mode().mode === "split" ? "unified" : "split"),
      close: () => this.closeDiff(),
    });
    if (!act) return;
    act();
    cx.stop_propagation();
    cx.notify();
  }

  resized({ width, height }, cx) {
    const zoom = zoomOf(), size = { width: width / zoom, height: height / zoom };
    const changed = size.width !== this.size?.width || size.height !== this.size?.height;
    this.size = size;
    if (this.pane.resized(size.width) || changed) cx.notify();
  }

  // The detail height shown: the stored one, clamped to the tab once its height is known (AC37).
  detailShown() {
    return this.size ? clampSplit(this.detailHeight, this.graphRoom()) : this.detailHeight;
  }

  // The height the graph and the detail share: the tab less its fixed parts, the card or result panel and the filter note (AC37).
  graphRoom() {
    return this.size.height - FIXED - this.cardHeight - (this.query.trim() ? FILTER_NOTE : 0);
  }

  // The rows of git-rows: the uncommitted row, the commits (all, or the ones the filter matches), Load more.
  rows() {
    const h = this.history;
    if (!h) return [];
    const query = this.query.trim(), d = this.host.changes().data;
    const shown = matchCommits(h.commits, this.byCommit, query);
    const wip = !query && d.state === "ready" && d.root === this.repo?.root && d.count > 0
      ? [{ key: "wip", kind: "wip", count: d.count, add: d.total?.add ?? 0, del: d.total?.del ?? 0,
        col: this.lanes.rows[this.byHash.get(this.snap?.head)]?.col ?? 0 }] : [];
    const commits = shown.map((commit) => ({ key: commit.hash, kind: "commit", commit, lane: query ? null : this.lanes.rows[this.byHash.get(commit.hash)],
      pill: pickPill(this.byCommit.get(commit.hash)), selected: commit.hash === this.selected }));
    return [...wip, ...commits, ...(h.more ? [{ key: "more", kind: "more" }] : [])];
  }

  card(t, gk) {
    // R14: a result of another repo or machine is never drawn (its notice was sent).
    const card = this.gate.card, result = this.gate.result && this.here(this.gate.result) ? this.gate.result : null;
    if (!card && !result) { this.cardHeight = 0; return null; }
    const input = this.inputOf(card);
    const confirm = card && { text: confirmText(card, input?.value() ?? ""), yes: card.action === "push" && card.publish ? "Publish" : YES[card.action],
      input, error: this.gate.nameError };
    const panel = result && { title: result.title, lines: result.lines, failed: result.kind === "failed" || result.kind === "no-answer" };
    const drawn = gitCard(t, gk, { confirm, result: panel }, {
      confirm: (cx) => this.confirm(cx),
      cancel: (cx) => { this.gate.cancel(); cx.notify(); },
      copy: (cx) => { if (this.gate.result) cx.write_to_clipboard(this.gate.result.full); },
      close: (cx) => { this.gate.dismiss(); cx.notify(); },
    });
    // Measured, so the clamp leaves the graph its 96 px under the card (AC37).
    return div().id("git-between").flex_none().on_size_change((size, cx) => this.cardSized(size, cx)).child(drawn);
  }

  cardSized({ height }, cx) {
    const next = height / zoomOf();
    if (next === this.cardHeight) return;
    this.cardHeight = next;
    cx.notify();
  }

  graph(t, gk, message) {
    const snap = this.snap, query = this.query.trim();
    const rows = message ? [] : this.rows();
    const m = {
      header: headerOf(snap),
      actions: ACTIONS.map((action) => ({ action, label: LABELS[action], reason: disabledReason(action, snap, this.gate.running) })),
      between: this.card(t, gk), message, filter: this.filter, query, handle: this.list, now: Date.now(),
      matched: rows.filter((r) => r.kind === "commit").length, loaded: this.history?.commits.length ?? 0, rows,
      geo: laneGeometry(query ? 1 : Math.max(1, this.lanes?.width ?? 1)),
    };
    return gitGraph(t, gk, m, { act: (action, cx) => this.act(action, cx), item: (key, cx) => this.item(key, cx) });
  }

  detail(t, gk) {
    const commit = this.commitOf(this.selected);
    this.splitterDrawn = true;
    const m = { height: this.detailShown(), commit, refs: commit ? this.byCommit.get(commit.hash) ?? [] : [], now: Date.now(),
      slot: commit ? this.lanes.rows[this.byHash.get(commit.hash)]?.col ?? 0 : 0, files: commit ? this.details.get(commit.hash) ?? null : null };
    return gitDetail(t, gk, m, {
      splitDown: (e, cx) => { this.drag = { y: e.position.y / zoomOf(), height: this.detailShown() }; cx.notify(); },
      splitMove: (e, cx) => {
        if (!this.drag) return;
        if (e.pressed_button !== "left") { this.endDrag(); return cx.notify(); }
        const next = this.drag.height + this.drag.y - e.position.y / zoomOf();
        this.detailHeight = this.size ? clampSplit(next, this.graphRoom()) : Math.max(next, 120);
        cx.notify();
      },
      splitUp: (_e, cx) => { if (this.endDrag()) cx.notify(); },
      copyHash: (cx) => {
        if (!commit) return;
        cx.write_to_clipboard(commit.hash);
        notify({ title: "Hash copied", level: "success" });
      },
      file: (path, cx) => this.openFile(path, cx),
    });
  }

  // Another file being read shows its header over "Loading diff…".
  diffPart(t) {
    const loading = this.pending && this.pending.file.path !== this.diff?.file.path;
    const open = loading ? this.pending : this.diff, files = this.diffFiles();
    const { index, prev, next } = neighbors(files, open.file.path);
    const parts = paneParts(t, this.pane, open, loading);
    // No "Open in Files" in a commit: the file may not be in the work tree any more, so diffView needs no openFiles.
    const m = { ...parts.m, file: open.file, files, index, prev, next, handles: this.handles, hideOpenFiles: true, backTip: "Back to the commit" };
    return diffView(t, diffTokens(t), m, {
      ...parts.on,
      back: (cx) => { this.closeDiff(); cx.notify(); },
      prev: (cx) => this.openFile(prev, cx),
      next: (cx) => this.openFile(next, cx),
      pick: (path, cx) => this.openFile(path, cx),
      key: (e, cx) => this.keyDown(e, cx),
      press: () => this.handles.focus?.focus(),
    });
  }

  // The shared empty state for norepo, nofolder and unknown, or null for any other state. It keeps the git-message id of
  // the plain message it replaces.
  empty(t, state, dir) {
    const block = emptyFor(t, tokens(t), state, dir);
    return block && v_flex().id("git-message").flex_1().min_h(0).child(block);
  }

  // A message alone, the graph with a message (no commit yet), or the graph and the detail.
  body(t, gk) {
    const d = this.host.changes().data;
    if (!this.repo) {
      if (d.state === "error") return gitMessage(t, firstLine(d.error) || "Cannot read the git status");
      return this.empty(t, d.state, this.host.changes().dir) ?? gitMessage(t, LOADING);
    }
    const snap = this.snap;
    if (!snap) return gitMessage(t, LOADING);
    if (snap.error) return this.empty(t, snap.error === "Not a git repository" ? "norepo" : "unknown", this.repo.root);
    if (!snap.head) return this.graph(t, gk, `No commits yet on ${snap.branch ?? "HEAD"}`);
    if (!this.history) return gitMessage(t, this.logError ?? LOADING);
    return v_flex().flex_1().min_h(0).child(this.graph(t, gk, null)).child(this.detail(t, gk));
  }

  render(t, cx) {
    // AC11: no command while another tab shows; the next render on Git reloads.
    if (shownNow()) {
      const watch = this.host.changes();
      watch.check(cx);
      watch.onApply = this.hook;
      this.sync(cx, false);
    } else this.away = true;
    const root = v_flex().id("tab-git").flex_1().min_h(0).text_color(t.foreground).text_size(12.5)
      .on_size_change((size, cx) => this.resized(size, cx));
    this.splitterDrawn = false;
    const body = (this.diff || this.pending) && this.repo ? this.diffPart(t) : this.body(t, gitTokens(t));
    // No splitter on screen: a drag in progress cannot get its release.
    if (!this.splitterDrawn) this.endDrag();
    return root.child(body);
  }
}
