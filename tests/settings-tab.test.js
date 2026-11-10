// V4: the ⌘K palette's Settings tab is the only settings UI. Pure theme helpers first, then the real palette
// copy (palette-main.js) rendered with the stubs: the Theme section, the Appearance row, General and Layout.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, settle, findById, walk } from "./support/mod-stubs.js";
import {
  FAMILIES, themeName, themeCalls, shownThemeName, selectedFamily, parseAppearance, cardColors,
} from "../mods/herdsidian/theme-pick.js";
import * as themePick from "../mods/herdsidian/theme-pick.js";
import { settingSections, SIDEBAR_TABS } from "../lib/keys.js";

// A theme per name, every color distinct, so a test can tell which one a swatch used.
const NAMES = FAMILIES.flatMap((f) => [`hs_${f.id}`, `hs_${f.id}_light`]);
const THEMES = NAMES.map((name, i) => ({
  name, light: name.endsWith("_light"),
  colors: { chrome: `#${i + 1}1111a`.padEnd(7, "0"), canvas: `#${i + 1}2222b`.padEnd(7, "0"), foreground: `#${i + 1}3333c`.padEnd(7, "0"), accent: `#${i + 1}4444d`.padEnd(7, "0") },
}));
const colorsOf = (name) => THEMES.find((th) => th.name === name).colors;

// pure

test("there are four families, in order", () => {
  assert.deepEqual(FAMILIES.map((f) => [f.id, f.label]),
    [["carbon", "Carbon"], ["midnight", "Midnight"], ["catppuccin", "Catppuccin"], ["nord", "Nord"]]);
});

test("theme-pick exports only what the palette uses", () => {
  for (const gone of ["APPEARANCES", "APPEARANCE_NOTE", "appliedLine", "selectedAppearance"]) assert.equal(themePick[gone], undefined, gone);
});

test("themeName builds the dark and the light name of a family", () => {
  assert.equal(themeName("nord"), "hs_nord");
  assert.equal(themeName("nord", true), "hs_nord_light");
});

test("a family pick is two app.theme calls: the dark name, then the light name", () => {
  assert.deepEqual(themeCalls("midnight", THEMES), [
    ["app.theme", { name: "hs_midnight" }],
    ["app.theme", { name: "hs_midnight_light" }],
  ]);
});

test("a family pick calls app.theme only for halves whose theme exists", () => {
  assert.deepEqual(themeCalls("nord", THEMES), [["app.theme", { name: "hs_nord" }], ["app.theme", { name: "hs_nord_light" }]]);
  assert.deepEqual(themeCalls("nord", THEMES.filter((th) => th.name !== "hs_nord_light")), [["app.theme", { name: "hs_nord" }]]);
  assert.deepEqual(themeCalls("nord", []), []);
});

test("the shown theme is a string, or the light or dark half picked by `dark`", () => {
  assert.equal(shownThemeName({ theme: "hs_nord_light", dark: false }), "hs_nord_light");
  const pair = { theme: { light: "hs_nord_light", dark: "hs_carbon" } };
  assert.equal(shownThemeName({ ...pair, dark: true }), "hs_carbon");
  assert.equal(shownThemeName({ ...pair, dark: false }), "hs_nord_light");
  assert.equal(shownThemeName({}), null);
  assert.equal(shownThemeName(undefined), null);
  assert.equal(shownThemeName({ theme: 7 }), null);
});

test("the selected family is read from an hs_ name, dark or light; anything else selects none", () => {
  assert.equal(selectedFamily({ theme: "hs_midnight" }), "midnight");
  assert.equal(selectedFamily({ theme: "hs_catppuccin_light" }), "catppuccin");
  assert.equal(selectedFamily({ theme: { light: "hs_nord_light", dark: "hs_carbon" }, dark: true }), "carbon");
  assert.equal(selectedFamily({ theme: { light: "hs_nord_light", dark: "hs_carbon" }, dark: false }), "nord");
  assert.equal(selectedFamily({ theme: "tokyo-night" }), null);
  assert.equal(selectedFamily({ theme: "hs_unknown" }), null);
  assert.equal(selectedFamily({}), null);
});

