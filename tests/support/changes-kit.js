// The test kit of the Changes V2 tests: the runtime stubs the diff view needs, a fake git and a host built the way
// main.js builds it. Import it before any mod: it sets the stubs, then loads the two tabs.
import { state, fakeCx, findById, walk, element, settle } from "./mod-stubs.js";
import { during } from "./live-cx.js";
import { themeOf } from "./themes.js";

export { state, fakeCx, findById, walk, element, settle, during, themeOf };

// What the stubs answer. A test sets these fields; reset() puts them back.
export const world = { spaces: [], panes: [], focused: null, agents: [], home: "/nowhere", zoom: 1, watchers: [] };
const fresh = () => ({ spaces: [], panes: [], focused: null, agents: [], home: "/nowhere", zoom: 1, watchers: [] });

const { herdr, "gpui-base": base } = globalThis.__herdsidianStubs;
herdr.spaces = () => world.spaces;
herdr.panes = () => world.panes;
herdr.focused = () => world.focused;
herdr.agents = () => world.agents;
herdr.home = () => world.home;
herdr.settings = () => ({ zoom: world.zoom });
// mod-stubs drops the options argument of readTextFile; a remote read passes { on }.
herdr.readTextFile = (path, opts) => state.readTextFile(path, opts);
herdr.watchFolder = (root) => new Promise((resolve, reject) => { world.watchers.push({ root, resolve, reject }); });

// The setters a test can call instead of writing to `world`.
export const spaces = (list) => { world.spaces = list; };
export const panes = (list) => { world.panes = list; };
export const focused = (value) => { world.focused = value; };
export const agents = (list) => { world.agents = list; };
export const home = (path) => { world.home = path; };
export const watchFolder = (list) => { world.watchers = list; };
export const settings = ({ zoom }) => { world.zoom = zoom; };

// A scroll handle that records scroll_to_item, and a focus handle that records focus().
export const scrollHandle = () => {
  const handle = { scrolls: [], scroll_to_item: (...args) => { handle.scrolls.push(args); }, release: () => true };
  return handle;
};
export const focusHandle = () => {
  const handle = { focuses: 0, focus: () => { handle.focuses++; }, release: () => true };
  return handle;
};

// A virtual list keeps its 5 arguments; rowsOf() runs its renderer.
base.v_virtual_list = (id, count, sizes, key, render) => element("vlist", { id, count, sizes, key, render });
base.Scrollbar = { new: (id) => element("scrollbar", id), horizontal: (id) => element("scrollbar", id), vertical: (id) => element("scrollbar", id) };
base.ScrollHandle = { new: scrollHandle };

// The elements the renderer of the list builds for a range ({ start, end } or [start, end]).
export function rowsOf(tree, range) {
  const list = walk(tree).find((n) => n.kind === "vlist");
  if (!list) throw new Error("no vlist in the tree");
  const { start, end } = Array.isArray(range) ? { start: range[0], end: range[1] } : range;
  return list.arg.render({ start, end }, fakeCx());
}

// A git that answers by its arguments and records every call as [cmd, args, opts].
// status, numstat and each patch may be a function, so a later refresh can answer differently.
// fail: a kind ("top", "status", "numstat", "patch") or a list of them. session(args, opts): the /bin/sh session call.
export function fakeGit({ top = "/work/repo", status = "## main\0", numstat = "", patches = {}, fail = null, session = null } = {}) {
  const calls = [];
  const out = (value) => (typeof value === "function" ? value() : value);
  const done = (stdout) => ({ stdout, stderr: "", code: 0 });
  state.exec = async (cmd, args, opts = {}) => {
    calls.push([cmd, args, opts]);
    // Plain "sh" is FilesTab's directory listing: it goes to the default answer below.
    if (cmd === "/bin/sh") {
      const reply = session ? await session(args, opts) : "";
      return typeof reply === "string" ? done(reply) : { stdout: "", stderr: "", code: 0, ...reply };
    }
    if (cmd !== "git") return done("");
    const kind = args.includes("rev-parse") ? "top" : args.includes("status") ? "status" : args.includes("--numstat") ? "numstat" : args.includes("-U3") ? "patch" : "other";
    if (fail === kind || (Array.isArray(fail) && fail.includes(kind))) return { stdout: "", stderr: `fake ${kind} failure`, code: 128 };
    if (kind === "top") return done(`${top}\n`);
    if (kind === "status") return done(out(status));
    if (kind === "numstat") return done(out(numstat));
    if (kind === "patch") return done(out(patches[args.at(-1)] ?? ""));
    return done("");
  };
  const count = (kind) => calls.filter(([cmd, args]) => cmd === "git" && args.includes(kind)).length;
  return { calls, count };
}

