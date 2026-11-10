import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  LIMITS, tier, rankNotes, rankAgents, rankCommands, paletteSettings, hasMod, agentHint, commandList,
  scene, autoFromIndex, autoMeta, isFreshRequest, buildList, relativeTime, breadcrumb, topFolder, topMeta,
  wrap, sendState, planSend, rankNoteRows, footer, visibleWindow, isShown, targetAgent, sameKey, rankKey, modelKey,
} from "../mods/herdsidian/palette.js";
import { formatChord, keyHint, readSettings, SETTING_DEFAULTS, settingSections } from "../lib/keys.js";
import * as paletteModule from "../mods/herdsidian/palette.js";
import { matchNotes, contextNotes, findEntry, autoLinks, deliveryText } from "../mods/herdsidian/context.js";
import { tokens } from "../mods/herdsidian/tokens.js";

const names = (list) => list.map((p) => p.replace(/\.md$/, ""));
const NOTES = ["Alpha.md", "a/Alpha Beta.md", "a/Beta Alpha.md", "b/alpha-two.md", "b/x_alpha.md", "b/x.alpha.md", "c/Notalphabet.md", "d/Gamma.md"];
const agent = (address, program, space, tab, title = "", extra = {}) => ({
  address, program: { name: program }, space_name: space, tab_name: tab, title, status: "idle", ...extra,
});
const BINDINGS = [
  { section: "global", keys: "cmd-l", action: "herdsidian.link" },
  { section: "layout:herdsidian", keys: "cmd-l", action: "herdsidian.link" },
  { section: "layout:other", keys: "cmd-j", action: "only.other" },
  { section: "global", keys: "cmd-shift-p", action: "app.palette" },
  { section: "layout:herdsidian", keys: "cmd-shift-o", action: "herdsidian-tabs.notes" },
  { section: "layout:herdsidian", keys: "cmd-alt-1", action: "guide-agents.focus-1" },
  { section: "layout:herdsidian", keys: "cmd-alt-2", action: "guide-agents.focus-2" },
];

// tier

test("tier ranks equals, prefix, word prefix and contains, ignoring case", () => {
  assert.equal(tier("Alpha", "alpha"), 0);
  assert.equal(tier("Alpha Beta", "ALPHA"), 1);
  assert.equal(tier("Beta Alpha", "alpha"), 2);
  assert.equal(tier("x-alpha", "alpha"), 2);
  assert.equal(tier("x_alpha", "alpha"), 2);
  assert.equal(tier("x.alpha", "alpha"), 2);
  assert.equal(tier("Notalphabet", "alpha"), 3);
  assert.equal(tier("Gamma", "alpha"), -1);
});

// rankNotes

test("rankNotes returns the same set as matchNotes for three queries", () => {
  for (const q of ["alpha", "BETA", "x"]) {
    assert.deepEqual(new Set(rankNotes(NOTES, q)), new Set(matchNotes(NOTES, q, Infinity)), q);
  }
});

test("rankNotes orders by tier: equals, prefix, word prefix, contains", () => {
  const got = rankNotes(["z/Notalphabet.md", "z/Beta Alpha.md", "z/Alpha Beta.md", "z/Alpha.md"], "alpha");
  assert.deepEqual(names(got), ["z/Alpha", "z/Alpha Beta", "z/Beta Alpha", "z/Notalphabet"]);
});

test("rankNotes treats a word after a dash, underscore or dot as a word prefix", () => {
  const got = rankNotes(["m/xalpha.md", "m/x.alpha.md", "m/x_alpha.md", "m/x-alpha.md"], "alpha");
  assert.deepEqual(got.slice(0, 3).sort(), ["m/x-alpha.md", "m/x.alpha.md", "m/x_alpha.md"]);
  assert.equal(got[3], "m/xalpha.md");
});

test("rankNotes puts linked notes first within a tier", () => {
  const got = rankNotes(["a/ab1.md", "b/ab2.md"], "ab", new Set(["b/ab2.md"]));
  assert.deepEqual(got, ["b/ab2.md", "a/ab1.md"]);
});

test("rankNotes puts the shorter name first when the tier and link are equal", () => {
  assert.deepEqual(rankNotes(["a/abcd.md", "b/abc.md"], "ab"), ["b/abc.md", "a/abcd.md"]);
});

test("rankNotes puts the path A to Z last", () => {
  assert.deepEqual(rankNotes(["b/abc.md", "a/abc.md"], "ab"), ["a/abc.md", "b/abc.md"]);
});

test("rankNotes ignores case and gives the same order twice", () => {
  const first = rankNotes(NOTES, "ALPHA");
  assert.deepEqual(first, rankNotes(NOTES, "alpha"));
  assert.deepEqual(first, rankNotes([...NOTES].reverse(), "alpha"));
});

// rankAgents / rankCommands

test("rankAgents matches program, space, tab and title", () => {
  const list = [agent("t1", "Claude", "work", "fix"), agent("t2", "zsh", "blog", "draft", "claude says hi")];
  assert.deepEqual(rankAgents(list, "claude").map((r) => r.agent.address), ["t1", "t2"]);
  assert.deepEqual(rankAgents(list, "blog").map((r) => r.agent.address), ["t2"]);
  assert.deepEqual(rankAgents(list, "fix").map((r) => r.agent.address), ["t1"]);
  assert.deepEqual(rankAgents(list, "nothing"), []);
});

test("rankAgents keeps the agents() order for an empty query", () => {
  const list = [agent("t2", "b", "s", "t"), agent("t1", "a", "s", "t")];
  assert.deepEqual(rankAgents(list, ""), [{ agent: list[0], tier: 0 }, { agent: list[1], tier: 0 }]);
});

test("rankAgents puts a name match before a title-only match", () => {
  const list = [agent("t1", "zsh", "s", "t", "claude notes"), agent("t2", "Claude", "s", "t")];
  const got = rankAgents(list, "claude");
  assert.deepEqual(got.map((r) => [r.agent.address, r.tier]), [["t2", 0], ["t1", 4]]);
});

test("rankAgents keeps the given order inside a tier", () => {
  const list = [agent("t1", "x", "work", "a"), agent("t2", "y", "work", "b")];
  assert.deepEqual(rankAgents(list, "work").map((r) => r.agent.address), ["t1", "t2"]);
});

