// The toolbar keeps the layout file's gutter in step with the theme while the window glass is on.
// The mounted toolbar (herdsidian-tabs) with a theme the test changes, a layout file in the fake disk and
// a cx whose sleep ends at once.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./support/mod-stubs.js";
import { CLEAR } from "../lib/tokens.js";
import { themeOf } from "./support/themes.js";

// The mod captures the stubs when the kit loads it, so theme() and appHome() read variables set first.
let current = themeOf("carbon");
globalThis.__herdsidianStubs.herdr.theme = () => current;
globalThis.__herdsidianStubs.herdr.appHome = () => "/app";
const { state, mountTabs, settle } = await import("./support/sidebar-kit.js");

const PATH = "/app/layouts/herdsidian.json";
const shipped = readFileSync(new URL("../layouts/herdsidian.json", import.meta.url), "utf8");
const body = (tree) => tree.children.find((c) => c.id === "work").children.find((c) => c.id === "work-body");
const gutter = (text) => body(JSON.parse(text)).background;
// The sidebar sheet with the glass on, by hand: chrome + 5 % accent, then the theme's opacity level.
const CARBON = "#15191dd6"; // #121212 toward #4c9df3 by 5 %, at 84 %
const NORD = "#2f3642e3"; // #2a2f3a toward #88c0d0 by 5 %, at 89 %

let writes;
const diskWrite = state.writeTextFile, diskRead = state.readTextFile;
function mount(theme, text = shipped) {
  current = theme;
  const m = mountTabs();
  state.shared.layout = "herdsidian";
  state.files = { [PATH]: text };
  writes = [];
  state.readTextFile = diskRead;
  state.writeTextFile = async (...args) => { await diskWrite(...args); writes.push(args); };
  m.cx.sleep = async () => {};
  return m;
}

beforeEach(() => { state.files = {}; });

test("glass on: the first frame writes the theme's sheet into the gutter, once", async () => {
  const { view, cx } = mount(themeOf("carbon", { glass: true }));
  view.render(cx);
  await settle();
  assert.equal(gutter(shipped), "chrome");
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], PATH);
  assert.equal(writes[0][2], shipped, "the write is checked against the text that was read");
  assert.equal(gutter(state.files[PATH]), CARBON);
  view.render(cx);
  view.render(cx);
  await settle();
  assert.equal(writes.length, 1, "more frames of the same theme write nothing");
});

test("glass on: a theme change rewrites the gutter with the new theme's sheet", async () => {
  const { view, cx } = mount(themeOf("carbon", { glass: true }));
  view.render(cx);
  await settle();
  current = themeOf("nord", { glass: true });
  view.render(cx);
  await settle();
  assert.equal(writes.length, 2);
  assert.equal(gutter(state.files[PATH]), NORD);
});

test("glass on: only the gutter changes in the layout file", async () => {
  const { view, cx } = mount(themeOf("carbon", { glass: true }));
  view.render(cx);
  await settle();
  const before = JSON.parse(shipped), after = JSON.parse(state.files[PATH]);
  body(after).background = body(before).background;
  assert.deepEqual(after, before);
});

test("glass on: themes that change while the first one settles end in one write, of the last theme", async () => {
  const { view, cx } = mount(themeOf("carbon", { glass: true }));
  const waits = [];
  cx.sleep = () => new Promise((resolve) => waits.push(resolve));
  view.render(cx);
  await settle();
  assert.equal(waits.length, 1, "the task waits before it writes");
  current = themeOf("catppuccin", { glass: true });
  view.render(cx);
  current = themeOf("nord", { glass: true });
  view.render(cx);
  await settle();
  assert.equal(waits.length, 1, "still one task");
  waits.shift()();
  await settle();
  assert.equal(writes.length, 0, "the theme changed while it waited: it waits again");
  waits.shift()();
  await settle();
  assert.equal(writes.length, 1);
  assert.equal(gutter(state.files[PATH]), NORD);
});

test("glass off: the toolbar never reads or writes the layout file", async () => {
  const { view, cx } = mount(themeOf("carbon"));
  let reads = 0;
  state.readTextFile = (path) => { reads += 1; return diskRead(path); };
  view.render(cx);
  current = themeOf("nord");
  view.render(cx);
  await settle();
  assert.equal(reads, 0);
  assert.equal(writes.length, 0);
  assert.equal(state.files[PATH], shipped);
});

test("glass on in the theme but off in the file: nothing is written", async () => {
  const off = JSON.parse(shipped);
  delete off.colors;
  off.background = "chrome";
  const text = JSON.stringify(off, null, 2) + "\n";
  const { view, cx } = mount({ ...themeOf("carbon"), background: CLEAR }, text);
  view.render(cx);
  await settle();
  assert.equal(writes.length, 0);
  assert.equal(state.files[PATH], text);
});

test("no layout name, or a layout file that is missing: nothing is written and nothing throws", async () => {
  const a = mount(themeOf("carbon", { glass: true }));
  delete state.shared.layout;
  a.view.render(a.cx);
  await settle();
  assert.equal(writes.length, 0);
  const b = mount(themeOf("carbon", { glass: true }));
  state.files = {};
  b.view.render(b.cx);
  await settle();
  assert.equal(writes.length, 0);
  assert.deepEqual(state.files, {});
});

test("glass on: a write that fails frees the task, and the next theme is written", async () => {
  const { view, cx } = mount(themeOf("carbon", { glass: true }));
  state.writeTextFile = async () => { throw new Error("stale snapshot"); };
  view.render(cx);
  await settle();
  assert.equal(gutter(state.files[PATH]), "chrome");
  state.writeTextFile = async (...args) => { await diskWrite(...args); writes.push(args); };
  current = themeOf("nord", { glass: true });
  view.render(cx);
  await settle();
  assert.equal(writes.length, 1);
  assert.equal(gutter(state.files[PATH]), NORD);
});

test("glass on: a layout file replaced from outside is put right when the layout shows the old gutter", async () => {
  const { view, cx } = mount(themeOf("carbon", { glass: true }));
  view.render(cx);
  await settle();
  assert.equal(writes.length, 1);
  state.layout = JSON.parse(state.files[PATH]);
  view.render(cx);
  await settle();
  assert.equal(writes.length, 1, "the layout shows the written gutter: nothing to do");
  // An update copies the shipped file (gutter chrome) over it, and Herdr reloads it.
  state.files[PATH] = shipped;
  state.layout = JSON.parse(shipped);
  view.render(cx);
  await settle();
  assert.equal(writes.length, 2);
  assert.equal(gutter(state.files[PATH]), CARBON);
  state.layout = { id: "root", children: [] };
});
