// V3: Usage in the status bar (the focused pane's provider in full, the others compact) and the
// ⌘J key cap on the "Needs you" pill. Pure logic first, then the real status mod against stubs.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, settle, element, walk, findById, svgPaths } from "./support/mod-stubs.js";

const stubs = globalThis.__herdsidianStubs;
const hooks = { knownAgents: async () => [], panes: [], focused: null, agents: [], keys: [] };
stubs["gpui-base"].HoverCard = { new: (id) => element("hovercard", id) };
stubs.herdr.knownAgents = (...args) => hooks.knownAgents(...args);
stubs.herdr.panes = () => hooks.panes;
stubs.herdr.focused = () => hooks.focused;
stubs.herdr.agents = () => hooks.agents;
stubs.herdr.keys = () => hooks.keys;
stubs.herdr.settings = () => ({ theme: "hs_nord_theme" });
const T = { foreground: "#ffffff", muted: "#888888", accent: "#00ff00", blocked: "#ff0000", canvas: "#101010", chrome: "#202020", background: "#101010", raised: "#303030", working: "#0000ff" };
stubs.herdr.theme = () => new Proxy(T, { get: (target, key) => (typeof key === "string" ? target[key] ?? "#808080" : undefined) });

const { default: Status } = await import("../mods/herdsidian-status/main.js");
const { focusedProgramKey, primaryKey, orderedProviders, reading, NO_READING, HIGH_PERCENT } = await import("../mods/herdsidian-status/usage-status.js");
const { tokens, RADIUS } = await import("../mods/herdsidian-status/tokens.js");
const k = tokens(T);

const AGENTS = [
  { key: "opencode", name: "opencode", icon: "icons/opencode.svg", tint: true, installed: true },
  { key: "codex", name: "Codex", icon: "icons/codex.svg", tint: true, installed: true },
  { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: true, installed: true },
  { key: "gemini", name: "Gemini", icon: "icons/gemini.svg", tint: true, installed: true },
];
const FAR = "2099-01-01T00:00:00Z";
const claudeBody = (five) => `{"five_hour":{"utilization":${five},"resets_at":"${FAR}"},"seven_day":{"utilization":25.0,"resets_at":"${FAR}"}}\n200`;
const CODEX = '{"timestamp":"2026-10-31T19:45:27.541Z","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":61.0,"window_minutes":300,"resets_at":4102444800},"secondary":{"used_percent":53.0,"window_minutes":10080,"resets_at":4102444800},"plan_type":"plus"}}}';
const OPENCODE = "│Total Cost      $30.95 │\n│Input            4.1M │\n│Output         325.2K │\n";
const ok = (stdout) => ({ code: 0, stdout, stderr: "" });

let calls, claudePercent;
const answering = (command, args) => {
  calls.push([command, args]);
  if (command === "opencode") return Promise.resolve(ok(OPENCODE));
  return Promise.resolve(ok(args[1].includes("curl") ? claudeBody(claudePercent) : CODEX));
};

beforeEach(() => {
  calls = []; claudePercent = 42;
  state.exec = answering; state.runs = []; state.shared = {};
  hooks.knownAgents = async () => AGENTS;
  hooks.panes = []; hooks.focused = null; hooks.agents = []; hooks.keys = [];
});

const focusProgram = (key) => {
  hooks.panes = [{ pane: "p1", terminal: "t1", program: { key } }, { pane: "p2", terminal: "t2", program: { key: "other" } }];
  hooks.focused = { pane: "p1" };
};
const start = async () => {
  const view = new Status(), cx = fakeCx();
  view.init({}, cx);
  await settle();
  return { view, cx };
};
const call = (node, name) => node.calls.find(([n]) => n === name)?.[1][0];
const lastCall = (node, name) => node.calls.filter(([n]) => n === name).at(-1)?.[1][0];
const hovercard = (view) => walk(view.render()).find((n) => n.kind === "hovercard");
const hoverHandler = (card) => call(call(card, "trigger"), "on_hover");
const textsOf = (node, out = []) => {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object" && "kids" in node) {
    for (const kid of node.kids) textsOf(kid, out);
    for (const [name, args] of node.calls) if (name !== "child" && name !== "children") for (const a of args) if (a && typeof a === "object" && "kids" in a) textsOf(a, out);
  }
  return out;
};
const hover = async (view) => { hoverHandler(hovercard(view))(true); await settle(); };
const control = (view) => call(hovercard(view), "trigger");