test("rankCommands filters by label using the tiers", () => {
  const cmds = [{ id: "a", label: "Show Notes" }, { id: "b", label: "Choose vault…" }, { id: "c", label: "All Herdr commands…" }];
  assert.deepEqual(rankCommands(cmds, "notes").map((r) => [r.command.id, r.tier]), [["a", 2]]);
  assert.deepEqual(rankCommands(cmds, "all").map((r) => [r.command.id, r.tier]), [["c", 1]]);
  assert.deepEqual(rankCommands(cmds, "h").map((r) => [r.command.id, r.tier]), [["c", 2], ["a", 3], ["b", 3]]);
  assert.equal(rankCommands(cmds, "").length, 3);
});

// key hints

test("formatChord renders modifiers as symbols in the order control, option, shift, command", () => {
  assert.equal(formatChord("cmd-alt-1"), "⌥⌘1");
  assert.equal(formatChord("cmd-l"), "⌘L");
  assert.equal(formatChord("cmd-shift-o"), "⇧⌘O");
  assert.equal(formatChord("ctrl-cmd-alt-shift-k"), "⌃⌥⇧⌘K");
  assert.equal(formatChord("cmd-alt-["), "⌥⌘[");
});

test("keyHint prefers the layout section over global and ignores other sections", () => {
  const b = [
    { section: "global", keys: "cmd-g", action: "x.y" },
    { section: "layout:herdsidian", keys: "cmd-l", action: "x.y" },
    { section: "layout:other", keys: "cmd-o", action: "only.other" },
    { section: "mod:herdsidian", keys: "cmd-m", action: "only.mod" },
  ];
  assert.equal(keyHint(b, "x.y", "herdsidian"), "⌘L");
  assert.equal(keyHint([b[0]], "x.y", "herdsidian"), "⌘G");
  assert.equal(keyHint(b, "only.other", "herdsidian"), null);
  assert.equal(keyHint(b, "only.mod", "herdsidian"), null);
});

test("keyHint returns null for an unbound action or no list", () => {
  assert.equal(keyHint(BINDINGS, "nope", "herdsidian"), null);
  assert.equal(keyHint(undefined, "herdsidian.link", "herdsidian"), null);
});

test("hasMod finds a block with that mod in a nested layout tree", () => {
  const tree = { type: "row", children: [{ type: "column", children: [{ type: "block", content: { mod: "guide-agents" } }] }] };
  assert.equal(hasMod(tree, "guide-agents"), true);
  assert.equal(hasMod(tree, "herdsidian"), false);
  assert.equal(hasMod(null, "herdsidian"), false);
});

test("hasMod skips a hidden node and its whole subtree", () => {
  const agents = { type: "block", content: { mod: "guide-agents" } };
  const hiddenColumn = { type: "row", children: [{ type: "column", hidden: true, children: [agents] }] };
  assert.equal(hasMod(hiddenColumn, "guide-agents"), false);
  assert.equal(hasMod({ type: "block", hidden: true, content: { mod: "guide-agents" } }, "guide-agents"), false);
  const shown = { type: "row", children: [{ type: "column", hidden: false, children: [agents] }] };
  assert.equal(hasMod(shown, "guide-agents"), true);
});

test("isShown is true for a visible node, false for a hidden, hidden-ancestor or missing one", () => {
  const leaf = (hidden) => ({ id: "herdsidian", ...(hidden === undefined ? {} : { hidden }) });
  assert.equal(isShown({ type: "row", children: [{ type: "column", children: [leaf()] }] }, "herdsidian"), true);
  assert.equal(isShown({ type: "row", children: [leaf(false)] }, "herdsidian"), true);
  assert.equal(isShown({ type: "row", children: [leaf(true)] }, "herdsidian"), false);
  assert.equal(isShown({ type: "row", children: [{ type: "column", hidden: true, children: [leaf()] }] }, "herdsidian"), false);
  assert.equal(isShown({ type: "row", children: [{ id: "other" }] }, "herdsidian"), false);
  assert.equal(isShown(null, "herdsidian"), false);
});

test("targetAgent keeps the agent only inside its own space", () => {
  const a = { address: "t1", space: "s1" };
  assert.equal(targetAgent({ agent: a, spaceId: "s1" }), a);
  assert.equal(targetAgent({ agent: a, spaceId: "s2" }), null);
  assert.equal(targetAgent({ agent: null, spaceId: "s1" }), null);
  assert.equal(targetAgent({ spaceId: "s1" }), null);
});

test("rankKey ignores the agents and follows query, tab, notes and linked", () => {
  const notes = ["a.md"], linked = new Set();
  const base = { query: "q", tab: "all", notes, linked };
  assert.ok(sameKey(rankKey(base), rankKey({ ...base })));
  assert.ok(sameKey(rankKey(base), rankKey({ ...base, agents: [agent("t1", "Claude", "s", "t", "changed title")] })));
  assert.ok(!sameKey(rankKey(base), rankKey({ ...base, query: "r" })));
  assert.ok(!sameKey(rankKey(base), rankKey({ ...base, tab: "notes" })));
  assert.ok(!sameKey(rankKey(base), rankKey({ ...base, notes: [...notes] })));
  assert.ok(!sameKey(rankKey(base), rankKey({ ...base, linked: new Set() })));
});

