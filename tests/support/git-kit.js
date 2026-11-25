// The test kit of the Git tab: a fake git that answers every read of the plan's Decision 3 from a plain object, a fake
// git-dir reader, a host built the way main.js builds it, and a small notation for commits. It has no assertion and no
// product logic: it never computes a lane or a disabled reason.
// Import it before any mod and before changes-kit.js: it adds the virtual-list handle stub, then loads changes-kit.js
// (which sets the other stubs and loads the Changes and Files tabs).
import { state, fakeCx, findById, walk, element, settle } from "./mod-stubs.js";
import { during } from "./live-cx.js";
import { themeOf } from "./themes.js";

export { state, fakeCx, findById, walk, element, settle, during, themeOf };

// The handle a virtual list tracks: it records scroll_to_item and answers offset(). A test moves it with `position`.
// It must be on the stub before any mod imports the name, so changes-kit.js is loaded after it.
export const listHandles = [];
const { "gpui-base": base } = globalThis.__herdsidianStubs;
base.VirtualListScrollHandle = {
  new: () => {
    const handle = {
      scrolls: [], bottoms: 0, position: { x: 0, y: 0 }, content: { width: 0, height: 0 }, viewport: { width: 0, height: 0 },
      scroll_to_item: (...args) => { handle.scrolls.push(args); },
      scroll_to_bottom: () => { handle.bottoms++; },
      offset: () => handle.position,
      content_size: () => handle.content,
      viewport_size: () => handle.viewport,
      release: () => true,
    };
    listHandles.push(handle);
    return handle;
  },
};

const kit = await import("./changes-kit.js");
export const { world, spaces, panes, focused, agents, home, watchFolder, settings, scrollHandle, focusHandle, rowsOf, fakeFiles, reset,
  texts, call, has } = kit;

const { ChangesWatch } = await import("../../mods/herdsidian/changes-view.js");
const { FilesTab } = await import("../../mods/herdsidian/files-view.js");

// The Git tab loads lazily: a missing or broken git-view.js fails the test that mounts the tab, not a test that only
// needs fakeRepo or commitsOf.
let gitView = null, gitViewError = null;
try { gitView = await import("../../mods/herdsidian/git-view.js"); } catch (e) { gitViewError = e; }

// The focused folder the Changes watch and the Git tab read: one active space whose folder is `cwd` (on a machine for a remote repo).
export const focusRepo = (cwd = "/work/repo", on = null) => { kit.spaces([{ id: "s1", active: true, folder: cwd, machine: on }]); };

// A promise a test resolves later, for a write that must stay "running".
export function deferred() {
  const hold = {};
  hold.promise = new Promise((resolve, reject) => { hold.resolve = resolve; hold.reject = reject; });
  return hold;
}

const NUL = "\0";
const val = (value, ...args) => (typeof value === "function" ? value(...args) : value);
const done = (stdout = "", stderr = "", code = 0) => ({ stdout, stderr, code });
const hexOf = (letter) => letter.repeat(40);

// The git sub-command of an argument list: the first word after the leading global options. -C, -c and the options
// that take their value as the next word (--git-dir /x) skip that value; --git-dir=/x is one word and is skipped.
const GLOBAL_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--super-prefix", "--config-env"]);
function subIndex(args) {
  for (let i = 0; i < args.length; i++) {
    if (GLOBAL_WITH_VALUE.has(args[i])) { i++; continue; }
    if (args[i].startsWith("-")) continue;
    return i;
  }
  return -1;
}
const subOf = (args) => args[subIndex(args)] ?? null;
const basename = (cmd) => String(cmd).split("/").pop();
const isGit = (cmd) => basename(cmd) === "git";
const isSh = (cmd) => basename(cmd) === "sh";

// Which write a call is, or null for a read. Reads are an allowlist; anything else is a write, so a write spelled in a
// way the kit does not know still shows in log.writes(). By the git sub-command only: a branch or file named "switch"
// is not a write. env (after git) is the network actions' prefix.
function writeKind(cmd, args) {
  if (cmd === "env") {
    const sub = subOf(args.slice(args.findIndex((a) => isGit(a)) + 1));
    return ["fetch", "pull", "push"].includes(sub) ? sub : "env";
  }
  // sh is the Files tab's listing; find is the Notes vault index. Both only read.
  if (isSh(cmd) || basename(cmd) === "find") return null;
  if (!isGit(cmd)) return "write";
  const i = subIndex(args), sub = args[i];
  if (sub === "switch") return "branch";
  if (sub === "stash") return args[i + 1] === "push" ? "stash" : args[i + 1] === "pop" ? "pop" : args[i + 1] === "list" ? null : "write";
  if (sub === "remote") return args.length === i + 1 ? null : "write";
  return ["rev-parse", "status", "diff", "diff-tree", "for-each-ref", "check-ref-format", "log"].includes(sub) ? null : "write";
}