// ---- pure logic ----

test("focusedProgramKey reads the focused pane's program key from panes() (probe Q4)", () => {
  const panes = [{ pane: "p1", terminal: "t1", program: { key: "claude" } }, { pane: "p2", terminal: "t2", program: { key: "opencode" } }];
  assert.equal(focusedProgramKey({ pane: "p2" }, panes), "opencode");
  assert.equal(focusedProgramKey({ terminal: "t1" }, panes), "claude", "a focus without a pane falls back to the terminal");
  assert.equal(focusedProgramKey({ pane: "p9" }, panes), undefined);
  assert.equal(focusedProgramKey(null, panes), undefined);
  assert.equal(focusedProgramKey({ pane: "p1" }, []), undefined);
});

test("primaryKey: the focused pane's provider when installed, else the first installed in claude, codex, opencode order", () => {
  assert.equal(primaryKey(["claude", "codex", "opencode"], "codex"), "codex");
  assert.equal(primaryKey(["claude", "codex", "opencode"], "opencode"), "opencode");
  assert.equal(primaryKey(["claude", "codex", "opencode"], "zsh"), "claude");
  assert.equal(primaryKey(["claude", "codex", "opencode"], undefined), "claude");
  assert.equal(primaryKey(["codex", "opencode"], "claude"), "codex", "a provider that is not installed is not primary");
  assert.equal(primaryKey([], "claude"), null);
});

test("orderedProviders puts the primary first and keeps S1 order for the rest", () => {
  const list = AGENTS.filter((a) => a.key !== "gemini").sort((a, b) => b.key.localeCompare(a.key));
  assert.deepEqual(orderedProviders(list, "opencode").map((p) => p.key), ["opencode", "claude", "codex"]);
  assert.deepEqual(orderedProviders(list, "shell").map((p) => p.key), ["claude", "codex", "opencode"]);
});

test("reading: main percent is the 5 h window, else the first; opencode gives its cost; no data gives the dash", () => {
  const limits = (windows) => ({ state: "ok", data: { kind: "limits", windows, plan: null, at: null } });
  const w = (label, percent) => ({ label, percent, resetsAt: null });
  assert.deepEqual(reading("claude", limits([w("7 d", 30), w("5 h", 42)]), 0), { text: "42%", percent: 42, label: "5 h", high: false });
  assert.deepEqual(reading("codex", limits([w("7 d", 30), w("1 d", 10)]), 0), { text: "30%", percent: 30, label: "7 d", high: false });
  assert.deepEqual(reading("opencode", { state: "ok", data: { kind: "stats", cost: "$30.95", input: "1", output: "2" } }, 0), { text: "$30.95", percent: null, label: "7 d", high: false });
  for (const entry of [{ state: "loading" }, { state: "error", error: "timeout" }, undefined]) {
    assert.deepEqual(reading("claude", entry, 0), { text: NO_READING, percent: null, label: "", high: false });
  }
  assert.equal(NO_READING, "–");
});

test("reading: 90 % and over is high, 89 % is not", () => {
  const at = (p) => reading("claude", { state: "ok", data: { kind: "limits", windows: [{ label: "5 h", percent: p, resetsAt: null }] } }, 0);
  assert.equal(HIGH_PERCENT, 90);
  assert.equal(at(89.4).high, false);
  assert.equal(at(90).high, true);
  assert.equal(at(100).high, true);
});

test("reading: a Codex window already reset reads 0 %", () => {
  const entry = { state: "ok", data: { kind: "limits", windows: [{ label: "5 h", percent: 95, resetsAt: 1000 }] } };
  assert.equal(reading("codex", entry, 2000).text, "0%");
  assert.equal(reading("claude", entry, 2000).text, "95%");
});

// ---- rendering ----

