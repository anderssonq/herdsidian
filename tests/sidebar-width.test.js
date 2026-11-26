// The right sidebar width (AC8, AC9, AC11): the layout's max, the width restored from the rail, the rail below 160.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  state,
  fakeCx,
  findById,
  settle,
  mountNotes,
} from "./support/sidebar-kit.js";
import { settingSections } from "../lib/keys.js";

const { default: Notes } = await import("../mods/herdsidian/main.js");

beforeEach(() => {
  localStorage.removeItem("width");
});

// AC8: today's layout tree, written as data, with only the herdsidian block's max changed (720 -> 760).
const EXPECTED_LAYOUT = {
  id: "root",
  type: "row",
  children: [
    {
      id: "sidebar",
      type: "column",
      children: [
        {
          id: "brand",
          type: "block",
          content: { mod: "herdsidian-chrome" },
          size: { px: 52 },
          window_drag: true,
        },
        {
          id: "sidebar-lists",
          type: "column",
          children: [
            {
              id: "spaces",
              type: "block",
              content: { mod: "guide-spaces" },
              size: { weight: 1 },
              min: 90,
            },
            {
              id: "agents",
              type: "block",
              content: { mod: "guide-agents" },
              size: { weight: 1 },
              min: 90,
            },
          ],
        },
        {
          id: "sidebar-footer",
          type: "block",
          content: { mod: "herdsidian-chrome", props: { footer: true } },
          size: { px: 80 },
        },
      ],
      size: { px: 248 },
      min: 44,
      max: 480,
      resizable: false,
    },
    {
      id: "work",
      type: "column",
      children: [
        {
          id: "tabs",
          type: "block",
          content: { mod: "herdsidian-tabs" },
          size: { px: 52 },
          window_drag: true,
        },
        {
          id: "work-body",
          type: "row",
          children: [
            {
              id: "main",
              type: "block",
              content: {
                tab: "active",
                pane: {
                  header: {
                    content: { mod: "herdsidian-pane" },
                    reveal: "always",
                    height: 30,
                    position: "top",
                  },
                  background: "surface",
                  border: { width: 1, color: "border" },
                  focus: { width: 1, color: "accent" },
                  radius: 8,
                  gap: 6,
                  lone: true,
                },
              },
            },
          ],
          padding: 4,
          gap: 6,
          background: "chrome",
        },
        {
          id: "status",
          type: "block",
          content: { mod: "herdsidian-status" },
          size: { px: 28 },
        },
      ],
      resizable: false,
    },
    {
      id: "herdsidian",
      type: "block",
      hidden: true,
      size: { px: 380 },
      min: 44,
      max: 760,
      content: { mod: "herdsidian" },
    },
  ],
  background: "#00000000",
  window_blur: true,
  terminal_padding: [10, 6],
  divider: { width: 1, color: "border" },
  toast: "herdsidian-toast",
  titlebar: "none",
  traffic_lights: [16, 19],
  theme: "hs_carbon",
  preview: "layouts/herdsidian.svg",
  terminal_opacity: 0,
  ui_font: ".AppleSystemUIFont",
  colors: { background: "#00000000" },
};

test("AC8 the layout's herdsidian block has max 760 and nothing else changed", () => {
  const layout = JSON.parse(
    readFileSync(
      new URL("../layouts/herdsidian.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(layout, EXPECTED_LAYOUT);
});

// AC9: a rail view with a stored width. through: "button" calls collapse() (the Expand button); "command" sends
// the `expand` command (what the Settings width row and the palette run from the rail).
async function expandFromRail(stored, through) {
  if (stored === undefined) localStorage.removeItem("width");
  else localStorage.setItem("width", stored);
  state.shared = {};
  state.runs = [];
  state.toasts = [];
  state.files = {};
  state.commands = through === "command" ? ["expand"] : [];
  state.layout = {
    id: "root",
    children: [{ id: "herdsidian", size: { px: 44 } }],
  };
  localStorage.setItem("vault", "/vault/my notes");
  const view = new Notes(),
    cx = fakeCx();
  view.init({}, cx);
  await settle();
  if (through === "button") view.collapse();
  await settle();
  return state.runs.filter(([name]) => name === "layout.resize");
}

const CASES = [
  ["500", 500],
  ["760", 760],
  ["160", 160],
  ["159", 380],
  ["761", 380],
  ["abc", 380],
  ["", 380],
  [undefined, 380],
];

for (const through of ["button", "command"]) {
  for (const [stored, px] of CASES) {
    test(`AC9 Expand restores a stored width: ${JSON.stringify(stored)} -> ${px} (${through})`, async () => {
      assert.deepEqual(await expandFromRail(stored, through), [
        ["layout.resize", { id: "herdsidian", px }],
      ]);
    });
  }
}

test("AC9 the Settings width row does the same: from the rail it runs the expand command", () => {
  const rows = settingSections({
    settings: {},
    sidebarHidden: false,
    sidebarRail: true,
    sidebarTab: "notes",
  }).flatMap((s) => s.rows);
  const row = rows.find((r) => r.id === "sidebar-width");
  assert.deepEqual(row.action, {
    type: "run",
    name: "herdsidian.expand",
    args: {},
  });
});

test("AC9 the Settings width row restores 500 and falls back to 380 for a stored value over 760", async () => {
  assert.deepEqual(await expandFromRail("500", "command"), [
    ["layout.resize", { id: "herdsidian", px: 500 }],
  ]);
  assert.deepEqual(await expandFromRail("900", "command"), [
    ["layout.resize", { id: "herdsidian", px: 380 }],
  ]);
});

// AC11: the tree is the rail below 160 and the wide one from 160.
test("AC11 under 160 the sidebar is the rail", async () => {
  const narrow = await mountNotes({ width: 159 });
  assert.ok(findById(narrow.tree, "sidebar-rail-notes"), "rail icon at 159");
  assert.equal(
    findById(narrow.tree, "sidebar-tab-notes"),
    null,
    "no tab control at 159",
  );
  const wide = await mountNotes({ width: 160 });
  assert.ok(findById(wide.tree, "sidebar-tab-notes"), "tab control at 160");
  assert.equal(
    findById(wide.tree, "sidebar-rail-notes"),
    null,
    "no rail icon at 160",
  );
});

test("AC11 dragging from 760 to under 160 shows the rail", async () => {
  const { view, cx } = await mountNotes({ width: 760 });
  assert.ok(findById(view.render(cx), "sidebar-tab-notes"));
  state.layout = {
    id: "root",
    children: [{ id: "herdsidian", size: { px: 100 } }],
  };
  const tree = view.render(cx);
  assert.ok(findById(tree, "sidebar-rail-notes"));
  assert.equal(findById(tree, "sidebar-tab-notes"), null);
});