test("modelKey is stable for the same inputs and changes with each input the list reads", () => {
  const inputs = () => ({
    query: "", tab: "all", notes: null, notesError: null, doc: {}, linking: null, starter: null,
    agents: [agent("t1", "Claude Code", "s", "t", "title")], order: ["t1"], layoutName: "herdsidian",
    bindings: [{ section: "global", action: "x", keys: "cmd-k" }], sidebarHidden: false, hasList: true,
  });
  const shared = { notes: null, doc: inputs().doc };
  const make = (over) => modelKey({ ...inputs(), ...shared, ...over });
  assert.ok(sameKey(make({}), make({})));
  assert.ok(!sameKey(make({}), make({ order: ["t2", "t1"] })));
  assert.ok(!sameKey(make({}), make({ bindings: [{ section: "global", action: "x", keys: "cmd-j" }] })));
  assert.ok(!sameKey(make({}), make({ layoutName: "other" })));
  assert.ok(!sameKey(make({}), make({ sidebarHidden: true })));
  assert.ok(sameKey(make({}), make({ notesHidden: true })), "notesHidden is no longer an input: sidebarHidden is");
  assert.ok(!sameKey(make({}), make({ agents: [agent("t1", "Claude Code", "s", "t", "new title")] })));
  assert.ok(!sameKey(make({}), make({ agents: [agent("t1", "Codex", "s", "t", "title")] })));
  assert.ok(!sameKey(make({}), make({ agents: [{ ...agent("t1", "Claude Code", "s", "t", "title"), program: { name: "Claude Code", key: "claude" } }] })));
  assert.ok(!sameKey(make({}), make({ agents: [{ ...agent("t1", "Claude Code", "s", "t", "title"), app: "node" }] })));
});

test("agentHint gives the key of the Nth agent", () => {
  assert.equal(agentHint("t2", ["t1", "t2"], BINDINGS, "herdsidian", true), "⌥⌘2");
});

test("agentHint gives nothing when the address is not in the list", () => {
  assert.equal(agentHint("t9", ["t1", "t2"], BINDINGS, "herdsidian", true), null);
});

test("agentHint gives nothing past 9, without a binding or without the agents list", () => {
  const order = Array.from({ length: 12 }, (_, i) => `t${i + 1}`);
  const many = [...BINDINGS, { section: "layout:herdsidian", keys: "cmd-alt-0", action: "guide-agents.focus-10" }];
  assert.equal(agentHint("t10", order, many, "herdsidian", true), null);
  assert.equal(agentHint("t3", order, BINDINGS, "herdsidian", true), null);
  assert.equal(agentHint("t1", order, BINDINGS, "herdsidian", false), null);
  assert.equal(agentHint("t1", undefined, BINDINGS, "herdsidian", true), null);
});

// commandList

const SPACE = { id: "s1", name: "work", folder: "/r/work" };
const STARTER = { name: "Claude Code", run: ["claude"] };
const cmdArgs = (extra) => ({ vault: "/v", sidebarHidden: false, sidebarTab: "notes", space: SPACE, starter: STARTER, bindings: BINDINGS, layoutName: "herdsidian", ...extra });

test("commandList has exactly the five command kinds", () => {
  const ids = [
    ...commandList(cmdArgs({})).map((c) => c.id),
    ...commandList(cmdArgs({ vault: null })).map((c) => c.id),
  ];
  assert.deepEqual([...new Set(ids)].sort(), ["herdr", "link", "new-agent", "notes", "vault"]);
});

test("commandList offers Choose vault only with no vault", () => {
  assert.equal(commandList(cmdArgs({})).some((c) => c.id === "vault"), false);
  const none = commandList(cmdArgs({ vault: null }));
  assert.deepEqual(none.find((c) => c.id === "vault").action, { type: "request", op: "choose-vault" });
});

test("commandList offers Link only with a vault and a space", () => {
  const has = (args) => commandList(cmdArgs(args)).some((c) => c.id === "link");
  assert.equal(has({}), true);
  assert.equal(has({ vault: null }), false);
  assert.equal(has({ space: null }), false);
  assert.deepEqual(commandList(cmdArgs({})).find((c) => c.id === "link").action, { type: "link" });
  assert.equal(commandList(cmdArgs({})).find((c) => c.id === "link").hint, "⌘L");
});

test("commandList names the new agent row after the starter and space, with no hint", () => {
  const row = commandList(cmdArgs({})).find((c) => c.id === "new-agent");
  assert.equal(row.label, "New Claude Code in work");
  assert.equal(row.hint, null);
  assert.deepEqual(row.action, { type: "run", name: "tab.new", args: { space: "s1", argv: ["claude"] } });
  assert.equal(commandList(cmdArgs({ starter: null })).some((c) => c.id === "new-agent"), false);
});

test("commandList runs herdsidian-tabs.notes, labelled Hide Notes only when the sidebar is shown on its Notes tab", () => {
  const hide = commandList(cmdArgs({})).find((c) => c.id === "notes");
  assert.equal(hide.label, "Hide Notes");
  assert.equal(hide.hint, "⇧⌘O");
  assert.deepEqual(hide.action, { type: "run", name: "herdsidian-tabs.notes", args: {} });
  const label = (extra) => commandList(cmdArgs(extra)).find((c) => c.id === "notes").label;
  assert.equal(label({ sidebarHidden: true }), "Show Notes");
  assert.equal(label({ sidebarHidden: true, sidebarTab: "notes" }), "Show Notes");
  assert.equal(label({ sidebarTab: "files" }), "Show Notes");
  assert.equal(label({ sidebarTab: "settings" }), "Show Notes");
});

test("commandList runs Herdr's own palette for All Herdr commands", () => {
  const row = commandList(cmdArgs({})).find((c) => c.id === "herdr");
  assert.equal(row.action.name, "app.palette");
  assert.equal(row.action.type, "run");
  assert.equal(row.hint, "⇧⌘P");
});

test("commandList labels follow the same tier filter as notes", () => {
  const ranked = rankCommands(commandList(cmdArgs({})), "notes");
  assert.deepEqual(ranked.map((r) => [r.command.id, r.tier]), [["notes", 2]]);
});

// buildList

const LIST = ["01-Projects/Alpha.md", "01-Projects/Beta Alpha.md", "Daily.md", "Z/Notalphabet.md"];
const AGENTS = [agent("t1", "Claude", "work", "fix", "writing alpha"), agent("t2", "zsh", "blog", "draft")];
const base_ = () => ({
  query: "", tab: "all", vault: "/v", notes: LIST, notesError: null, linked: new Set(), contextPaths: [],
  agents: AGENTS, commands: commandList(cmdArgs({})), hintFor: (a) => (a === "t1" ? "⌥⌘1" : null),
});
const sectionOf = (model, kind) => model.sections.find((s) => s.kind === kind);

test("buildList gives the top hit as the first row of the merged list and removes it from its section", () => {
  const m = buildList({ ...base_(), query: "alpha" });
  assert.equal(m.top.key, "note:01-Projects/Alpha.md");
  assert.equal(sectionOf(m, "notes").rows.some((r) => r.key === m.top.key), false);
  assert.equal(m.pickable[0], m.top);
});

