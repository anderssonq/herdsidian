// F2: the dot texture in the toolbar and the expanded Notes header (not the Notes rail).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { state, fakeCx, settle, svgPaths, walk } from "./support/mod-stubs.js";

// The gpui window, with a viewport the test can set (Notes reads it for its block's left edge).
// `null` means the window has no viewport_size().
const DEFAULT_VIEWPORT = { width: 1500, height: 900 };
let viewport = DEFAULT_VIEWPORT;
const anyWindow = globalThis.window;
globalThis.window = new Proxy(anyWindow, {
  get: (_t, key) => (key === "viewport_size" ? (viewport === null ? undefined : () => viewport) : anyWindow[key]),
});

// Herdr's zoom, which the test can set. The mods capture the function at import, so set it before.
let zoom = 1;
globalThis.__herdsidianStubs.herdr.settings = () => ({ zoom });

const { default: Tabs } = await import("../mods/herdsidian-tabs/main.js");
const { default: Notes, blockX: notesBlockX } = await import("../mods/herdsidian/main.js");

const repo = new URL("../", import.meta.url).pathname;

beforeEach(() => {
  state.shared = {}; state.runs = []; state.toasts = []; state.commands = []; state.files = {};
  state.layout = { id: "root", children: [] };
  viewport = DEFAULT_VIEWPORT; zoom = 1;
  localStorage.removeItem("vault");
});

const render = async (View) => {
  const view = new View(), cx = fakeCx();
  view.init({}, cx);
  await settle();
  return view.render(cx);
};

test("the toolbar draws the dot texture", async () => {
  assert.ok(svgPaths(await render(Tabs)).includes("mods/herdsidian-tabs/header-dots.svg"));
});

test("the expanded Notes header draws the dot texture", async () => {
  assert.ok(svgPaths(await render(Notes)).includes("mods/herdsidian/header-dots.svg"));
});

test("the Notes rail does not draw the dot texture", async () => {
  state.layout = { id: "root", children: [{ id: "herdsidian", size: { px: 44 } }] };
  assert.ok(!svgPaths(await render(Notes)).includes("mods/herdsidian/header-dots.svg"));
});

const { blockX } = await import("../mods/herdsidian-tabs/main.js");

test("the toolbar block starts after the sidebar and the root divider", () => {
  const sidebar = { id: "sidebar", size: { px: 248 } };
  assert.equal(blockX({ divider: { width: 1 } }, sidebar), 249);
  assert.equal(blockX({}, sidebar), 248);
  assert.equal(blockX({ divider: { width: 1 } }, { ...sidebar, hidden: true }), 0);
  assert.equal(blockX({ divider: { width: 1 } }, undefined), 0);
});

const dotsLeft = (tree) => walk(tree).find((n) => n.kind === "svg" && n.arg.endsWith("header-dots.svg")).calls.find(([name]) => name === "left")[1][0];

test("the toolbar's offset reaches the dots: sidebar 248 + divider 1 is 3 px left", async () => {
  state.layout = { id: "root", divider: { width: 1 }, children: [{ id: "sidebar", size: { px: 248 } }] };
  assert.equal(dotsLeft(await render(Tabs)), -3);
});

test("Notes' offset is the window width minus its own: 1500 - 380 is 4 px left", async () => {
  state.layout = { id: "root", children: [{ id: "herdsidian", size: { px: 380 } }] };
  assert.equal(dotsLeft(await render(Notes)), -4);
});

test("Notes falls back to 0 when its own width is unknown", async () => {
  assert.ok(dotsLeft(await render(Notes)) === 0); // -0 counts as 0
});

const NOTES_380 = { id: "root", children: [{ id: "herdsidian", size: { px: 380 } }] };

test("Notes' block edge divides the viewport by Herdr's zoom: 1500 / 1.1 - 380", () => {
  state.layout = NOTES_380; zoom = 1.1;
  assert.equal(notesBlockX(), 1500 / 1.1 - 380);
  assert.ok(Math.abs(notesBlockX() - 983.6363636363635) < 1e-9);
});

test("Notes' block edge is the plain difference at zoom 1", () => {
  state.layout = NOTES_380;
  assert.equal(notesBlockX(), 1120);
});

test("Notes' block edge ignores a zoom that is not a positive number", () => {
  state.layout = NOTES_380;
  for (const bad of [0, -1, NaN, "1.1", undefined]) { zoom = bad; assert.equal(notesBlockX(), 1120, String(bad)); }
});

test("Notes' block edge falls back to 0 without viewport_size", () => {
  state.layout = NOTES_380; viewport = null;
  assert.equal(notesBlockX(), 0);
});

test("Notes' block edge falls back to 0 when the width is not a number", () => {
  state.layout = NOTES_380;
  for (const width of ["1500", undefined, null, NaN]) { viewport = { width }; assert.equal(notesBlockX(), 0, String(width)); }
  viewport = undefined;
  assert.equal(notesBlockX(), 0);
});

test("Notes' block edge falls back to 0 when the window is not wider than Notes", () => {
  state.layout = NOTES_380;
  for (const width of [380, 300]) { viewport = { width }; assert.equal(notesBlockX(), 0, String(width)); }
  viewport = { width: 400 }; zoom = 1.1; // 400 / 1.1 = 363.6, under Notes' 380
  assert.equal(notesBlockX(), 0);
});

test("a fallback reaches the dots as 0, never NaN", async () => {
  state.layout = NOTES_380; viewport = { width: "x" };
  assert.ok(dotsLeft(await render(Notes)) === 0);
});

test("each mod ships its dots asset", () => {
  for (const mod of ["herdsidian-tabs", "herdsidian"]) assert.ok(existsSync(`${repo}mods/${mod}/header-dots.svg`), mod);
});
