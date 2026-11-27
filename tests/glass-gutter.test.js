// Window glass, the gutter: the strip of `work-body` around the panes. With the glass off it is "chrome";
// with the glass on it takes the sidebar sheet color, so it matches the sidebar.
// Expected values are worked out by hand: the color part is mix(chrome, accent, 0.05) and the alpha
// suffix per theme is fixed below (no call to the function under test to build an expectation).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CLEAR, mix } from "../lib/tokens.js";
import { gutterColor, gutterOf, isGlass, syncGutter, withGlass, withGutter } from "../lib/glass.js";
import { themeOf } from "./support/themes.js";

const SHEET_ALPHA = {
  carbon: "d6",
  carbon_light: "f0",
  catppuccin: "c9",
  catppuccin_light: "fa",
  midnight: "d4",
  midnight_light: "ff",
  nord: "e3",
  nord_light: "e3",
};

const SHIPPED_TEXT = readFileSync(new URL("../layouts/herdsidian.json", import.meta.url), "utf8");
const shipped = JSON.parse(SHIPPED_TEXT);
const copy = (x) => JSON.parse(JSON.stringify(x));
const PINK = "#ff00aa80";

// Find a node by id in a tree.
const find = (node, id) => {
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const hit = find(c, id);
    if (hit) return hit;
  }
  return null;
};

const pane = { header: { content: { mod: "x" } }, background: "surface" };
const paneBlock = (id) => ({ id, type: "block", content: { pane } });

// A small tree with two gutters, a pane parent without background, and a nested gutter.
const small = () => ({
  id: "root",
  type: "row",
  background: "#00000000",
  window_blur: true,
  colors: { background: CLEAR },
  children: [
    { id: "a", type: "row", background: "chrome", children: [paneBlock("a1")] },
    { id: "b", type: "column", children: [paneBlock("b1")] },
    {
      id: "c",
      type: "column",
      children: [{ id: "d", type: "row", background: "#112233ff", padding: 2, children: [paneBlock("d1")] }],
    },
  ],
});

// ---- gutterColor ----

for (const [name, alpha] of Object.entries(SHEET_ALPHA)) {
  test(`gutterColor, hs_${name}: the sidebar sheet as if the glass were on, with an opaque or clear background`, () => {
    const base = themeOf(name);
    const want = mix(base.chrome, base.accent, 0.05) + alpha;
    assert.equal(gutterColor({ ...base, background: "#101010" }), want);
    assert.equal(gutterColor({ ...base, background: CLEAR }), want);
    assert.equal(gutterColor(themeOf(name, { glass: true })), want);
  });
}

test("gutterColor does not change the theme it is given", () => {
  const t = themeOf("carbon");
  const before = copy(t);
  gutterColor(t);
  assert.deepEqual(t, before);
});

// ---- withGlass and the gutter ----

test("withGlass off sets every gutter background to chrome, a hex or chrome alike", () => {
  const tree = small();
  const off = withGlass(tree, false);
  assert.equal(find(off, "a").background, "chrome");
  assert.equal(find(off, "d").background, "chrome");
  const hexed = withGutter(shipped, PINK);
  assert.equal(find(withGlass(hexed, false), "work-body").background, "chrome");
});

test("withGlass off adds no background to a pane parent that has none", () => {
  const off = withGlass(small(), false);
  assert.equal("background" in find(off, "b"), false);
});

test("withGlass on leaves a gutter background exactly as it is", () => {
  const hexed = withGutter(shipped, PINK);
  assert.equal(find(withGlass(hexed, true), "work-body").background, PINK);
  assert.equal(find(withGlass(shipped, true), "work-body").background, "chrome");
  const tree = small();
  const on = withGlass(tree, true);
  assert.equal(find(on, "a").background, "chrome");
  assert.equal(find(on, "d").background, "#112233ff");
});

// ---- withGutter ----

test("withGutter on the shipped layout changes only work-body background", () => {
  const out = withGutter(shipped, PINK);
  assert.equal(find(out, "work-body").background, PINK);
  const expected = copy(shipped);
  find(expected, "work-body").background = PINK;
  assert.deepEqual(out, expected);
});