test("buildList breaks a tier tie by kind: note, then agent, then command", () => {
  const same = {
    ...base_(), query: "work", notes: ["work.md"],
    agents: [agent("t1", "work", "s", "t")], commands: [{ id: "x", label: "work", hint: null, action: { type: "link" } }],
  };
  assert.equal(buildList(same).top.kind, "note");
  assert.equal(buildList({ ...same, notes: [] }).top.kind, "agent");
  assert.equal(buildList({ ...same, notes: [], agents: [] }).top.kind, "command");
});

test("buildList has no top hit for an empty query or when nothing matches", () => {
  assert.equal(buildList(base_()).top, null);
  const none = buildList({ ...base_(), query: "qqqq" });
  assert.equal(none.top, null);
  assert.equal(none.empty, 'No matches for "qqqq"');
  assert.deepEqual(none.pickable, []);
});

test("buildList with no vault has no Notes section and no note top hit", () => {
  const m = buildList({ ...base_(), vault: null, notes: null, query: "alpha", commands: commandList(cmdArgs({ vault: null })) });
  assert.equal(sectionOf(m, "notes"), undefined);
  assert.notEqual(m.top?.kind, "note");
  assert.equal(m.pickable.some((r) => r.kind === "note"), false);
  assert.equal(m.empty, null);
});

test("buildList with an empty query shows up to 4 agents, up to 6 context notes and the commands", () => {
  const many = Array.from({ length: 6 }, (_, i) => agent(`a${i}`, "p", "s", "t"));
  const ctx = Array.from({ length: 8 }, (_, i) => `n${i}.md`);
  const m = buildList({ ...base_(), agents: many, notes: ctx, contextPaths: ctx });
  assert.equal(sectionOf(m, "agents").rows.length, LIMITS.agents);
  assert.deepEqual(sectionOf(m, "notes").rows.map((r) => r.path), ctx.slice(0, 6));
  assert.deepEqual(sectionOf(m, "commands").rows.map((r) => r.key), base_().commands.map((c) => `command:${c.id}`));
  assert.equal(m.top, null);
});

test("buildList with an empty query and no context notes has no Notes section", () => {
  assert.equal(sectionOf(buildList(base_()), "notes"), undefined);
});

test("buildList says No matches for the query", () => {
  assert.equal(buildList({ ...base_(), query: "zzzz" }).empty, 'No matches for "zzzz"');
  assert.equal(buildList({ ...base_(), query: "alpha" }).empty, null);
});

test("buildList hides the Agents section in All when there are no agents", () => {
  const m = buildList({ ...base_(), agents: [] });
  assert.equal(sectionOf(m, "agents"), undefined);
});

test("buildList on the Agents tab with no agents says so and still offers New agent", () => {
  const m = buildList({ ...base_(), tab: "agents", agents: [] });
  assert.deepEqual(sectionOf(m, "agents").message, { text: "No agents running", tone: "muted" });
  assert.deepEqual(sectionOf(m, "commands").rows.map((r) => r.key), ["command:new-agent"]);
  assert.equal(m.empty, null);
});

test("buildList shows Loading notes when the list is null while agents and commands are listed", () => {
  const m = buildList({ ...base_(), notes: null, query: "work" });
  assert.deepEqual(sectionOf(m, "notes").message, { text: "Loading notes…", tone: "muted" });
  assert.equal(m.pickable.some((r) => r.kind === "agent"), true);
  assert.equal(m.empty, null);
});

test("buildList shows a note-list error in the Notes section as blocked", () => {
  const m = buildList({ ...base_(), notesError: "Cannot list the vault", query: "work" });
  assert.deepEqual(sectionOf(m, "notes").message, { text: "Cannot list the vault", tone: "blocked" });
  assert.equal(m.pickable.some((r) => r.kind === "agent"), true);
  assert.equal(sectionOf(m, "notes").rows.length, 0);
});

test("buildList All limits are 1 top hit, 4 agents, 6 notes and 4 commands", () => {
  const notes = Array.from({ length: 20 }, (_, i) => `q${i}.md`);
  const agents = Array.from({ length: 10 }, (_, i) => agent(`a${i}`, "q", "s", "t"));
  const commands = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, label: `q ${i}`, hint: null, action: { type: "link" } }));
  const m = buildList({ ...base_(), query: "q", notes, agents, commands });
  assert.ok(m.top);
  assert.equal(sectionOf(m, "agents").rows.length, 4);
  assert.equal(sectionOf(m, "notes").rows.length, 6);
  assert.equal(sectionOf(m, "commands").rows.length, 4);
  assert.equal(m.pickable.length, 15);
});

test("buildList single-kind tabs hold up to 50 rows and no top hit", () => {
  const notes = Array.from({ length: 80 }, (_, i) => `q${i}.md`);
  const agents = Array.from({ length: 80 }, (_, i) => agent(`a${i}`, "q", "s", "t"));
  const m = buildList({ ...base_(), tab: "notes", query: "q", notes });
  assert.equal(m.top, null);
  assert.equal(m.sections.length, 1);
  assert.equal(m.sections[0].rows.length, LIMITS.single);
  assert.equal(buildList({ ...base_(), tab: "agents", query: "q", agents }).sections[0].rows.length, LIMITS.single);
});

test("buildList Notes tab with an empty query lists context notes first, then the rest A to Z", () => {
  const m = buildList({ ...base_(), tab: "notes", contextPaths: ["Z/Notalphabet.md"] });
  assert.deepEqual(m.sections[0].rows.map((r) => r.path), ["Z/Notalphabet.md", ...LIST.filter((p) => p !== "Z/Notalphabet.md")]);
});

test("buildList agent rows carry the hint from hintFor and the title as detail", () => {
  const row = buildList({ ...base_(), tab: "agents" }).sections[0].rows[0];
  assert.equal(row.hint, "⌥⌘1");
  assert.equal(row.detail, "writing alpha");
  assert.equal(row.key, "agent:t1");
});