test("parseAppearance reads settings.json text: dark or light as set, system when absent, null when unreadable", () => {
  assert.equal(parseAppearance('{"appearance":"dark","zoom":1}'), "dark");
  assert.equal(parseAppearance('{"appearance":"light"}'), "light");
  assert.equal(parseAppearance("{}"), "system");
  assert.equal(parseAppearance('{"appearance":"auto"}'), "system");
  assert.equal(parseAppearance('{"appearance":7}'), "system");
  assert.equal(parseAppearance("{not json"), null);
  assert.equal(parseAppearance(""), null);
  assert.equal(parseAppearance("[1]"), null);
  assert.equal(parseAppearance("null"), null);
  assert.equal(parseAppearance(null), null);
  assert.equal(parseAppearance(undefined), null);
});

test("card colors come from themes(): the canvas color and the accent dot, nothing else", () => {
  const c = cardColors(THEMES, "midnight");
  const dark = colorsOf("hs_midnight"), light = colorsOf("hs_midnight_light");
  assert.deepEqual(c.dark, { to: dark.canvas, dot: dark.accent });
  assert.deepEqual(c.light, { to: light.canvas, dot: light.accent });
});

test("card colors are null for a half whose theme is missing", () => {
  const onlyDark = THEMES.filter((th) => th.name !== "hs_nord_light");
  const c = cardColors(onlyDark, "nord");
  assert.ok(c.dark);
  assert.equal(c.light, null);
  assert.deepEqual(cardColors([], "nord"), { dark: null, light: null });
  assert.deepEqual(cardColors(undefined, "nord"), { dark: null, light: null });
});

// the real palette copy

const ACCENT = "#acc0";
const stubs = globalThis.__herdsidianStubs;
const herdrState = { settings: { zoom: 1 }, keys: [], themes: THEMES };
stubs.herdr.theme = () => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : key === "accent" ? ACCENT : "#808080") });
stubs.herdr.themes = () => herdrState.themes;
stubs.herdr.settings = () => herdrState.settings;
stubs.herdr.keys = () => herdrState.keys;
stubs.herdr.appHome = () => "/herdr-home";
const HERDR_SETTINGS = "/herdr-home/settings.json";

const { Palette } = await import("../mods/herdsidian/palette-main.js");

const SETTINGS = "herdsidian.settings";

beforeEach(() => {
  state.shared = {}; state.runs = []; state.toasts = []; state.closed = []; state.files = { [HERDR_SETTINGS]: "{}" };
  state.props = { overlay: "o1" };
  state.layout = { id: "root", children: [{ id: "herdsidian", size: { px: 380 } }] };
  herdrState.settings = { zoom: 1, theme: "hs_carbon", dark: true };
  herdrState.keys = []; herdrState.themes = THEMES;
});

const mount = async () => {
  const cx = fakeCx();
  const view = new Palette(cx);
  await settle();
  view.on.tab("settings", cx);
  return { view, cx, tree: () => view.render(cx) };
};

const text = (node) => (typeof node === "string" ? node : node && typeof node === "object" && "kids" in node ? node.kids.map(text).join("") : "");
const has = (node, name, ...args) => node.calls.some(([n, a]) => n === name && args.every((v, i) => a[i] === v));
const row = (tree, id) => findById(tree, `row-setting:${id}`);
const click = (tree, id, cx) => row(tree, id).onClick(null, cx);
const rowIds = (tree) => walk(tree).map((n) => n.nodeId).filter((id) => id?.startsWith("row-setting:")).map((id) => id.slice("row-setting:".length));
const titles = (tree) => walk(tree).filter((n) => n.nodeId === "section-settings").map((n) => text(n.kids[0]));