test("AC-V3.1: the primary provider follows the focused pane: claude, codex, opencode", async () => {
  for (const key of ["claude", "codex", "opencode"]) {
    focusProgram(key);
    const { view } = await start();
    const primary = findById(control(view), "usage-primary");
    assert.ok(primary, `${key}: a primary part`);
    assert.deepEqual(svgPaths(primary), [`icons/${key}.svg`]);
    const others = ["claude", "codex", "opencode"].filter((x) => x !== key);
    assert.deepEqual(svgPaths(control(view)), [`icons/${key}.svg`, ...others.map((x) => `icons/${x}.svg`)]);
  }
});

test("the primary is the first installed provider when the focused pane runs no provider, or nothing is focused", async () => {
  focusProgram("zsh");
  let { view } = await start();
  assert.deepEqual(svgPaths(findById(control(view), "usage-primary")), ["icons/claude.svg"]);
  hooks.focused = null;
  ({ view } = await start());
  assert.deepEqual(svgPaths(findById(control(view), "usage-primary")), ["icons/claude.svg"]);
  hooks.knownAgents = async () => AGENTS.filter((a) => a.key !== "claude");
  ({ view } = await start());
  assert.deepEqual(svgPaths(findById(control(view), "usage-primary")), ["icons/codex.svg"]);
});

test("the control: h 20, RADIUS.control, 11 px, never shrinks; the divider is 1 x 12 in k.line", async () => {
  const { view } = await start();
  const c = control(view);
  assert.equal(c.nodeId, "usage");
  assert.equal(call(c, "h"), 20);
  assert.equal(call(c, "rounded"), RADIUS.control);
  assert.equal(call(c, "text_size"), 11);
  assert.ok(c.calls.some(([n]) => n === "flex_none"));
  const divider = findById(c, "usage-divider");
  assert.equal(call(divider, "w"), 1);
  assert.equal(call(divider, "h"), 12);
  assert.equal(lastCall(divider, "bg"), k.line);
});

test("before the first hover every provider shows the dash, the primary has no bar, and nothing is fetched", async () => {
  focusProgram("codex");
  const { view } = await start();
  await settle();
  assert.equal(calls.length, 0);
  const c = control(view);
  assert.deepEqual(svgPaths(c), ["icons/codex.svg", "icons/claude.svg", "icons/opencode.svg"]);
  assert.deepEqual(textsOf(c).filter((t) => t !== "5 h" && t !== "7 d"), ["–", "–", "–"]);
  assert.equal(findById(c, "usage-bar"), null);
});

test("after a hover the primary shows percent, 40 x 4 bar and window label; the others show compact numbers", async () => {
  focusProgram("claude");
  const { view } = await start();
  await hover(view);
  const c = control(view);
  const primary = findById(c, "usage-primary");
  assert.deepEqual(textsOf(primary), ["42%", "5 h"]);
  assert.equal(lastCall(findById(primary, "usage-percent"), "text_color"), T.foreground);
  const bar = findById(primary, "usage-bar");
  assert.equal(call(bar, "w"), 40);
  assert.equal(call(bar, "h"), 4);
  assert.equal(lastCall(bar, "bg"), k.accentTrack);
  const fill = findById(primary, "usage-fill");
  assert.equal(call(fill, "w"), "42%");
  assert.equal(lastCall(fill, "bg"), T.accent);
  assert.ok(svgPaths(primary).length === 1 && call(primary, "gap") === 6);
  assert.equal(lastCall(findById(primary, "usage-label"), "text_color"), T.muted);
  assert.deepEqual(textsOf(findById(c, "usage-other-codex")), ["61%"]);
  assert.deepEqual(textsOf(findById(c, "usage-other-opencode")), ["$30.95"]);
  assert.equal(findById(c, "usage-other-claude"), null, "the primary is not repeated");
  assert.equal(lastCall(findById(c, "usage-other-codex"), "text_color"), T.muted);
});

test("an opencode primary shows its 7-day cost and the 7 d label, without a bar", async () => {
  focusProgram("opencode");
  const { view } = await start();
  await hover(view);
  const primary = findById(control(view), "usage-primary");
  assert.deepEqual(textsOf(primary), ["$30.95", "7 d"]);
  assert.equal(findById(primary, "usage-bar"), null);
});