test("buildList uses rankedNotes when given and gives the same list as ranking itself", () => {
  const input = { ...base_(), tab: "notes", query: "daily" };
  const own = buildList(input);
  const rankedNotes = rankNoteRows(input.notes, input.query, input.linked);
  assert.deepEqual(buildList({ ...input, rankedNotes }), own);
  const fake = [{ key: "note:Fake.md", kind: "note", label: "Fake", detail: "", hint: null, tier: 0, path: "Fake.md" }];
  assert.equal(buildList({ ...input, rankedNotes: fake }).sections[0].rows[0].key, "note:Fake.md");
});

test("buildList note rows carry the name and the top folder", () => {
  const row = buildList({ ...base_(), tab: "notes", query: "daily" }).sections[0].rows[0];
  assert.deepEqual([row.key, row.label, row.detail], ["note:Daily.md", "Daily", ""]);
  assert.equal(buildList({ ...base_(), tab: "notes", query: "beta" }).sections[0].rows[0].detail, "01-Projects");
});

// scene

test("scene gives the same context set as contextNotes on the same inputs", () => {
  const all = ["Work.md", "Auto.md", "Other.md", "Gone.md"];
  const doc = { version: 1, spaces: [{ space: "s1", name: "work", folder: "/r/work", vault: "/v", notes: ["Work.md", "Missing.md"], excluded: [], agents: { t1: ["Other.md"] } }] };
  const auto = { vault: "/v", notes: { "Auto.md": ["~/proj"] } };
  const target = { agent: { address: "t1" }, space: SPACE, liveIds: ["s1"] };
  const got = scene({ doc, target, vault: "/v", cwd: "/h/proj/sub", auto, all, home: "/h" });
  const where = { space: "s1", name: "work", folder: "/r/work", vault: "/v", address: "t1" };
  const want = contextNotes(findEntry(doc, where, ["s1"]), "t1", autoLinks(autoMeta(auto, "/v"), "/h/proj/sub", "/h"), new Set(all)).map((n) => n.path);
  assert.deepEqual(got.contextPaths, want);
  assert.deepEqual(want, ["Work.md", "Other.md", "Auto.md"]);
  assert.deepEqual(got.linked, new Set(want));
  assert.equal(got.where.address, "t1");
});

test("scene has no context without a vault or a space", () => {
  const doc = { version: 1, spaces: [] };
  assert.deepEqual(scene({ doc, target: { agent: null, space: null }, vault: null, cwd: null, auto: null, all: [], home: "/h" }).contextPaths, []);
});

test("autoMeta gives an empty Map when the vault differs", () => {
  const value = { vault: "/v", notes: { "a.md": ["~/x"] } };
  assert.equal(autoMeta(value, "/other").size, 0);
  assert.equal(autoMeta(null, "/v").size, 0);
  assert.deepEqual(autoMeta(value, "/v").get("a.md"), { herdsidian: ["~/x"] });
});

test("autoFromIndex keeps only non-empty herdsidian lists, at most 200", () => {
  const meta = new Map([["none.md", {}], ["empty.md", { herdsidian: [] }], ["ok.md", { herdsidian: ["~/x"] }]]);
  assert.deepEqual(autoFromIndex(meta, "/v"), { vault: "/v", notes: { "ok.md": ["~/x"] } });
  const big = new Map(Array.from({ length: 300 }, (_, i) => [`n${i}.md`, { herdsidian: ["~/x"] }]));
  assert.equal(Object.keys(autoFromIndex(big, "/v").notes).length, 200);
});

test("isFreshRequest accepts a request under 5 seconds old only", () => {
  assert.equal(isFreshRequest({ at: 10_000 }, 12_000), true);
  assert.equal(isFreshRequest({ at: 10_000 }, 15_000), false);
  assert.equal(isFreshRequest({ at: 10_000 }, 9_000), false);
  assert.equal(isFreshRequest(null, 1), false);
  assert.equal(isFreshRequest({ at: 10_000 }, 20_000, 20_000), true);
});

// time and paths

test("relativeTime switches at 60 seconds, 60 minutes, 24 hours and 48 hours", () => {
  const now = new Date(2026, 9, 31, 12, 0, 0).getTime();
  const ago = (ms) => relativeTime(now - ms, now);
  assert.equal(ago(59_000), "just now");
  assert.equal(ago(60_000), "1m ago");
  assert.equal(ago(59 * 60_000), "59m ago");
  assert.equal(ago(60 * 60_000), "1h ago");
  assert.equal(ago(23 * 3_600_000), "23h ago");
  assert.equal(ago(24 * 3_600_000), "yesterday");
  assert.equal(ago(47 * 3_600_000), "yesterday");
  assert.equal(ago(72 * 3_600_000), "2026-10-28");
});

test("breadcrumb joins the folders and is empty at the root", () => {
  assert.equal(breadcrumb("01-Projects/NVSinner/Plan.md"), "01-Projects / NVSinner");
  assert.equal(breadcrumb("Plan.md"), "");
  assert.equal(topFolder("01-Projects/NVSinner/Plan.md"), "01-Projects");
  assert.equal(topFolder("Plan.md"), "");
});

test("topMeta leaves empty parts out", () => {
  const now = 10_000_000;
  assert.equal(
    topMeta({ path: "A/B/n.md", linkedTo: "work", mtime: now - 120_000, now }),
    "A / B · linked to work · edited 2m ago",
  );
  assert.equal(topMeta({ path: "n.md", linkedTo: null, mtime: null, now }), "");
  assert.equal(topMeta({ path: "A/n.md", linkedTo: null, mtime: now, now }), "A · edited just now");
});

test("wrap moves around both ends and gives 0 for no rows", () => {
  assert.equal(wrap(2, 1, 3), 0);
  assert.equal(wrap(0, -1, 3), 2);
  assert.equal(wrap(1, 1, 3), 2);
  assert.equal(wrap(0, 1, 0), 0);
});

// sendState and footer

const NOTE_ROW = { kind: "note", path: "My Note.md" };
const send = (extra) => sendState({ row: NOTE_ROW, target: { address: "t1" }, space: SPACE, vault: "/v", sending: false, ...extra });

test("sendState allows a note with an agent, a local space and a vault", () => {
  assert.deepEqual(send({}), { ok: true, reason: null });
});