// The kind of a read, as named in `fail`, `reject` and log.count().
function readKind(cmd, args) {
  if (isSh(cmd)) return "sh";
  if (!isGit(cmd)) return "other";
  const sub = subOf(args);
  if (sub === "rev-parse") return args.includes("--absolute-git-dir") ? "dirs" : "top";
  if (sub === "status") return args.includes("--porcelain=v2") ? "status2" : "status";
  if (sub === "diff") return args.includes("--numstat") ? "numstat" : "wip-patch";
  if (sub === "diff-tree") return args.includes("-p") ? "patch" : "files";
  if (sub === "for-each-ref") return "refs";
  if (sub === "check-ref-format") return "check";
  return { log: "log", remote: "remotes", stash: "stash-top" }[sub] ?? "other";
}

const kindOf = (cmd, args) => writeKind(cmd, args) ?? readKind(cmd, args);

// A status entry from a path or an object { path, xy, from, add, del }. xy is the v1 pair: " M", "A ", "R ", "??".
const entryOf = (e) => (typeof e === "string" ? { path: e, xy: " M" } : { xy: " M", ...e });
const entriesOf = (list, prefix) => (typeof list === "number" ? Array.from({ length: list }, (_, i) => `${prefix}${i + 1}.txt`) : list ?? []).map(entryOf);

// `status --porcelain=v2 --branch --show-stash -z`.
function status2(s) {
  const records = [`# branch.oid ${s.head ?? "(initial)"}`, `# branch.head ${s.branch ?? "(detached)"}`];
  if (s.upstream) records.push(`# branch.upstream ${s.upstream.short ?? `${s.upstream.remote}/${s.branch}`}`);
  if (s.upstream && s.ahead !== null) records.push(`# branch.ab +${s.ahead ?? 0} -${s.behind ?? 0}`);
  if (s.stash) records.push("# stash 1");
  for (const e of s.changedList) {
    const xy = e.xy.replace(/ /g, ".");
    if (e.xy === "??") records.push(`? ${e.path}`);
    else if (e.from) records.push(`2 ${xy} N... 100644 100644 100644 ${hexOf("a")} ${hexOf("b")} R100 ${e.path}`, e.from);
    else records.push(`1 ${xy} N... 100644 100644 100644 ${hexOf("a")} ${hexOf("b")} ${e.path}`);
  }
  for (const e of s.unmergedList) records.push(`u UU N... 100644 100644 100644 100644 ${hexOf("a")} ${hexOf("b")} ${hexOf("c")} ${e.path}`);
  return records.map((r) => r + NUL).join("");
}

// `status --porcelain=v1 -z --branch`, the Changes watch's read.
function status1(s) {
  let head = `## ${s.branch}`;
  if (s.head === null) head = `## No commits yet on ${s.branch}`;
  else if (s.branch === null) head = "## HEAD (no branch)";
  else if (s.upstream) {
    const gone = [s.ahead ? `ahead ${s.ahead}` : null, s.behind ? `behind ${s.behind}` : null].filter(Boolean).join(", ");
    head += `...${s.upstream.short ?? `${s.upstream.remote}/${s.branch}`}${gone ? ` [${gone}]` : ""}`;
  }
  const records = [head];
  for (const e of s.changedList) records.push(`${e.xy} ${e.path}`, ...(e.from ? [e.from] : []));
  for (const e of s.unmergedList) records.push(`UU ${e.path}`);
  return records.map((r) => r + NUL).join("");
}

// `diff --numstat -z`, the Changes watch's read: only entries that carry add and del.
const numstat1 = (s) => s.changedList.filter((e) => e.add !== undefined).map((e) => `${e.add ?? "-"}\t${e.del ?? "-"}\t${e.path}${NUL}`).join("");