// readTextFile as Herdr answers: null for a missing file, a rejection for a marked one.
// Returns { calls }: every read as [path, opts].
export function fakeFiles(files = {}, { big = [], binary = [] } = {}) {
  const calls = [];
  state.readTextFile = async (path, opts) => {
    calls.push([path, opts]);
    if (big.includes(path)) throw new Error("Text file exceeds 1 MiB");
    if (binary.includes(path)) throw new Error("stream did not contain valid UTF-8");
    return path in files ? files[path] : null;
  };
  return { calls };
}

// Real colors need no file read: the default theme of mount().
const T = { foreground: "#eeeeee", background: "#111111", chrome: "#222222", canvas: "#333333", raised: "#2a2a2a", accent: "#ff00aa",
  muted: "#999999", dim: "#555555", hover: "#444444", blocked: "#ffaa00", ansi1: "#ff0001", ansi2: "#00ff02" };

// Back to the defaults; call it in beforeEach.
export function reset() {
  Object.assign(world, fresh());
  state.shared = {}; state.files = {}; state.layout = { id: "root", children: [] };
  state.exec = async () => ({ stdout: "", stderr: "", code: 0 });
  fakeFiles();
}

const { ChangesTab, ChangesWatch } = await import("../../mods/herdsidian/changes-view.js");
const { FilesTab } = await import("../../mods/herdsidian/files-view.js");

// The host as main.js builds it: the watch and the Files tab during init's cx, the Changes tab after it.
export function mount({ theme = T, vault = null } = {}) {
  const cx = fakeCx(), selected = [], timers = [], handles = [], stops = { count: 0 };
  cx.timer.every = (ms, fn) => { timers.push([ms, fn]); };
  cx.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 100)));
  cx.stop_propagation = () => { stops.count++; };
  cx.focus_handle = () => { const h = focusHandle(); handles.push(h); return h; };
  const holder = {};
  const host = { cx: null, selectTab: (tab) => { selected.push(tab); state.shared["herdsidian.sidebar"] = { tab }; },
    files: () => holder.files, vault: () => vault, changes: () => holder.watch };
  during(cx, (scoped) => { host.cx = scoped; holder.watch = new ChangesWatch(host); holder.files = new FilesTab(host); });
  holder.tab = new ChangesTab(host);
  const render = (t = theme) => during(cx, (c) => holder.tab.render(t, c));
  const click = (node) => during(cx, (c) => node.onClick(null, c));
  const handler = (node, name) => node?.calls.find(([n]) => n === name)?.[1][0];
  // A keystroke on diff-view; true when the view stopped its propagation.
  const key = (tree, keystroke) => {
    const before = stops.count;
    during(cx, (c) => handler(findById(tree, "diff-view"), "on_key_down")?.({ keystroke }, c));
    return stops.count > before;
  };
  // The width the root reports, in window px.
  const resize = (tree, width, height = 600) => {
    const node = findById(tree, "tab-changes") ?? walk(tree).find((n) => handler(n, "on_size_change"));
    during(cx, (c) => handler(node, "on_size_change")({ width, height }, c));
  };
  // A wheel over the code area.
  const wheel = (tree, event) => during(cx, (c) => handler(findById(tree, "diff-code"), "on_scroll_wheel")(event, c));
  return { cx, host, selected, timers, handles, stops, watch: holder.watch, files: holder.files, tab: holder.tab, render, click, key, resize, wheel };
}

export const texts = (node) => walk(node).flatMap((n) => n.kids.filter((k) => typeof k === "string"));
export const call = (node, name) => node.calls.find(([n]) => n === name);
export const has = (node, name, ...args) => node.calls.some(([n, a]) => n === name && JSON.stringify(a) === JSON.stringify(args));