test("sendState explains each blocked case", () => {
  assert.deepEqual(send({ target: null }), { ok: false, reason: "No agent focused" });
  assert.deepEqual(send({ space: { ...SPACE, machine: "vps" } }), { ok: false, reason: "Vault paths are local to this Mac" });
  assert.equal(send({ vault: null }).ok, false);
  assert.equal(send({ vault: null }).reason, "Choose a vault first");
  assert.deepEqual(send({ row: { kind: "agent" } }), { ok: false, reason: "Pick a note to send" });
  assert.deepEqual(send({ row: null }), { ok: false, reason: "Pick a note to send" });
  assert.deepEqual(send({ sending: true }), { ok: false, reason: "Sending…" });
});

test("sendState and deliveryText agree: the text for the row has no line break and is quoted for a space", () => {
  const { text } = deliveryText([NOTE_ROW.path], "/v", { app: "zsh", program: { key: "zsh" } });
  assert.equal(text, '"/v/My Note.md" ');
  assert.equal(/[\r\n]/.test(text), false);
});

const PLAN_ROW = { kind: "note", path: "My Note.md", label: "My Note" };
const plan = (extra) => {
  const calls = { closed: 0, paths: [] };
  const deliver = (paths, vault, target) => { calls.paths.push(paths); return deliveryText(paths, vault, target); };
  const result = planSend({
    row: PLAN_ROW, target: { address: "t1", program: { name: "claude", key: "claude" } }, space: SPACE, vault: "/v",
    mtime: undefined, checking: false, dead: false, close: () => { calls.closed++; }, deliver, ...extra,
  });
  return { result, calls };
};

test("planSend asks for the note time first when Send is allowed", () => {
  assert.deepEqual(plan({}).result, { type: "stat" });
});

test("planSend blocks a second send while one is checking", () => {
  assert.deepEqual(plan({ checking: true }).result, { type: "blocked", reason: "Sending…" });
  assert.equal(plan({ sending: true }).result.type, "blocked");
});

test("planSend blocks what sendState blocks", () => {
  assert.deepEqual(plan({ target: null }).result, { type: "blocked", reason: "No agent focused" });
  assert.equal(plan({ row: { kind: "agent" } }).result.reason, "Pick a note to send");
});

test("planSend gives the not-found toast and nothing to copy when the note time is null", () => {
  const { result, calls } = plan({ mtime: null });
  assert.deepEqual(result, { type: "toast", title: "Note not found: My Note", level: "warning" });
  assert.deepEqual(calls.paths, []);
});

test("planSend does nothing when the popup closed after the note time", () => {
  const { result, calls } = plan({ mtime: 1000, dead: true });
  assert.deepEqual(result, { type: "stop" });
  assert.deepEqual(calls.paths, []);
});

test("planSend sends exactly one path and closes on done", () => {
  const { result, calls } = plan({ mtime: 1000 });
  assert.equal(result.type, "send");
  assert.deepEqual(calls.paths, [["My Note.md"]]);
  assert.equal(result.text, deliveryText(["My Note.md"], "/v", { address: "t1", program: { name: "claude", key: "claude" } }).text);
  assert.equal(result.address, "t1");
  assert.equal(result.name, "claude");
  result.onDone(false);
  assert.equal(calls.closed, 1);
  result.onDone(true);
  assert.equal(calls.closed, 1);
});

test("planSend toasts when the delivery text is empty", () => {
  const { result } = plan({ mtime: 1000, deliver: () => ({ text: "", skipped: 1, overflow: 0 }) });
  assert.deepEqual(result, { type: "toast", title: "Nothing to send +1 not sent", level: "warning" });
});

test("footer shows each key, with the reason on the inactive Send", () => {
  const f = footer({ row: NOTE_ROW, send: { ok: false, reason: "No agent focused" }, preview: { supported: true } });
  assert.deepEqual(f.map((k) => k.keys), ["↵", "⌘↵", "⇥", "esc"]);
  assert.deepEqual(f[1], { keys: "⌘↵", label: "Send to agent", active: false, reason: "No agent focused" });
  assert.equal(f[2].active, true);
});

test("footer leaves out the preview key when it is not supported and marks it inactive off a note", () => {
  assert.deepEqual(footer({ row: NOTE_ROW, send: { ok: true, reason: null }, preview: { supported: false } }).map((k) => k.keys), ["↵", "⌘↵", "esc"]);
  const f = footer({ row: { kind: "command" }, send: { ok: false, reason: "Pick a note to send" }, preview: { supported: true } });
  assert.equal(f.find((k) => k.keys === "⇥").active, false);
  assert.equal(f[0].label, "Run");
});

// visibleWindow

test("visibleWindow keeps the selected row in view", () => {
  const heights = Array(30).fill(32);
  const down = visibleWindow(heights, 0, 320, 2, 20);
  assert.equal(down.scroll, 21 * 32 - 320);
  const up = visibleWindow(heights, 600, 320, 2, 3);
  assert.equal(up.scroll, 3 * 32);
  assert.equal(visibleWindow(heights, 0, 320, 2, 0).scroll, 0);
});

test("visibleWindow bounds the rows to the viewport plus the margin", () => {
  const heights = Array(100).fill(32);
  const w = visibleWindow(heights, 640, 320, 2);
  assert.equal(w.total, 3200);
  assert.equal(w.tops[10], 320);
  assert.equal(w.first, 20 - 2);
  assert.equal(w.last, 29 + 2);
  assert.ok(w.last - w.first + 1 <= Math.ceil(320 / 32) + 1 + 2 * 2);
});

test("visibleWindow clamps the scroll and handles no rows", () => {
  assert.equal(visibleWindow(Array(5).fill(32), 999, 320).scroll, 0);
  assert.equal(visibleWindow(Array(20).fill(32), 9999, 320).scroll, 20 * 32 - 320);
  assert.deepEqual(visibleWindow([], 50, 320), { first: 0, last: -1, tops: [], total: 0, scroll: 0 });
});

// performance (AC37)

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const timeIt = (fn) => {
  const runs = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    fn();
    runs.push(performance.now() - t0);
  }
  return median(runs);
};
const BIG = Array.from({ length: 5000 }, (_, i) => `folder-${i % 40}/sub${i % 7}/Note ${i} alpha-${i % 13}.md`);