// The for-each-ref lines (P3): refname, object, peeled object, symref, upstream remote, upstream ref, "*" for HEAD.
function refLines(s) {
  const prefix = { local: "refs/heads/", remote: "refs/remotes/", tag: "refs/tags/" };
  // With no commit the default branch has no ref: git prints nothing.
  const list = s.refs ?? (s.branch && s.head ? [{ full: `refs/heads/${s.branch}`, sha: s.head }] : []);
  return list.map((r) => {
    const full = r.full ?? `${prefix[r.kind]}${r.name}`;
    const current = r.current ?? full === `refs/heads/${s.branch}`;
    const up = current && s.upstream ? s.upstream : null;
    return [full, r.sha ?? s.head ?? "", r.peeled ?? "", r.symref ?? "", up?.remote ?? "", up?.ref ?? "", current ? "*" : " "].join(NUL) + "\n";
  }).join("");
}

// `log` records: hash NUL parents NUL author NUL email NUL seconds NUL subject, one per line; -n and --skip are honored.
function logLines(commits, args) {
  const num = (flag) => { const i = args.indexOf(flag); return i < 0 ? null : Number(args[i + 1]); };
  const skip = Number((args.find((a) => a.startsWith("--skip=")) ?? "--skip=0").slice(7));
  const count = num("-n");
  const page = commits.slice(skip, count === null ? undefined : skip + count);
  return page.map((c) => [c.hash, (c.parents ?? []).join(" "), c.author ?? "", c.email ?? "", c.at === null || c.at === undefined ? "" : Math.floor(c.at / 1000), c.subject ?? ""].join(NUL) + "\n").join("");
}

// `diff-tree -r -z --raw --numstat -M`: the raw records first, then the numstat records (D1, P3).
function treeFiles(files) {
  const letter = { added: "A", modified: "M", deleted: "D", renamed: "R100" };
  const raw = files.map((f) => `:100644 100644 ${hexOf("0")} ${hexOf("1")} ${letter[f.status ?? "modified"]}${NUL}${f.from ? `${f.from}${NUL}` : ""}${f.path}${NUL}`).join("");
  const stat = files.map((f) => {
    const counts = f.add === null || f.add === undefined ? "-\t-" : `${f.add}\t${f.del ?? 0}`;
    return f.from ? `${counts}\t${NUL}${f.from}${NUL}${f.path}${NUL}` : `${counts}\t${f.path}${NUL}`;
  }).join("");
  return raw + stat;
}

