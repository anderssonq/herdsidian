// Loads a real mod in Node: stands in for the "herdr", "gpui-kit" and "gpui-base" runtimes and
// records the element tree render() builds, so a test can read it and press its buttons.
import { registerHooks } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RUNTIMES = new Set(["herdr", "gpui-kit", "gpui-base"]);
const PREFIX = "herdsidian-stub:";
const mods = new URL("../../mods/", import.meta.url).pathname;

// Every name the mods import from a runtime, read from their source so new imports just work.
function importedNames() {
  const names = new Map([...RUNTIMES].map((r) => [r, new Set()]));
  const pattern = /import\s*\{([^}]*)\}\s*from\s*"(herdr|gpui-kit|gpui-base)"/g;
  for (const mod of readdirSync(mods)) {
    const dir = join(mods, mod);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
      for (const [, list, runtime] of readFileSync(join(dir, file), "utf8").matchAll(pattern)) {
        for (const name of list.split(",").map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean)) names.get(runtime).add(name);
      }
    }
  }
  return names;
}

// An object that accepts any property read or call, for runtime parts a test does not look at.
const anything = () => {
  const value = new Proxy(function () {}, {
    get: (_t, key) => (key === Symbol.toPrimitive ? () => "" : key === "then" ? undefined : value),
    apply: () => value,
  });
  return value;
};

// A recorded element. Every builder method returns the element and is kept in `calls` as
// [name, args]; `when` runs its branch.
export function element(kind, arg) {
  const node = { kind, arg, nodeId: null, onClick: null, kids: [], calls: [] };
  const el = new Proxy(node, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key === "symbol" || key === "then") return undefined;
      return (...args) => {
        target.calls.push([key, args]);
        if (key === "id") target.nodeId = args[0];
        else if (key === "on_click") target.onClick = args[0];
        else if (key === "child") target.kids.push(args[0]);
        else if (key === "children") target.kids.push(...args[0]);
        else if (key === "when" && args[0]) return args[1](el);
        return el;
      };
    },
  });
  return el;
}

export const walk = (node, seen = []) => {
  if (!node || typeof node !== "object" || !("kids" in node)) return seen;
  seen.push(node);
  for (const child of node.kids) walk(child, seen);
  return seen;
};

export const findById = (tree, id) => walk(tree).find((n) => n.nodeId === id) ?? null;
export const svgPaths = (tree) => walk(tree).filter((n) => n.kind === "svg").map((n) => n.arg);

// The default hooks. exec answers an empty success. writeTextFile writes only while the file still
// holds `expected` (null for a file that does not exist yet), so a stale save is refused.
async function stubExec() { return { stdout: "", stderr: "", code: 0 }; }
async function readFromFiles(path) { if (path in state.files) return state.files[path]; throw new Error(`no file ${path}`); }
async function compareAndSwap(path, text, expected) {
  const current = path in state.files ? state.files[path] : null;
  if (current !== expected) throw new Error(`stale snapshot ${path}`);
  state.files[path] = text;
}

// What a test sets and reads: `shared` values, the note text, and every run() and notify() call.
// `props` backs props(), `viewport` (null: none) backs viewport_size(), and `overlays` and `closed` record
// openOverlay() and closeOverlay(). exec, readTextFile and writeTextFile are hooks a test can replace.
export const state = { shared: {}, runs: [], toasts: [], layout: { id: "root", children: [] }, commands: [], files: {},
  props: {}, viewport: null, keys: {}, overlays: [], closed: [], exec: stubExec, readTextFile: readFromFiles, writeTextFile: compareAndSwap };

const never = () => new Promise(() => {});
const color = new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : "#808080") });

