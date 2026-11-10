// The Changes tab of the right sidebar (V1): the files `git status` lists for the focused pane's repo, with their
// +N / −N counts. Herdr's own `changes` mod cannot be hosted or restyled here, so this is a minimal list of our own.
// main.js makes the ChangesWatch once in init (its count feeds the tab badge) and the ChangesTab on the first render.
// `host`: { cx, selectTab, files, changes } from main.js. host.cx is valid only during init: the watch uses it in its
// constructor and nowhere else; later work uses the context each call or task is given.
import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, watchFolder, shared, setShared } from "herdr";
import { RADIUS, tokens } from "./tokens.js";
import { location } from "./files-view.js";
import { topArgs, statusArgs, diffArgs, classifyTop, publishes, readRoots, parseStatus, parseNumstat, mergeRows, relevant, summary, DEBOUNCE_MS, MAX_WAIT_MS } from "./changes.js";

// Written when the count changes: { count } for the sidebar Changes tab badge.
const CHANGES_KEY = "herdsidian.changes";
const EMPTY = { state: "loading", root: null, branch: null, files: [], count: 0, error: null };

// What git says about the focused pane's repo: { state, root, branch, files, count, error }.
// state: "loading", "ready", "nofolder", "norepo" or "error".
export class ChangesWatch {
  constructor(host) {
    this.host = host;
    this.data = EMPTY; this.key = null; this.busy = false; this.again = false; this.watched = null; this.generation = 0;
    this.attempt = null; this.readyRoot = null;
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
      if (this.key === key) this.apply(next, where.on, cx);
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
    const diff = await exec("git", diffArgs(root, branch?.head !== false), { on }).catch(() => null);
    const stats = diff?.code === 0 ? parseNumstat(diff.stdout) : new Map();
    return { state: "ready", root, branch: branch?.name ?? "detached HEAD", files: mergeRows(entries, stats), count: entries.length, error: null };
  }

  apply(next, on, cx) {
    const changed = JSON.stringify(next) !== JSON.stringify(this.data);
    this.data = next;
    const { sameRoot, readyRoot } = readRoots(next.state, this.attempt, this.readyRoot);
    this.readyRoot = readyRoot;
    const published = shared(CHANGES_KEY);
    if (publishes(next.state, { sameRoot }) && published?.count !== next.count) setShared(CHANGES_KEY, { count: next.count });
    this.follow(next.root, on, cx);
    if (changed) cx.notify();
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

export class ChangesTab {
  constructor(host) { this.host = host; }

  // Shows the file in the Files tab. The preview is made on that tab's next render.
  open(root, path, cx) {
    this.host.selectTab("files");
    this.host.files().open(`${root}/${path}`, cx);
  }

  // "+N" green, "−N" red; untracked files say "new" and binary ones "bin" (no counts).
  counts(t, file) {
    const note = (text) => [div().flex_none().text_size(11).text_color(t.muted).child(text)];
    if (file.status === "untracked") return note("new");
    if (file.add === null) return note("bin");
    return [
      ...(file.add > 0 ? [div().flex_none().text_color(t.ansi2).child(`+${file.add}`)] : []),
      ...(file.del > 0 ? [div().flex_none().text_color(t.ansi1).child(`−${file.del}`)] : []),
    ];
  }

  render(t, cx) {
    const watch = this.host.changes();
    watch.check(cx);
    const d = watch.data, k = tokens(t);
    const messages = { loading: "Loading changes…", nofolder: "No folder", norepo: "Not a git repository", unknown: "Cannot read the git folder", error: d.error };
    const line = d.state === "ready" ? summary(d.count, d.branch) : messages[d.state];
    const more = d.count - d.files.length;
    return v_flex().id("tab-changes").flex_1().min_h(0).text_color(t.foreground).text_size(12.5)
      .child(div().id("changes-summary").h(30).flex_none().px(14).flex().items_center().text_size(12).text_color(t.muted).truncate().child(line))
      .child(v_flex().id("changes-list").flex_1().min_h(0).overflow_y_scrollbar().px(6).pb(8)
        .children(d.files.map((file) => h_flex().id(`change-${file.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(RADIUS.control)
          .cursor_pointer().hover((s) => s.bg(k.pill)).on_click((_e, cx) => this.open(d.root, file.path, cx))
          .child(div().flex_1().min_w(0).truncate().child(file.path))
          .children(this.counts(t, file))))
        .when(more > 0, (el) => el.child(div().px(8).py(6).text_size(11).text_color(t.muted).child(`${more} more files not shown`))));
  }
}
