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

// What a test sets and reads: `shared` values, the note text, and every run() and notify() call.
export const state = { shared: {}, runs: [], toasts: [], layout: { id: "root", children: [] }, commands: [], files: {} };

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
  readTextFile: async (path) => { if (path in state.files) return state.files[path]; throw new Error(`no file ${path}`); },
  exec: async () => ({ stdout: "", stderr: "", code: 0 }),
  watchFolder: never,
  spaces: () => [],
  panes: () => [],
  agents: () => [],
  keys: () => ({}),
  focused: () => null,
  props: () => ({}),
  window: () => ({ platform: "macos", titlebar: "none", fullscreen: false }),
  settings: () => ({ zoom: 1 }),
};

const stubs = {
  herdr,
  "gpui-kit": { View: class {}, div: () => element("div"), svg: (path) => element("svg", path) },
  "gpui-base": { h_flex: () => element("div"), v_flex: () => element("div") },
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
globalThis.window = anything(); // gpui's global, which lib/ui.js paints through

// A stand-in for gpui's context: spawn runs its task; the clipboard and redraws are recorded.
export function fakeCx() {
  const cx = {
    clipboard: [],
    notify() {},
    stop_propagation() {},
    write_to_clipboard(text) { cx.clipboard.push(text); },
    sleep: never,
    spawn(task) { return Promise.resolve().then(() => task(cx)).catch(() => {}); },
  };
  return cx;
}

// Lets started tasks finish their awaited stubs.
export const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