test("at 90 % and over the percent and the fill are t.blocked and an alert mark comes first", async () => {
  claudePercent = 93;
  focusProgram("claude");
  const { view } = await start();
  await hover(view);
  const primary = findById(control(view), "usage-primary");
  assert.equal(lastCall(findById(primary, "usage-percent"), "text_color"), T.blocked);
  assert.equal(lastCall(findById(primary, "usage-fill"), "bg"), T.blocked);
  const texts = textsOf(primary);
  assert.ok(texts.indexOf("!") >= 0 && texts.indexOf("!") < texts.indexOf("93%"), "the mark is before the percent");
});

test("below 90 % there is no alert mark", async () => {
  claudePercent = 89;
  focusProgram("claude");
  const { view } = await start();
  await hover(view);
  assert.ok(!textsOf(control(view)).includes("!"));
});

test("AC-V3.2: the hover card has the timing, sits above the bar right-aligned and lists every installed provider, primary first, tagged focused pane", async () => {
  focusProgram("codex");
  const { view } = await start();
  await hover(view);
  const hc = hovercard(view);
  assert.equal(call(hc, "open_delay"), 0);
  assert.equal(call(hc, "close_delay"), 150);
  assert.equal(call(hc, "anchor"), "bottom_right");
  const content = call(hc, "content");
  const text = textsOf(content).join(" | ");
  assert.ok(text.indexOf("Codex") < text.indexOf("Claude Code") && text.indexOf("Claude Code") < text.indexOf("opencode"), text);
  assert.doesNotMatch(text, /Gemini/);
  assert.equal(text.split("focused pane").length - 1, 1);
  assert.ok(text.indexOf("Codex") < text.indexOf("focused pane") && text.indexOf("focused pane") < text.indexOf("Claude Code"));
  assert.match(text, /5 h \| 42%/);
  assert.match(text, /Last 7 days, no usage limits/);
  const tag = walk(content).find((n) => n.kids.includes("focused pane"));
  assert.equal(call(tag, "h"), 16);
  assert.equal(call(tag, "rounded"), RADIUS.control);
  assert.equal(lastCall(tag, "bg"), k.accentSoft);
  assert.equal(call(tag, "text_size"), 10);
});

test("with no focused provider the card lists the first provider first but has no focused pane tag", async () => {
  for (const setup of [() => { hooks.focused = null; }, () => focusProgram("zsh")]) {
    setup();
    const { view } = await start();
    await hover(view);
    const text = textsOf(call(hovercard(view), "content")).join(" | ");
    assert.ok(text.indexOf("Claude Code") >= 0 && text.indexOf("Claude Code") < text.indexOf("Codex"));
    assert.doesNotMatch(text, /focused pane/);
  }
});

test("V8: the Usage hover card is an overlay: RADIUS.overlay", async () => {
  const { view } = await start();
  assert.equal(call(call(hovercard(view), "content"), "rounded"), RADIUS.overlay);
});

test("the fetch rules hold: one fetch per provider on the first hover, none inside 5 minutes, none on leaving", async () => {
  const { view } = await start();
  hoverHandler(hovercard(view))(false);
  await settle();
  assert.equal(calls.length, 0);
  await hover(view);
  assert.deepEqual(calls.map(([c]) => c), ["/bin/sh", "/bin/sh", "opencode"]);
  await hover(view);
  assert.equal(calls.length, 3);
});

test("a click on the control also loads the readings", async () => {
  const { view } = await start();
  const c = control(view);
  assert.equal(typeof c.onClick, "function");
  c.onClick();
  await settle();
  assert.equal(calls.length, 3);
});

test("AC-V3.3: usageInStatus off removes the control and no fetch can start", async () => {
  state.shared["herdsidian.settings"] = { usageInStatus: false };
  const { view } = await start();
  const tree = view.render();
  assert.equal(findById(tree, "usage"), null);
  assert.equal(walk(tree).find((n) => n.kind === "hovercard"), undefined);
  await view.hoverUsage(true);
  await settle();
  assert.equal(calls.length, 0);
});

