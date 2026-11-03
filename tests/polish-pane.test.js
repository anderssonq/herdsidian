// The pane header: working bar, "Needs you" pill and width tracking (F4, F5).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeCx, element, walk } from "./support/mod-stubs.js";

// A theme whose keys all differ, so a test can tell accent from ansi5.
const hue = (key) => "#" + [...String(key)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 0xffffff, 7).toString(16).padStart(6, "0");
const palette = new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : hue(key)) });

// The mod reads the pane list through herdr's panes() and props(); point them at `current`.
const current = { pane: "p1", status: "idle" };
const stubs = globalThis.__herdsidianStubs;
const herdr = stubs.herdr;
herdr.panes = () => [current];
herdr.props = () => ({ pane: "p1" });
herdr.home = () => "/h";
herdr.theme = () => palette;
stubs["gpui-kit"].div = () => element("div");
stubs["gpui-kit"].svg = () => element("svg");
stubs["gpui-kit"].Background = { linear_gradient: (angle, from, to) => ({ angle, from, to }) };
stubs["gpui-base"].h_flex = () => element("div");

// The gradient segments the working bar paints.
let painted = [];
globalThis.window = { paint_path: (_path, background) => { painted.push(background); return element("div"); } };

const { default: Pane, PANE_RADIUS, BAR_INSET } = await import("../mods/herdsidian-pane/main.js");
const { barTrack, workingBar, needsPill } = await import("../mods/herdsidian-pane/ui.js");
const { alpha, tokens } = await import("../mods/herdsidian-pane/tokens.js");

beforeEach(() => { painted = []; current.status = "idle"; });

const call = (node, name) => node.calls.find(([n]) => n === name)?.[1];

const mount = (status, width) => {
  current.status = status;
  const view = new Pane(), cx = fakeCx();
  view.init({}, cx);
  if (width !== undefined) view.width = width;
  return { view, cx, tree: view.render() };
};
const render = (status, width) => {
  mount(status, width);
  return painted.length;
};
const statusDots = (tree) => walk(tree).filter((n) => call(n, "size")?.[0] === 6 && call(n, "rounded_full"));

test("the working bar renders for a working pane with a known width", () => {
  assert.equal(render("working", 800), 3);
});

for (const status of ["done", "blocked", "idle", undefined]) {
  test(`no working bar when the status is ${status}`, () => {
    assert.equal(render(status, 800), 0);
  });
}

test("no working bar while the width is unknown", () => {
  assert.equal(render("working", 0), 0);
  assert.equal(render("working"), 0);
});

test("the working bar is an absolute 2 px track holding three stops that loop", () => {
  const { tree } = mount("working", 800);
  const t = palette, { length, span } = barTrack(800, BAR_INSET);
  assert.deepEqual(painted, [
    { angle: 90, from: alpha(t.accent, 0), to: t.accent },
    { angle: 90, from: t.accent, to: t.ansi5 },
    { angle: 90, from: t.ansi5, to: alpha(t.ansi5, 0) },
  ]);
  assert.notEqual(t.accent, t.ansi5);
  const track = walk(tree).find((n) => call(n, "overflow_hidden") && call(n, "absolute"));
  assert.deepEqual(call(track, "h"), [2]);
  assert.deepEqual(call(track, "top"), [-1]);
  assert.deepEqual(call(track, "left"), [BAR_INSET]);
  assert.deepEqual(call(track, "right"), [BAR_INSET]);
  assert.equal(call(track, "bg")[0], tokens(t).accentTrack);
  const mover = walk(track).find((n) => call(n, "loop"));
  assert.equal(mover.kids.length, 3);
  assert.deepEqual(call(mover, "loop"), ["left", { from: -span, to: length, period: 3200, easing: "ease-in-out" }]);
});

test("the bar's track runs inset px short of each side; the indicator is 35 % of it", () => {
  assert.deepEqual(barTrack(800, 0), { length: 800, span: 280 });
  const { length, span } = barTrack(800, 8);
  assert.equal(length, 784);
  assert.ok(Math.abs(span - 274.4) < 1e-9);
});

test("no working bar when the inset leaves no track", () => {
  const t = { accent: "#4c9df3", ansi5: "#c678dd" }, k = { accentTrack: "#4c9df31f" };
  assert.equal(workingBar(t, k, 16, 8), null);
  assert.equal(workingBar(t, k, 10, 8), null);
  assert.notEqual(workingBar(t, k, 17, 8), null);
});

test("the bar is inset by half the pane radius", () => {
  assert.equal(BAR_INSET, 4);
});

test("PANE_RADIUS equals the layout's pane radius", () => {
  const layout = JSON.parse(readFileSync(new URL("../layouts/herdsidian.json", import.meta.url), "utf8"));
  const main = (node) => (node.content?.pane ? node : (node.children ?? []).map(main).find(Boolean));
  assert.equal(main(layout).content.pane.radius, PANE_RADIUS);
});

test("the Needs you pill has no border and holds the \"!\" mark", () => {
  const pill = needsPill(palette, tokens(palette), "#123456");
  assert.ok(pill.calls.every(([name]) => !name.startsWith("border")), "no border call");
  assert.ok(pill.kids.includes("Needs you"));
  const mark = pill.kids.find((kid) => typeof kid === "object" && kid.kids.includes("!"));
  assert.ok(mark, "the \"!\" mark is a child of the pill");
  assert.deepEqual(call(mark, "bg"), [palette.blocked]);
  assert.deepEqual(call(mark, "text_color"), ["#123456"]);
});

test("a blocked pane shows the pill; a working pane shows the bar and no status dot; a done pane shows a dot", () => {
  const blocked = mount("blocked", 800).tree;
  assert.ok(walk(blocked).some((n) => n.kids.includes("Needs you")));
  assert.equal(statusDots(blocked).length, 0);
  assert.equal(statusDots(mount("working", 800).tree).length, 0);
  const done = statusDots(mount("done", 800).tree);
  assert.equal(done.length, 1);
  assert.deepEqual(call(done[0], "bg"), [palette.done]);
});

test("the header's size handler stores the width and redraws only a working pane", () => {
  const { view, cx, tree } = mount("working");
  let notified = 0;
  cx.notify = () => { notified++; };
  const size = call(tree, "on_size_change")[0];
  size({ width: 600, height: 40 }, cx);
  assert.equal(notified, 1);
  assert.equal(view.width, 600);
  size({ width: 600, height: 44 }, cx);
  assert.equal(notified, 1);
  size({ width: 640, height: 40 }, cx);
  assert.equal(notified, 2);

  current.status = "idle";
  size({ width: 700, height: 40 }, cx);
  assert.equal(view.width, 700);
  assert.equal(notified, 2);
});