const herdr = {
  theme: () => color,
  shared: (key) => state.shared[key],
  setShared: (key, value) => { state.shared[key] = value; },
  layout: () => state.layout,
  run: (name, args) => { state.runs.push([name, args]); },
  notify: (toast) => { state.toasts.push(toast); },
  nextCommand: () => (state.commands.length ? Promise.resolve(state.commands.shift()) : never()),
  readTextFile: (path) => state.readTextFile(path),
  writeTextFile: (path, text, expected) => state.writeTextFile(path, text, expected),
  exec: (...args) => state.exec(...args),
  openOverlay: (spec) => { const id = `overlay-${state.overlays.length + 1}`; state.overlays.push({ id, spec }); return id; },
  closeOverlay: (id) => { state.closed.push(id); },
  watchFolder: never,
  spaces: () => [],
  panes: () => [],
  agents: () => [],
  keys: () => state.keys,
  focused: () => null,
  props: () => state.props,
  window: () => ({ platform: "macos", titlebar: "none", fullscreen: false }),
  settings: () => ({ zoom: 1 }),
};

// The state behind an Input or an Editor: its value, the handlers a mod subscribes, and the calls made on it.
function valueState(value) {
  const handlers = new Map(), calls = [];
  return {
    calls,
    value: () => value,
    set_value: (next) => { value = next; calls.push(["set_value", next]); },
    on: (name, fn) => { handlers.set(name, fn); },
    fire: (name, event, cx) => handlers.get(name)?.(event, cx),
    focus: () => { calls.push(["focus"]); },
    set_selected_range: (...args) => { calls.push(["set_selected_range", ...args]); },
    release: () => { calls.push(["release"]); },
  };
}

const stubs = {
  herdr,
  "gpui-kit": { View: class {}, div: () => element("div"), svg: (path) => element("svg", path) },
  "gpui-base": {
    h_flex: () => element("div"), v_flex: () => element("div"),
    InputState: { new: (opts = {}) => valueState(opts.value ?? "") },
    EditorState: { new: (opts = {}) => valueState(opts.value ?? "") },
    Input: { new: (model) => element("input", model) },
    Editor: { new: (model) => element("editor", model) },
    TextView: { markdown: (id, text) => element("text-view", { id, markdown: text }) },
  },
};

globalThis.__herdsidianStubs = stubs;
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => store.get(key) ?? null,
  setItem: (key, value) => { store.set(key, String(value)); },
  removeItem: (key) => { store.delete(key); },
};

const names = importedNames();
registerHooks({
  resolve(specifier, context, next) {
    return RUNTIMES.has(specifier) ? { url: PREFIX + specifier, shortCircuit: true } : next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith(PREFIX)) return next(url, context);
    const runtime = url.slice(PREFIX.length);
    const lines = [...names.get(runtime)].map((n) => {
      const local = `stub_${n}`;
      return `const ${local} = globalThis.__herdsidianStubs[${JSON.stringify(runtime)}][${JSON.stringify(n)}] ?? globalThis.__herdsidianAnything();\nexport { ${local} as ${n} };`;
    });
    return { format: "module", source: lines.join("\n"), shortCircuit: true };
  },
});
globalThis.__herdsidianAnything = anything;
// gpui's global, which lib/ui.js paints through. viewport_size() answers from state.viewport once a test sets it.
const anyWindow = anything();
globalThis.window = new Proxy(anyWindow, {
  get: (_t, key) => (key === "viewport_size" && state.viewport ? () => state.viewport : anyWindow[key]),
});

// A stand-in for gpui's context: spawn runs its task; the clipboard and redraws are recorded.
// Like sleep, timer.after and timer.every never fire by default; a test can replace them.
export function fakeCx() {
  const cx = {
    clipboard: [],
    notify() {},
    stop_propagation() {},
    write_to_clipboard(text) { cx.clipboard.push(text); },
    focus_handle: () => anything(),
    timer: { after() {}, every() {} },
    sleep: never,
    spawn(task) { return Promise.resolve().then(() => task(cx)).catch(() => {}); },
  };
  return cx;
}

// Runs the right-mouse-down handler that a builder set on `node`, as a right click would.
export function rightClick(node, event, cx) {
  const [, [, handler]] = node.calls.find(([name, args]) => name === "on_mouse_down" && args[0] === "right");
  return handler(event, cx);
}

// Lets started tasks finish their awaited stubs.
export const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