test("the Settings tab starts with a Theme section of four rows, then Appearance, General and Layout", async () => {
  const { tree } = await mount();
  assert.deepEqual(titles(tree()), ["Theme", "Appearance", "General", "Layout"]);
  const ids = rowIds(tree());
  assert.deepEqual(ids.slice(0, 5), ["theme-carbon", "theme-midnight", "theme-catppuccin", "theme-nord", "appearance"]);
  for (const f of FAMILIES) assert.ok(text(row(tree(), `theme-${f.id}`)).includes(f.label));
  assert.ok(!ids.includes("theme"), "no Theme… row");
});

test("the current family has a check in the accent color; the others have none", async () => {
  herdrState.settings = { zoom: 1, theme: "hs_midnight_light", dark: false };
  const { tree } = await mount();
  for (const f of FAMILIES) assert.equal(Boolean(findById(tree(), `check-theme-${f.id}`)), f.id === "midnight", f.id);
  const check = findById(tree(), "check-theme-midnight");
  assert.deepEqual(check.kids, ["✓"]);
  assert.ok(has(check, "text_color", ACCENT));
});

test("a theme that is not a Herdsidian one checks no row; the {light, dark} pair follows `dark`", async () => {
  herdrState.settings = { zoom: 1, theme: "tokyo-night", dark: true };
  assert.equal(walk((await mount()).tree()).filter((n) => n.nodeId?.startsWith("check-theme-")).length, 0);
  herdrState.settings = { zoom: 1, theme: { light: "hs_nord_light", dark: "hs_carbon" }, dark: false };
  const { tree } = await mount();
  assert.ok(findById(tree(), "check-theme-nord"));
  assert.equal(findById(tree(), "check-theme-carbon"), null);
});

test("each theme row has a dark and a light swatch: the canvas of its theme and the accent dot", async () => {
  const { tree } = await mount();
  for (const f of FAMILIES) {
    for (const light of [false, true]) {
      const c = colorsOf(themeName(f.id, light)), id = `swatch-theme-${f.id}-${light ? "light" : "dark"}`;
      assert.ok(has(findById(tree(), id), "bg", c.canvas), `${id} canvas`);
      assert.ok(has(findById(tree(), `${id}-dot`), "bg", c.accent), `${id} dot`);
    }
  }
});

test("a swatch half whose theme is missing is not drawn", async () => {
  herdrState.themes = THEMES.filter((th) => th.name !== "hs_nord_light");
  const { tree } = await mount();
  assert.ok(findById(tree(), "swatch-theme-nord-dark"));
  assert.equal(findById(tree(), "swatch-theme-nord-light"), null);
});

test("picking a family runs app.theme for the dark name, then the light name, and keeps the palette open", async () => {
  const { cx, tree } = await mount();
  click(tree(), "theme-nord", cx);
  assert.deepEqual(state.runs, [["app.theme", { name: "hs_nord" }], ["app.theme", { name: "hs_nord_light" }]]);
  assert.deepEqual(state.closed, []);
  herdrState.settings = { zoom: 1, theme: "hs_nord", dark: true };
  assert.ok(findById(tree(), "check-theme-nord"));
  assert.equal(findById(tree(), "check-theme-carbon"), null);
});

test("picking a family whose light theme is missing runs only the dark app.theme", async () => {
  herdrState.themes = THEMES.filter((th) => th.name !== "hs_nord_light");
  const { cx, tree } = await mount();
  click(tree(), "theme-nord", cx);
  assert.deepEqual(state.runs, [["app.theme", { name: "hs_nord" }]]);
});

// The appearance comes from Herdr's settings.json (read-only), read in the palette copy off render.

test("the Appearance row shows System when settings.json has no appearance, Dark or Light when it is set", async () => {
  const detail = async () => text(row((await mount()).tree(), "appearance"));
  assert.ok((await detail()).includes("Light / dark"));
  assert.ok((await detail()).includes("System · set in Herdr Settings ↗"));
  state.files[HERDR_SETTINGS] = '{"appearance":"dark"}';
  assert.ok((await detail()).includes("Dark · set in Herdr Settings ↗"));
  state.files[HERDR_SETTINGS] = '{"appearance":"light"}';
  assert.ok((await detail()).includes("Light · set in Herdr Settings ↗"));
});