test("the status bar no longer shows the theme name", async () => {
  const { view } = await start();
  const tree = view.render();
  assert.equal(findById(tree, "theme-name"), null);
  assert.ok(!textsOf(tree).includes("hs_nord_theme"));
});

test("the Needs you pill keeps its kids and a ⌘J key cap follows it in a gap-4 wrapper", async () => {
  state.shared["herdsidian.settings"] = { keyHints: "always" };
  hooks.agents = [{ pane: "p1", status: "blocked" }];
  const { view } = await start();
  const tree = view.render();
  const pill = findById(tree, "status-needs");
  assert.equal(pill.kids.at(-1), "Needs you", "the label stays last in the pill");
  assert.ok(!textsOf(pill).includes("⌘J"), "the cap is not inside the pill");
  const wrapper = walk(tree).find((n) => n.kids.includes(pill));
  assert.equal(call(wrapper, "gap"), 4);
  assert.equal(wrapper.kids.indexOf(pill), 0);
  assert.deepEqual(textsOf(wrapper.kids[1]), ["⌘J"]);
  assert.equal(call(wrapper.kids[1], "h"), 18);
});

test("the key cap shows the bound chord when keys() has one", async () => {
  hooks.agents = [{ pane: "p1", status: "blocked" }];
  state.shared.layout = "herdsidian";
  state.shared["herdsidian.settings"] = { keyHints: "always" };
  hooks.keys = [{ section: "layout:herdsidian", action: "guide-agents.next-blocked", keys: "cmd-alt-j" }];
  const { view } = await start();
  const pill = findById(view.render(), "status-needs");
  const wrapper = walk(view.render()).find((n) => n.kids.some((x) => x?.nodeId === "status-needs"));
  assert.deepEqual(textsOf(wrapper.kids[1]), ["⌥⌘J"]);
  assert.ok(pill);
});

test("V5: keyHints decides the inline cap and the pill tooltip", async () => {
  hooks.agents = [{ pane: "p1", status: "blocked" }];
  const cases = { always: [true, true], modifier: [false, true], off: [false, false] };
  for (const [mode, [cap, tip]] of Object.entries(cases)) {
    state.shared["herdsidian.settings"] = { keyHints: mode };
    const { view } = await start();
    const tree = view.render();
    const pill = findById(tree, "status-needs");
    assert.equal(textsOf(tree).includes("⌘J"), cap, `${mode}: inline cap`);
    assert.equal(String(call(pill, "tooltip")).includes("⌘J"), tip, `${mode}: tooltip chord`);
  }
});

test("V5: the tooltip carries the bound chord when keys() has one", async () => {
  hooks.agents = [{ pane: "p1", status: "blocked" }];
  state.shared.layout = "herdsidian";
  hooks.keys = [{ section: "layout:herdsidian", action: "guide-agents.next-blocked", keys: "cmd-alt-j" }];
  const { view } = await start();
  assert.match(String(call(findById(view.render(), "status-needs"), "tooltip")), /⌥⌘J/);
});

test("turning usageInStatus on later loads the agents lazily, and nothing is fetched before a hover", async () => {
  state.shared["herdsidian.settings"] = { usageInStatus: false };
  focusProgram("codex");
  const { view } = await start();
  let asked = 0;
  hooks.knownAgents = async () => { asked++; return AGENTS; };
  view.render();
  await settle();
  assert.equal(asked, 0, "off: no agents asked");
  state.shared["herdsidian.settings"] = { usageInStatus: true };
  view.render();
  view.render();
  await settle();
  assert.equal(asked, 1, "on: asked once");
  assert.deepEqual(svgPaths(control(view)), ["icons/codex.svg", "icons/claude.svg", "icons/opencode.svg"]);
  assert.equal(calls.length, 0, "no security/curl/opencode before the first hover");
});

test("no pill and no key cap without a blocked agent", async () => {
  hooks.agents = [{ pane: "p1", status: "working" }];
  const { view } = await start();
  assert.equal(findById(view.render(), "status-needs"), null);
  assert.ok(!textsOf(view.render()).includes("⌘J"));
});
