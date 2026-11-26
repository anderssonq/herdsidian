// The test kit of the sidebar motion and layout tests: the resizable stubs, a mounted Notes pane and
// herdsidian-tabs, a cx that can sleep, and helpers that press the handlers a recorded tree holds.
// Import it before any mod: it sets the stubs, then loads the two mods.
import { state, fakeCx, findById, walk, element, settle } from "./mod-stubs.js";

export { state, fakeCx, findById, walk, element, settle };

export const STORE = "herdsidian.sidebar";
export const LAYOUT_STORE = "herdsidian.sidebar-layout";
export const TABS = ["notes", "files", "changes", "git"];

const { herdr, "gpui-base": base } = globalThis.__herdsidianStubs;

// A resizable group and its panels, recorded like any element; the group has its id set.
base.v_resizable = (id) => element("resizable", id).id(id);
base.resizable_panel = () => element("resizable-panel");

// What herdr.spaces() answers for herdsidian-tabs: one space of four tabs until mountTabs sets another.
const tabsOf = (count) => Array.from({ length: count }, (_, n) => ({ id: `t${n + 1}`, index: n + 1, name: `tab${n + 1}`, active: n === 0 }));
let spaceList = [{ id: "s1", name: "alpha", active: true, tabs: tabsOf(4) }];
herdr.spaces = () => spaceList;

const { default: Notes } = await import("../../mods/herdsidian/main.js");
const { default: Tabs } = await import("../../mods/herdsidian-tabs/main.js");

// A fakeCx whose sleep resolves, for a test of the deferred re-render or the store fix.
export function cxWithSleep() {
  const cx = fakeCx();
  cx.sleep = () => Promise.resolve();
  return cx;
}

// The Notes pane as main.js builds it: the vault, the stores and the herdsidian block of the layout, then init.
// tab: the stored top tab. layout: the value of the layout store (raw). files: note texts by vault path.
export async function mountNotes({ width = 380, tab, layout, files = {}, vault = "/vault/my notes" } = {}) {
  state.shared = {}; state.runs = []; state.toasts = []; state.commands = []; state.files = { ...files };
  state.layout = { id: "root", children: [{ id: "herdsidian", size: { px: width } }] };
  localStorage.setItem("vault", vault);
  if (tab !== undefined) state.shared[STORE] = { tab };
  if (layout !== undefined) state.shared[LAYOUT_STORE] = layout;
  const view = new Notes(), cx = fakeCx();
  view.init({}, cx);
  await settle();
  return { view, cx, tree: view.render(cx) };
}

// herdsidian-tabs for one space: ids t1..tN (the first active). spaces replaces the whole list.
export function mountTabs({ count = 4, spaces } = {}) {
  state.shared = {};
  spaceList = spaces ?? [{ id: "s1", name: "alpha", active: true, tabs: tabsOf(count) }];
  const view = new Tabs(), cx = fakeCx();
  view.init({}, cx);
  return { view, cx, tree: view.render(cx) };
}

// The handler a builder set on a node. With a button, the one of on_mouse_down("right", fn); with none, the first argument.
export function handler(node, name, button) {
  const found = node?.calls.find(([n, args]) => n === name && (button === undefined || args[0] === button));
  if (!found) return undefined;
  return button === undefined ? found[1][0] : found[1][1];
}

// A left press, a move and a release on a node.
export const press = (node, e, cx) => (handler(node, "on_mouse_down", "left") ?? handler(node, "on_mouse_down"))?.(e, cx);
export const move = (node, e, cx) => handler(node, "on_mouse_move")?.(e, cx);
export const release = (node, e, cx) => (handler(node, "on_mouse_up", "left") ?? handler(node, "on_mouse_up"))?.(e, cx);

// One click as GPUI delivers it to one element: down, up, then on_click.
export function click(node, cx, e = {}) {
  press(node, e, cx);
  release(node, e, cx);
  return node.onClick?.(e, cx);
}

// The motion argument of transition(prop, motion), or undefined when the node has none for that prop.
export const transitionOf = (node, prop) => node?.calls.find(([n, args]) => n === "transition" && args[0] === prop)?.[1][1];

// The first argument of the last call named `name` (a style such as "left" or "opacity"), or undefined.
export const styleOf = (node, name) => node?.calls.findLast(([n]) => n === name)?.[1][0];

// Types a name in the prompt and submits it. Returns what the submit handler returns.
export function submitName(view, text, cx) {
  view.actions.nameInput.set_value(text);
  return view.actions.nameInput.fire("submit", null, cx);
}
