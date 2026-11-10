import { test } from "node:test";
import assert from "node:assert/strict";
import { SIDEBAR_STORE, readSidebar, routeTab } from "../lib/sidebar.js";

test("the store key", () => {
  assert.equal(SIDEBAR_STORE, "herdsidian.sidebar");
});

test("readSidebar keeps a known tab and defaults to notes", () => {
  for (const tab of ["notes", "files", "changes"]) assert.deepEqual(readSidebar({ tab }), { tab });
  assert.deepEqual(readSidebar({ tab: "settings" }), { tab: "notes" });
  assert.deepEqual(readSidebar(undefined), { tab: "notes" });
  assert.deepEqual(readSidebar(null), { tab: "notes" });
  assert.deepEqual(readSidebar("files"), { tab: "notes" });
  assert.deepEqual(readSidebar({ tab: "nope" }), { tab: "notes" });
  assert.deepEqual(readSidebar({ tab: 3, other: 1 }), { tab: "notes" });
});

test("routeTab hides the sidebar when it is shown on the asked tab", () => {
  assert.deepEqual(routeTab({ hidden: false, tab: "files" }, "files"), {
    tab: "files", commands: [["layout.hide", { id: "herdsidian" }]],
  });
});

test("routeTab shows a hidden sidebar on the asked tab", () => {
  assert.deepEqual(routeTab({ hidden: true, tab: "files" }, "files"), {
    tab: "files", commands: [["layout.show", { id: "herdsidian" }]],
  });
  assert.deepEqual(routeTab({ hidden: true, tab: "notes" }, "changes"), {
    tab: "changes", commands: [["layout.show", { id: "herdsidian" }]],
  });
});

test("routeTab only switches the tab when the sidebar is shown on another tab", () => {
  assert.deepEqual(routeTab({ hidden: false, tab: "notes" }, "changes"), { tab: "changes", commands: [] });
});