test("rankNotes on 5,000 notes takes at most 10 ms (median of 20 runs)", () => {
  const ms = timeIt(() => rankNotes(BIG, "alpha", new Set(BIG.slice(0, 5))));
  console.log(`rankNotes 5000 notes: median ${ms.toFixed(2)} ms`);
  assert.ok(ms <= 10, `median ${ms} ms`);
});

test("buildList for the All tab on 5,000 notes takes at most 10 ms (median of 20 runs)", () => {
  const input = { ...base_(), query: "alpha", notes: BIG };
  const ms = timeIt(() => buildList(input));
  console.log(`buildList All 5000 notes: median ${ms.toFixed(2)} ms`);
  assert.ok(ms <= 10, `median ${ms} ms`);
});

// contrast (AC30)

const channel = (hex, at) => {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const over = (top, bottom) => {
  const a = parseInt(top.slice(7, 9), 16) / 255;
  const mix = (at) => Math.round(parseInt(top.slice(at, at + 2), 16) * a + parseInt(bottom.slice(at, at + 2), 16) * (1 - a));
  return "#" + [1, 3, 5].map((at) => mix(at).toString(16).padStart(2, "0")).join("");
};

const THEMES = readdirSync(new URL("../themes/", import.meta.url)).filter((f) => /^hs_.*\.json$/.test(f));

test("there are 8 hs_ themes to check", () => {
  assert.equal(THEMES.length, 8);
});

for (const file of THEMES) {
  const theme = JSON.parse(readFileSync(new URL(`../themes/${file}`, import.meta.url), "utf8"));
  const { popover, muted, blocked } = theme.colors;
  const fg = theme.foreground;
  const k = tokens({ foreground: fg, ...theme.colors });

  test(`${file}: foreground and muted reach 4.5:1 on the popover`, () => {
    assert.ok(ratio(fg, popover) >= 4.5, `foreground ${ratio(fg, popover).toFixed(2)}`);
    assert.ok(ratio(muted, popover) >= 4.5, `muted ${ratio(muted, popover).toFixed(2)}`);
  });

  test(`${file}: foreground on the selected-row fill reaches 4.5:1`, () => {
    const fill = over(k.accentSoft, popover);
    assert.ok(ratio(fg, fill) >= 4.5, `foreground on accentSoft ${ratio(fg, fill).toFixed(2)}`);
  });

  test(`${file}: blocked text reaches 4.5:1 on the popover`, () => {
    assert.ok(ratio(blocked, popover) >= 4.5, `blocked ${ratio(blocked, popover).toFixed(2)}`);
  });

  test(`${file}: key cap text (muted) reaches 3:1 on the popover`, () => {
    assert.ok(ratio(muted, popover) >= 3, `muted ${ratio(muted, popover).toFixed(2)}`);
  });
}

import { rankNotesTiered, spaceWhere } from "../mods/herdsidian/palette.js";

test("rankNotesTiered keeps the rankNotes order and carries the tier rankNoteRows uses", () => {
  const notes = ["z/Notalphabet.md", "z/Beta Alpha.md", "z/Alpha Beta.md", "z/Alpha.md"];
  const tiered = rankNotesTiered(notes, "alpha");
  assert.deepEqual(tiered.map((r) => r.path), rankNotes(notes, "alpha"));
  assert.deepEqual(tiered.map((r) => r.tier), [0, 1, 2, 3]);
  assert.deepEqual(rankNoteRows(notes, " alpha ", new Set()).map((r) => [r.path, r.tier]), tiered.map((r) => [r.path, r.tier]));
});

test("spaceWhere builds the write target, with the address only for an agent, and null without space or vault", () => {
  const space = { id: "s1", name: "work", folder: "/r/work", extra: 1 };
  assert.deepEqual(spaceWhere(space, "/v", { address: "t1" }), { space: "s1", name: "work", folder: "/r/work", vault: "/v", address: "t1" });
  assert.deepEqual(spaceWhere(space, "/v", null), { space: "s1", name: "work", folder: "/r/work", vault: "/v" });
  assert.equal(spaceWhere(null, "/v", null), null);
  assert.equal(spaceWhere(space, null, null), null);
});

// The settings store's values (lib/keys.js readSettings) and the palette's Settings tab

test("readSettings fills the v2 defaults and ignores unknown or mistyped values", () => {
  assert.deepEqual(SETTING_DEFAULTS, { keyHints: "modifier", usageInStatus: true });
  assert.deepEqual(readSettings(undefined), { keyHints: "modifier", usageInStatus: true });
  assert.deepEqual(readSettings(null), { keyHints: "modifier", usageInStatus: true });
  assert.deepEqual(readSettings("on"), { keyHints: "modifier", usageInStatus: true });
  assert.deepEqual(readSettings({ keyHints: "no", usageInStatus: "yes", other: 1 }), { keyHints: "modifier", usageInStatus: true });
});

const sidebarInputs = (over = {}) => ({
  settings: readSettings(undefined), sidebarHidden: false, sidebarRail: false, sidebarTab: "settings", ...over,
});

test("the palette has no settingSections of its own: it uses lib/keys.js", () => {
  assert.equal(paletteModule.settingSections, undefined);
  const s = settingSections(sidebarInputs());
  assert.deepEqual(s.map((sec) => sec.title), ["General", "Layout"]);
  assert.deepEqual(s[0].rows.map((r) => [r.id, r.detail]), [["key-hints", "On hover"]]);
  assert.deepEqual(s[1].rows.map((r) => r.id), ["right-sidebar", "sidebar-tab", "sidebar-width", "usage-in-status"]);
});

test("paletteSettings puts the Theme section, then Appearance, before the shared sections", () => {
  const sections = paletteSettings(sidebarInputs());
  assert.deepEqual(sections.map((sec) => sec.title), ["Theme", "Appearance", "General", "Layout"]);
  assert.deepEqual(sections[0].rows.map((r) => [r.id, r.label]),
    [["theme-carbon", "Carbon"], ["theme-midnight", "Midnight"], ["theme-catppuccin", "Catppuccin"], ["theme-nord", "Nord"]]);
  assert.deepEqual(sections[0].rows.map((r) => r.action), ["carbon", "midnight", "catppuccin", "nord"].map((family) => ({ type: "theme", family })));
  assert.deepEqual(sections.slice(2), settingSections(sidebarInputs()));
});

test("the Appearance row names the setting and where it is set; unreadable gives no value", () => {
  const detail = (appearance) => paletteSettings(sidebarInputs({ appearance }))[1].rows[0].detail;
  assert.equal(detail("dark"), "Dark · set in Herdr Settings ↗");
  assert.equal(detail("light"), "Light · set in Herdr Settings ↗");
  assert.equal(detail("system"), "System · set in Herdr Settings ↗");
  assert.equal(detail(null), "set in Herdr Settings ↗");
  assert.equal(detail(undefined), "set in Herdr Settings ↗");
  const [row] = paletteSettings(sidebarInputs())[1].rows;
  assert.equal(row.id, "appearance");
  assert.equal(row.label, "Light / dark");
  assert.deepEqual(row.action, { type: "run", name: "app.settings", args: { section: "look" } });
});

const HS = ["carbon", "midnight", "catppuccin", "nord"].flatMap((f, i) => [
  { name: `hs_${f}`, colors: { chrome: `c${i}d`, canvas: `v${i}d`, accent: `a${i}d`, foreground: `f${i}d` } },
  { name: `hs_${f}_light`, colors: { chrome: `c${i}l`, canvas: `v${i}l`, accent: `a${i}l`, foreground: `f${i}l` } },
]);

test("each theme row carries the dark and light colors of its family from themes(), and a check on the current one", () => {
  const rows = paletteSettings(sidebarInputs({ themes: HS, family: "midnight" }))[0].rows;
  assert.deepEqual(rows.map((r) => r.selected), [false, true, false, false]);
  assert.equal(rows[1].swatch.dark.to, "v1d");
  assert.equal(rows[1].swatch.dark.dot, "a1d");
  assert.equal(rows[1].swatch.light.to, "v1l");
  assert.equal(rows[1].swatch.light.dot, "a1l");
  assert.equal(rows[3].swatch.dark.to, "v3d");
  const none = paletteSettings(sidebarInputs({ themes: HS, family: null }))[0].rows;
  assert.deepEqual(none.map((r) => r.selected), [false, false, false, false]);
});

test("buildList's Settings tab lists the Theme rows, Appearance and the shared rows, filtered by label", () => {
  const settings = paletteSettings(sidebarInputs());
  const all = buildList({ ...base_(), tab: "settings", settings });
  assert.equal(all.top, null);
  assert.deepEqual(all.sections.map((sec) => sec.title), ["Theme", "Appearance", "General", "Layout"]);
  assert.deepEqual(all.pickable.map((r) => r.key),
    ["setting:theme-carbon", "setting:theme-midnight", "setting:theme-catppuccin", "setting:theme-nord", "setting:appearance",
      "setting:key-hints", "setting:right-sidebar", "setting:sidebar-tab", "setting:sidebar-width", "setting:usage-in-status"]);
  assert.ok(all.pickable.every((r) => r.kind === "setting"));
  const width = buildList({ ...base_(), tab: "settings", settings, query: "width" });
  assert.deepEqual(width.pickable.map((r) => r.key), ["setting:sidebar-width"]);
  assert.deepEqual(width.sections.map((sec) => sec.title), ["Layout"]);
  const none = buildList({ ...base_(), tab: "settings", settings, query: "zzz" });
  assert.equal(none.empty, 'No matches for "zzz"');
  assert.equal(buildList({ ...base_(), tab: "all", settings }).pickable.some((r) => r.kind === "setting"), false);
});

test("the Appearance row is the only palette settings row that closes the palette", () => {
  const rows = paletteSettings(sidebarInputs()).flatMap((sec) => sec.rows);
  assert.deepEqual(rows.filter((r) => r.closes).map((r) => r.id), ["appearance"]);
  assert.ok(!rows.some((r) => r.id === "theme" || r.label === "Theme…"));
});

test("modelKey changes with the sidebar's hidden, rail and tab, with the settings, and with the theme inputs", () => {
  const base = { query: "", tab: "settings", notes: null, notesError: null, doc: {}, linking: null, starter: null,
    agents: [], order: [], layoutName: "herdsidian", bindings: [], hasList: true };
  const make = (over) => modelKey({ ...base, settings: readSettings(undefined), sidebarHidden: false, sidebarRail: false, sidebarTab: "notes", ...over });
  assert.ok(sameKey(make({}), make({})));
  assert.ok(!sameKey(make({}), make({ sidebarHidden: true })));
  assert.ok(!sameKey(make({}), make({ sidebarRail: true })));
  assert.ok(!sameKey(make({}), make({ sidebarTab: "settings" })));
  assert.ok(!sameKey(make({}), make({ settings: readSettings({ keyHints: "always" }) })));
  assert.ok(!sameKey(make({}), make({ settings: readSettings({ usageInStatus: false }) })));
  assert.ok(sameKey(make({ family: "nord", appearance: "dark" }), make({ family: "nord", appearance: "dark" })));
  assert.ok(!sameKey(make({}), make({ family: "nord" })));
  assert.ok(!sameKey(make({ family: "nord" }), make({ family: "carbon" })));
  assert.ok(!sameKey(make({}), make({ appearance: "light" })));
  assert.ok(!sameKey(make({ appearance: "dark" }), make({ appearance: "light" })));
});

test("modelKey no longer reads filesHidden or changesHidden", () => {
  const base = { query: "", tab: "settings", notes: null, notesError: null, doc: {}, linking: null, starter: null,
    agents: [], order: [], layoutName: "herdsidian", bindings: [], hasList: true };
  assert.ok(sameKey(modelKey({ ...base, filesHidden: true }), modelKey({ ...base, filesHidden: false })));
  assert.ok(sameKey(modelKey({ ...base, changesHidden: true }), modelKey({ ...base, changesHidden: false })));
});

test("footer names the Enter action Change on a setting", () => {
  assert.equal(footer({ row: { kind: "setting" }, send: null, preview: { supported: true } })[0].label, "Change");
});