// A git that answers by its arguments, from a plain object, and records every call as [cmd, args, opts].
// spec: { root, gitDir, head, branch, upstream: { remote, ref, short } | null, ahead, behind, remotes, changed, unmerged,
//   stash: { hash, message } | null, refs, commits, files, patches, on, fail, reject, write, focus }
// - changed, unmerged: a count, or a list of paths or { path, xy, from, add, del }. remotes: names. refs: { full | (kind, name), sha, peeled, symref, current }.
// - commits: [{ hash, parents, author, email, at, subject }] in log order. files: { [hash]: [{ path, from, status, add, del }] }.
// - patches: { [`${hash}:${path}`] or [path]: patch text }. Every field may be a function: it runs at each read.
// - on: the machine of the focused space (a remote repo). The kit focuses the repo unless `focus` is false.
// - fail: read kinds that exit 128: "top" "dirs" "status" "status2" "numstat" "refs" "remotes" "stash-top" "log" "files" "patch" "check".
//   log.count(kind) takes those, "sh", and the write kinds "fetch" "pull" "push" "branch" "stash" "pop".
//   reject: kinds whose exec rejects. write(args, opts, cmd): what a write answers: a result, a string (stdout), a thrown or
//   rejected error, or a promise (see deferred()). A plain object or string works too.
// Returns { calls, log, spec, set(patch) }. Defaults: a repo at /work/repo on main, HEAD at the first commit, no remote, clean.
export function fakeRepo(spec = {}) {
  const calls = [];
  const live = { root: "/work/repo", branch: "main", upstream: null, remotes: [], changed: 0, unmerged: 0, stash: null, commits: [], files: {}, patches: {}, on: null, fail: [], reject: [], ...spec };
  const view = () => {
    const s = {};
    for (const key of Object.keys(live)) s[key] = ["write", "fail", "reject"].includes(key) ? live[key] : val(live[key]);
    s.head = "head" in live ? val(live.head) : (s.commits[0]?.hash ?? null);
    s.gitDir = live.gitDir === undefined ? `${s.root}/.git` : val(live.gitDir);
    if (s.upstream && s.ahead === undefined) s.ahead = 0;
    s.changedList = entriesOf(s.changed, "changed");
    s.unmergedList = entriesOf(s.unmerged, "conflict");
    return s;
  };
  const list = (kinds) => (Array.isArray(kinds) ? kinds : [kinds]);
  state.exec = async (cmd, args, opts = {}) => {
    calls.push([cmd, args, opts]);
    const s = view();
    const kind = kindOf(cmd, args);
    if (writeKind(cmd, args)) {
      const reply = typeof live.write === "function" ? await live.write(args, opts, cmd) : live.write;
      if (reply === undefined || reply === null) return done();
      return typeof reply === "string" ? done(reply) : { stdout: "", stderr: "", code: 0, ...reply };
    }
    if (list(live.reject).includes(kind)) throw new Error(`fake ${kind} rejection: git did not run`);
    if (list(live.fail).includes(kind)) return done("", `fake ${kind} failure`, 128);
    const sha = args.at(-1), at = args.indexOf("--");
    switch (kind) {
      case "top": return done(`${s.root}\n`);
      case "dirs": return done(`${s.root}\n${s.gitDir}\n`);
      case "status": return done(status1(s));
      case "status2": return done(status2(s));
      case "numstat": return done(numstat1(s));
      case "refs": return done(refLines(s));
      case "remotes": return done(s.remotes.map((r) => `${r}\n`).join(""));
      case "stash-top": return done(s.stash ? `${s.stash.hash}${NUL}${s.stash.message}\n` : "");
      case "log": return done(logLines(s.commits, args));
      case "files": return done(treeFiles(val(s.files[sha] ?? [], args)));
      case "patch": {
        const path = args.at(-1), hash = at > 0 ? args[at - 1] : sha;
        return done(val(s.patches[`${hash}:${path}`] ?? s.patches[path] ?? "", args));
      }
      case "check": return done();
      default: return done();
    }
  };
  const log = {
    reads: () => calls.filter(([cmd, args]) => !writeKind(cmd, args)),
    writes: () => calls.filter(([cmd, args]) => writeKind(cmd, args)),
    count: (kind) => calls.filter(([cmd, args]) => kindOf(cmd, args) === kind).length,
  };
  if (spec.focus !== false) focusRepo(val(live.root), val(live.on) ?? null);
  return { calls, log, spec: live, set: (patch) => { Object.assign(live, patch); } };
}

// readTextFile for the git dir, as Herdr answers: a text for a listed file, null for the others.
// names: a list of file names ("MERGE_HEAD", "rebase-merge/head-name") or an object { name: text }. Returns { calls, paths }.
export function fakeOps(names = []) {
  const files = Array.isArray(names) ? Object.fromEntries(names.map((n) => [n, "1\n"])) : names;
  const calls = [], paths = [];
  state.readTextFile = async (path, opts) => {
    calls.push([path, opts]);
    paths.push(path);
    const hit = Object.keys(files).find((n) => path.endsWith(`/${n}`));
    return hit === undefined ? null : files[hit];
  };
  return { calls, paths };
}

const T = { foreground: "#eeeeee", background: "#111111", chrome: "#222222", canvas: "#333333", raised: "#2a2a2a", accent: "#ff00aa",
  muted: "#999999", dim: "#555555", hover: "#444444", blocked: "#ffaa00", ansi1: "#ff0001", ansi2: "#00ff02",
  ansi3: "#ffff03", ansi4: "#0000ff", ansi5: "#ff00ff", ansi6: "#00ffff" };

// Handlers a builder recorded on a node, by method name (and a button for the mouse-down and mouse-up ones).
const handlerOf = (node, name, button) => node?.calls.find(([n, a]) => n === name && (button === undefined || a[0] === button))?.[1].at(-1);
const anywhere = (tree, name, button) => walk(tree).map((n) => handlerOf(n, name, button)).find(Boolean);