test("the Appearance row ignores a settings() appearance field and follows settings.json", async () => {
  herdrState.settings = { zoom: 1, theme: "hs_carbon_light", dark: false, appearance: "light" };
  assert.ok(text(row((await mount()).tree(), "appearance")).includes("System · "));
});

test("an unreadable or bad settings.json leaves only the pointer in the Appearance detail", async () => {
  delete state.files[HERDR_SETTINGS];
  const missing = text(row((await mount()).tree(), "appearance"));
  assert.ok(missing.endsWith("set in Herdr Settings ↗") && !missing.includes("·"), missing);
  state.files[HERDR_SETTINGS] = "{oops";
  const bad = text(row((await mount()).tree(), "appearance"));
  assert.ok(bad.endsWith("set in Herdr Settings ↗") && !bad.includes("·"), bad);
});

test("picking Appearance opens Herdr Settings → Look and closes the palette, without a redraw", async () => {
  const { cx, tree } = await mount();
  let redraws = 0;
  cx.notify = () => { redraws++; };
  tree();
  click(tree(), "appearance", cx);
  assert.deepEqual(state.runs, [["app.settings", { section: "look" }]]);
  assert.deepEqual(state.closed, ["o1"]);
  assert.equal(redraws, 0);
  assert.equal(state.shared[SETTINGS], undefined);
  assert.equal(state.files[HERDR_SETTINGS], "{}", "settings.json is never written");
});

test("the appearance is read again after a family pick", async () => {
  const { cx, tree } = await mount();
  assert.ok(text(row(tree(), "appearance")).includes("System · "));
  state.files[HERDR_SETTINGS] = '{"appearance":"dark"}';
  click(tree(), "theme-nord", cx);
  await settle();
  assert.ok(text(row(tree(), "appearance")).includes("Dark · "));
});

// General and Layout

const inputs = (over = {}) => ({ settings: { keyHints: "modifier", usageInStatus: true }, sidebarHidden: false, sidebarRail: false, sidebarTab: "notes", ...over });

test("General and Layout render the rows of lib's settingSections, in order, after Appearance", async () => {
  const { tree } = await mount();
  const expected = settingSections(inputs()).flatMap((sec) => sec.rows);
  assert.deepEqual(rowIds(tree()).slice(5), expected.map((r) => r.id));
  for (const r of expected) {
    const got = text(row(tree(), r.id));
    assert.ok(got.includes(r.label) && got.includes(r.detail), `${r.id}: ${got}`);
  }
});

test("the key hints row cycles modifier, always, off through the shared store and keeps the palette open", async () => {
  const { cx, tree } = await mount();
  assert.ok(text(row(tree(), "key-hints")).includes("On hover"));
  click(tree(), "key-hints", cx);
  assert.equal(state.shared[SETTINGS].keyHints, "always");
  assert.ok(text(row(tree(), "key-hints")).includes("Always"));
  click(tree(), "key-hints", cx);
  assert.equal(state.shared[SETTINGS].keyHints, "off");
  assert.deepEqual(state.runs, []);
  assert.deepEqual(state.closed, []);
});

test("the usage row toggles usageInStatus and keeps the other settings", async () => {
  state.shared[SETTINGS] = { keyHints: "always", usageInStatus: true };
  const { cx, tree } = await mount();
  click(tree(), "usage-in-status", cx);
  assert.deepEqual(state.shared[SETTINGS], { keyHints: "always", usageInStatus: false });
  assert.ok(text(row(tree(), "usage-in-status")).includes("Off"));
});

test("the layout rows run their commands: toggle the sidebar, go to the next tab, switch to the rail", async () => {
  const { cx, tree } = await mount();
  click(tree(), "sidebar-tab", cx);
  click(tree(), "sidebar-width", cx);
  click(tree(), "right-sidebar", cx);
  assert.deepEqual(state.runs, [[`herdsidian-tabs.${SIDEBAR_TABS[1]}`, {}], ["herdsidian.rail", {}], ["layout.toggle", { id: "herdsidian" }]]);
});