test("withGutter does not change its input and returns a copy", () => {
  const before = JSON.stringify(shipped);
  const out = withGutter(shipped, PINK);
  assert.equal(JSON.stringify(shipped), before);
  assert.notEqual(out, shipped);
  assert.notEqual(find(out, "work-body"), find(shipped, "work-body"));
});

test("withGutter sets every gutter, skips a pane parent without background, and handles nesting", () => {
  const tree = small();
  const before = JSON.stringify(tree);
  const out = withGutter(tree, PINK);
  assert.equal(JSON.stringify(tree), before);
  const expected = small();
  find(expected, "a").background = PINK;
  find(expected, "d").background = PINK;
  assert.deepEqual(out, expected);
  assert.equal("background" in find(out, "b"), false);
  assert.equal(out.background, "#00000000", "the root has a background but no pane child: not a gutter");
});

test("withGutter on a tree with no gutter returns an equal tree", () => {
  const tree = { id: "root", type: "row", background: "chrome", children: [{ id: "x", type: "block" }] };
  assert.deepEqual(withGutter(tree, PINK), tree);
  const noBg = { id: "root", type: "row", children: [paneBlock("p")] };
  assert.deepEqual(withGutter(noBg, PINK), noBg);
});

// ---- gutterOf ----

test("gutterOf gives the background of the first gutter in document order", () => {
  assert.equal(gutterOf(shipped), "chrome");
  assert.equal(gutterOf(withGutter(shipped, PINK)), PINK);
  assert.equal(gutterOf(small()), "chrome");
  const tree = small();
  find(tree, "a").background = "#aabbccff";
  find(tree, "d").background = "#112233ff";
  assert.equal(gutterOf(tree), "#aabbccff");
});

test("gutterOf finds a nested gutter when it is the only one", () => {
  const tree = small();
  delete find(tree, "a").background;
  assert.equal(gutterOf(tree), "#112233ff");
});

test("gutterOf gives null when there is no gutter", () => {
  assert.equal(gutterOf({ id: "root", type: "row", background: "chrome", children: [{ id: "x", type: "block" }] }), null);
  assert.equal(gutterOf({ id: "root", type: "row", children: [paneBlock("p")] }), null);
});

// ---- syncGutter ----

// Fake read and write that record their calls.
const fakes = ({ text, readError, writeError } = {}) => {
  const calls = { read: [], write: [] };
  return {
    calls,
    read: async (path) => {
      calls.read.push(path);
      if (readError) throw readError;
      return text === undefined ? null : text;
    },
    write: async (path, newText, expected) => {
      calls.write.push([path, newText, expected]);
      if (writeError) throw writeError;
    },
  };
};

const PATH = "/fake/herdsidian.json";

test("syncGutter reads the path exactly once", async () => {
  const f = fakes({ text: SHIPPED_TEXT });
  await syncGutter({ path: PATH, color: PINK, read: f.read, write: f.write });
  assert.deepEqual(f.calls.read, [PATH]);
});

test("syncGutter writes once when the gutter differs, with the exact read text as expected", async () => {
  const f = fakes({ text: SHIPPED_TEXT });
  const done = await syncGutter({ path: PATH, color: PINK, read: f.read, write: f.write });
  assert.equal(done, true);
  assert.equal(f.calls.write.length, 1);
  const [path, newText, expected] = f.calls.write[0];
  assert.equal(path, PATH);
  assert.equal(expected, SHIPPED_TEXT);
  assert.equal(newText, JSON.stringify(withGutter(shipped, PINK), null, 2) + "\n");
});

test("syncGutter writes a layout whose gutter is the color and everything else is as read", async () => {
  const f = fakes({ text: SHIPPED_TEXT });
  await syncGutter({ path: PATH, color: PINK, read: f.read, write: f.write });
  const written = JSON.parse(f.calls.write[0][1]);
  const expected = copy(shipped);
  find(expected, "work-body").background = PINK;
  assert.deepEqual(written, expected);
  assert.equal(find(written, "work-body").background, PINK);
  assert.equal(written.terminal_opacity, 0);
  assert.equal(find(written, "main").content.pane.background, "surface");
  assert.equal(written.background, "#00000000");
});