// The host as main.js builds it: the watch, the Files tab and the Git tab made during init's cx, with the sidebar on `tab`.
export function mountGit({ theme = T, vault = null, tab = "git" } = {}) {
  if (gitViewError) throw gitViewError;
  const cx = kit.fakeCx(), selected = [], timers = [], handles = [], stops = { count: 0 };
  cx.timer.every = (ms, fn) => { timers.push([ms, fn]); };
  cx.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 100)));
  cx.stop_propagation = () => { stops.count++; };
  cx.focus_handle = () => { const h = kit.focusHandle(); handles.push(h); return h; };
  state.shared["herdsidian.sidebar"] = { tab };
  const holder = {}, before = listHandles.length;
  const host = { cx: null, selectTab: (next) => { selected.push(next); state.shared["herdsidian.sidebar"] = { tab: next }; },
    files: () => holder.files, vault: () => vault, changes: () => holder.watch };
  during(cx, (scoped) => {
    host.cx = scoped;
    holder.watch = new ChangesWatch(host);
    holder.files = new FilesTab(host);
    holder.tab = new gitView.GitTab(host);
  });
  const run = (fn) => during(cx, fn);
  const render = (t = theme) => run((c) => holder.tab.render(t, c));
  const click = (node, event = null) => run((c) => node.onClick(event, c));
  const itemClick = (tree, key) => {
    const list = walk(tree).find((n) => handlerOf(n, "on_item_click"));
    if (!list) throw new Error("no list with on_item_click in the tree");
    run((c) => handlerOf(list, "on_item_click")(key, c));
  };
  const type = (input, text) => { input.set_value(text); run((c) => input.fire("change", {}, c)); };
  const submit = (input) => run((c) => input.fire("submit", {}, c));
  // A keystroke; true when a handler stopped its propagation. It goes to diff-view when one is drawn, else to tab-git.
  const key = (tree, keystroke) => {
    const before = stops.count;
    const node = findById(tree, "diff-view") ?? findById(tree, "tab-git") ?? walk(tree).find((n) => handlerOf(n, "on_key_down"));
    run((c) => handlerOf(node, "on_key_down")?.({ keystroke }, c));
    return stops.count > before;
  };
  // The size the root reports, in window px.
  const resize = (tree, width, height = 600) => {
    const node = findById(tree, "tab-git") ?? walk(tree).find((n) => handlerOf(n, "on_size_change"));
    run((c) => handlerOf(node, "on_size_change")({ width, height }, c));
  };
  // A drag of git-splitter from y `from` to y `to`: a press on it, three moves, a release. The move and release handlers
  // are looked up in the whole tree (window-wide ones first), because the plan does not say which element holds them.
  const drag = (tree, from, to) => {
    const splitter = findById(tree, "git-splitter");
    if (!splitter) throw new Error("no git-splitter in the tree");
    const at = (y) => ({ position: { x: 0, y }, local_position: { x: 0, y: y - from }, modifiers: {} });
    const press = handlerOf(splitter, "on_mouse_down", "left");
    const move = anywhere(tree, "on_window_mouse_move") ?? anywhere(tree, "on_mouse_move");
    const up = anywhere(tree, "on_window_mouse_up", "left") ?? anywhere(tree, "on_mouse_up", "left");
    run((c) => press?.({ button: "left", click_count: 1, ...at(from) }, c));
    for (const y of [from + (to - from) / 3, from + (2 * (to - from)) / 3, to]) run((c) => move?.({ ...at(y), pressed_button: "left" }, c));
    run((c) => up?.({ button: "left", click_count: 1, ...at(to) }, c));
  };
  const leave = () => holder.tab.left();
  // Makes the watch read again and apply the answer (its onApply hook runs), then lets the started tasks end.
  const apply = async () => { run((c) => holder.watch.refresh(c)); await settle(); };
  return { cx, host, selected, timers, handles, stops, scrolls: listHandles.slice(before), watch: holder.watch, files: holder.files,
    tab: holder.tab, render, click, itemClick, type, submit, key, resize, drag, leave, apply };
}

// Lines like "c3 <- c2 c1 | subject | Author Name <email>" to commit objects, newest first (at falls by a minute per line).
// Parents may be empty ("c1 <- | root"); the author part may be left out; the subject may hold "|".
export function commitsOf(text) {
  const base = 1700000000000;
  return text.split("\n").map((l) => l.trim()).filter(Boolean).map((line, i) => {
    const m = /^(\S+)\s*<-\s*([^|]*)\|(.*)$/.exec(line);
    if (!m) throw new Error(`commitsOf: cannot read "${line}"`);
    const cut = m[3].lastIndexOf("|");
    const subject = (cut < 0 ? m[3] : m[3].slice(0, cut)).trim();
    const who = cut < 0 ? "" : m[3].slice(cut + 1).trim();
    const name = /^(.*?)\s*(?:<([^>]*)>)?$/.exec(who);
    return { hash: m[1], parents: m[2].split(/\s+/).filter(Boolean), author: name[1] || "Test Author", email: name[2] ?? (who ? "" : "test@example.com"),
      at: base - i * 60000, subject };
  });
}
