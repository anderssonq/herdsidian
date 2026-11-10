// Spaces "quiet rows" (F3): git text in the tooltip, pills, key cap on every row, blocked dot, count.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, element, walk } from "./support/mod-stubs.js";

const stubs = globalThis.__herdsidianStubs;
stubs["gpui-kit"].div = () => element("div");
stubs["gpui-kit"].svg = (path) => element("svg");
stubs["gpui-base"].h_flex = () => element("div");
stubs["gpui-base"].v_flex = () => element("div");
stubs.herdr.spaces = () => SPACES; // the mod captures these at import, so set before it loads
stubs.herdr.panes = () => [];
// Every theme key is "#808080" except two names a stored space color could wrongly hold.
stubs.herdr.theme = () => new Proxy({}, { get: (_t, key) => (key === "then" || key === "nope" || key === "#abc" ? undefined : "#808080") });

const { default: Spaces, spaceTip } = await import("../mods/guide-spaces/main.js");

const call = (node, name) => node.calls.find(([n]) => n === name)?.[1];
const byId = (tree, id) => walk(tree).find((n) => call(n, "id")?.[0] === id);
const texts = (node) => walk(node).flatMap((n) => n.kids.filter((c) => typeof c === "string"));
const git = (over = {}) => ({ name: "herdr", branch: "spike", ahead: 0, behind: 0, repo: "[null,\"/r/.git\"]", linked: false, ...over });

const SPACES = [
  { id: "a", name: "alpha", folder: "/r/a", tabs: [], status: "idle" },
  { id: "b", name: "beta", folder: "/r/b", tabs: [], status: "blocked" },
];

beforeEach(() => {
  state.shared = {};
});

const mount = (gits = {}) => {
  const view = new Spaces(), cx = fakeCx();
  cx.timer = { every() {} };
  view.init({}, cx);
  for (const [folder, info] of Object.entries(gits)) view.git[JSON.stringify([null, folder])] = info;
  return { view, cx };
};
const row = (view, cx, id) => byId(view.render(cx), `space-${id}`);

test("git text is in the tooltip, not in the row", () => {
  const { view, cx } = mount({ "/r/a": git({ ahead: 2, behind: 1 }) });
  const a = row(view, cx, "a");
  assert.equal(call(a, "tooltip")[0], "herdr · spike · ↑2 ↓1 · ⌃1");
  assert.ok(!texts(a).some((s) => s.includes("spike") || s.includes("herdr")));
});

test("spaceTip leaves out what does not apply", () => {
  assert.equal(spaceTip(git({ name: "alpha" }), { tree: null, name: "Alpha", hint: "" }), "spike");
  assert.equal(spaceTip(git(), { tree: "└─", name: "x", hint: "⌃2" }), "spike · ⌃2");
  assert.equal(spaceTip(git({ branch: null, behind: 3 }), { tree: null, name: "x", hint: "" }), "herdr · detached · ↓3");
  assert.equal(spaceTip(null, { tree: null, name: "x", hint: "⌃3" }), "⌃3");
  assert.equal(spaceTip(null, { tree: null, name: "x", hint: "" }), "");
});

test("ahead and behind pills appear only above zero", () => {
  const { view, cx } = mount({ "/r/a": git({ ahead: 2 }), "/r/b": git({ behind: 4 }) });
  assert.deepEqual(texts(row(view, cx, "a")).filter((s) => /[↑↓]/.test(s)), ["↑2"]);
  assert.deepEqual(texts(row(view, cx, "b")).filter((s) => /[↑↓]/.test(s)), ["↓4"]);
  const none = mount({ "/r/a": git(), "/r/b": null });
  assert.deepEqual(texts(row(none.view, none.cx, "a")).filter((s) => /[↑↓]/.test(s)), []);
});

test("with key hints on the key cap shows on every row of the first nine, with no hover, and not on the tenth", () => {
  const { view, cx } = mount();
  state.shared["herdsidian.settings"] = { keyHints: "always" };
  const cap = (id, n) => texts(row(view, cx, id)).includes("⌃" + n);
  assert.equal(cap("a", 1), true);
  assert.equal(cap("b", 2), true);

  const extra = Array.from({ length: 8 }, (_, k) => ({ id: `x${k}`, name: `extra${k}`, folder: `/r/x${k}`, tabs: [], status: "idle" }));
  SPACES.push(...extra);
  for (const s of extra) view.shown.add(s.id); // new spaces stay hidden until their git is read
  try {
    assert.equal(cap("x6", 9), true); // the ninth space (index 8)
    const tenth = texts(row(view, cx, "x7"));
    assert.ok(!tenth.some((s) => s.startsWith("⌃")));
  } finally {
    SPACES.length = 2;
  }

  state.shared["herdsidian.settings"] = { keyHints: false };
  assert.equal(cap("a", 1), false);
  assert.equal(cap("b", 2), false);
  assert.equal(call(row(view, cx, "a"), "tooltip"), undefined);
});

test("the key cap, both pills and the blocked dot show together on one row with no hover", () => {
  const { view, cx } = mount({ "/r/b": git({ ahead: 3, behind: 1 }) });
  state.shared["herdsidian.settings"] = { keyHints: "always" };
  const dot = (id) => walk(row(view, cx, id)).some((n) => call(n, "size")?.[0] === 6 && call(n, "bg"));
  const arrows = (id) => texts(row(view, cx, id)).filter((s) => /[↑↓]/.test(s));
  assert.deepEqual(arrows("b"), ["↑3", "↓1"]);
  assert.ok(texts(row(view, cx, "b")).includes("⌃2"));
  assert.equal(dot("b"), true);
  assert.equal(dot("a"), false); // the idle row has no dot, so the check is not vacuous
});

test("with key hints off the pills show with no hover and no key cap", () => {
  state.shared["herdsidian.settings"] = { keyHints: false };
  const { view, cx } = mount({ "/r/b": git({ ahead: 3 }) });
  const shown = texts(row(view, cx, "b"));
  assert.ok(shown.includes("↑3"));
  assert.ok(!shown.includes("⌃2"));
});

test("a stored space color that is unknown or short hex falls back to the accent", () => {
  const avatar = (id) => walk(row(view, cx, id)).find((n) => call(n, "font_bold"));
  const { view, cx } = mount();
  state.shared["space.colors"] = { a: "nope", b: "#abc" };
  assert.equal(call(avatar("a"), "bg")[0], "#80808033");
  assert.equal(call(avatar("b"), "bg")[0], "#80808033");
  state.shared["space.colors"] = { a: "ansi6", b: "#112233" };
  assert.equal(call(avatar("a"), "bg")[0], "#22a99a33");
  assert.equal(call(avatar("b"), "bg")[0], "#11223333");
});

test("a blocked space shows a 6 px dot, others do not", () => {
  const { view, cx } = mount();
  const dot = (id) => walk(row(view, cx, id)).some((n) => call(n, "size")?.[0] === 6 && call(n, "bg"));
  assert.equal(dot("a"), false);
  assert.equal(dot("b"), true);
});

test("the header shows the number of spaces, not the key hint", () => {
  const { view, cx } = mount();
  const tree = view.render(cx);
  assert.deepEqual(texts(byId(tree, "spaces-count")), ["2"]);
  assert.ok(!texts(tree).some((s) => s.includes("1–9")));
  assert.match(call(byId(tree, "spaces-fold"), "tooltip")[0], /1–9/);
});