test("syncGutter writes every gutter of a layout with two", async () => {
  const tree = small();
  const text = JSON.stringify(tree, null, 2) + "\n";
  const f = fakes({ text });
  assert.equal(await syncGutter({ path: PATH, color: PINK, read: f.read, write: f.write }), true);
  const written = JSON.parse(f.calls.write[0][1]);
  const expected = small();
  find(expected, "a").background = PINK;
  find(expected, "d").background = PINK;
  assert.deepEqual(written, expected);
});

test("syncGutter does not write when read gives null", async () => {
  const f = fakes();
  assert.equal(await syncGutter({ path: PATH, color: PINK, read: f.read, write: f.write }), false);
  assert.equal(f.calls.write.length, 0);
});

test("syncGutter does not write, and does not reject, when read rejects", async () => {
  const f = fakes({ readError: new Error("EACCES") });
  assert.equal(await syncGutter({ path: PATH, color: PINK, read: f.read, write: f.write }), false);
  assert.equal(f.calls.write.length, 0);
});

test("syncGutter does not write when the text is not valid JSON", async () => {
  const f = fakes({ text: "{ not json" });
  assert.equal(await syncGutter({ path: PATH, color: PINK, read: f.read, write: f.write }), false);
  assert.equal(f.calls.write.length, 0);
});

test("syncGutter does not write a layout that has no window_blur key", async () => {
  const tree = copy(shipped);
  delete tree.window_blur;
  const f = fakes({ text: JSON.stringify(tree, null, 2) + "\n" });
  assert.equal(await syncGutter({ path: PATH, color: PINK, read: f.read, write: f.write }), false);
  assert.equal(f.calls.write.length, 0);
});

test("syncGutter does not write when the glass is off, even if the gutter differs", async () => {
  const off = withGlass(shipped, false);
  assert.equal(isGlass(off), false);
  assert.notEqual(gutterOf(off), PINK);
  const f = fakes({ text: JSON.stringify(off, null, 2) + "\n" });
  assert.equal(await syncGutter({ path: PATH, color: PINK, read: f.read, write: f.write }), false);
  assert.equal(f.calls.write.length, 0);
});

test("syncGutter does not write when there is no gutter node", async () => {
  const tree = copy(shipped);
  delete find(tree, "work-body").background;
  const f = fakes({ text: JSON.stringify(tree, null, 2) + "\n" });
  assert.equal(await syncGutter({ path: PATH, color: PINK, read: f.read, write: f.write }), false);
  assert.equal(f.calls.write.length, 0);
});

test("syncGutter does not write when every gutter already has the color", async () => {
  const tree = withGutter(shipped, PINK);
  const f = fakes({ text: JSON.stringify(tree, null, 2) + "\n" });
  assert.equal(await syncGutter({ path: PATH, color: PINK, read: f.read, write: f.write }), false);
  assert.equal(f.calls.write.length, 0);
});

test("syncGutter writes when only one of two gutters has the color", async () => {
  const tree = small();
  find(tree, "a").background = PINK;
  const f = fakes({ text: JSON.stringify(tree, null, 2) + "\n" });
  assert.equal(await syncGutter({ path: PATH, color: PINK, read: f.read, write: f.write }), true);
  assert.equal(f.calls.write.length, 1);
});

test("syncGutter resolves false, and does not reject, when write rejects", async () => {
  const f = fakes({ text: SHIPPED_TEXT, writeError: new Error("changed in between") });
  const done = await syncGutter({ path: PATH, color: PINK, read: f.read, write: f.write });
  assert.equal(done, false);
  assert.equal(f.calls.write.length, 1);
});

// ---- round trip ----

test("round trip: gutter color, glass off, glass on gives the shipped layout back exactly", () => {
  const colored = withGutter(shipped, "#151920d6");
  assert.equal(find(colored, "work-body").background, "#151920d6");
  const off = withGlass(colored, false);
  assert.equal(find(off, "work-body").background, "chrome");
  assert.deepEqual(withGlass(off, true), shipped);
  assert.equal(JSON.stringify(withGlass(off, true)), JSON.stringify(shipped));
});
