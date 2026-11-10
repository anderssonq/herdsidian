// A working tab's dot in the toolbar is still (dot with pulse: false): filled with the working color, no loop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeCx, element, walk } from "./support/mod-stubs.js";

const stubs = globalThis.__herdsidianStubs;
stubs["gpui-kit"].div = () => element("div");
stubs["gpui-kit"].svg = () => element("svg");
stubs["gpui-base"].h_flex = () => element("div");
stubs.herdr.spaces = () => [{ id: "s1", name: "alpha", active: true,
  tabs: [{ id: "t1", name: "one", index: 1, active: true, status: "working" }] }];
stubs.herdr.theme = () => new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : key === "working" ? "WORK" : "#808080") });

const { default: Tabs } = await import("../mods/herdsidian-tabs/main.js");

const hasCall = (node, name, arg) => node.calls.some(([n, args]) => n === name && (arg === undefined || args[0] === arg));

test("a working tab's dot is still: filled with the working color and no loop", () => {
  const view = new Tabs(), cx = fakeCx();
  view.init({}, cx);
  const tab = walk(view.render(cx)).find((n) => n.nodeId === "tab-t1");
  const dot = walk(tab).find((n) => hasCall(n, "bg", "WORK"));
  assert.ok(dot, "dot");
  assert.ok(hasCall(dot, "rounded_full"));
  assert.ok(!hasCall(dot, "loop"));
});
