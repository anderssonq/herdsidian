// The sidebar brand block: app icon before the name, none on the rail, and its assets ship.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { state, element, walk } from "./support/mod-stubs.js";

// The shared stub has no image(); record it as a node so the tree shows it.
globalThis.__herdsidianStubs["gpui-kit"].image = (path) => element("image", path);

const { default: Chrome } = await import("../mods/herdsidian-chrome/main.js");

const mod = new URL("../mods/herdsidian-chrome/", import.meta.url).pathname;
const ICON = "mods/herdsidian-chrome/herdsidian.svg";

beforeEach(() => {
  state.layout = { id: "root", children: [] };
});

const render = () => new Chrome().render({});
const nameIndex = (all) => all.findIndex((n) => n.kids.includes("Herdsidian"));

test("the expanded header shows the icon image before the name", () => {
  const all = walk(render());
  const icon = all.findIndex((n) => n.kind === "image" && n.arg === ICON);
  assert.ok(icon >= 0, "icon image");
  assert.ok(nameIndex(all) > icon, "name comes after the icon");
  assert.equal(all.some((n) => n.kind === "svg" && n.arg === ICON), false, "never tinted through svg()");
});

test("the rail shows no icon", () => {
  state.layout = { id: "root", children: [{ id: "sidebar", size: { px: 60 } }] };
  const all = walk(render());
  assert.equal(all.some((n) => n.kind === "image"), false);
  assert.equal(nameIndex(all), -1);
});

test("the mod ships the icon and the header dots", () => {
  assert.ok(existsSync(`${mod}herdsidian.svg`));
  assert.ok(existsSync(`${mod}header-dots.svg`));
});
