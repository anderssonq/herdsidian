import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseContext, serializeContext, findEntry, applyChange, expandHome, autoLinks, contextNotes, normName,
  suggest, matchNotes, isClaude, deliveryText, quoteAtOutside, quoteAtInside, MAX_SEND_CHARS, pickAgent, canSend, pushRecent, sendOrder,
} from "../mods/herdsidian/context.js";

const where = { space: "s1", name: "work", folder: "/r/work", vault: "/v" };
const empty = { version: 1, spaces: [] };
const link = (doc, note, w = where, live = ["s1"]) => applyChange(doc, { type: "link", note }, w, live);
const claude = { address: "t1", app: "claude-code", program: { key: "claude", name: "Claude Code" } };
const shell = { address: "t2", app: "zsh", program: { key: "zsh", name: "zsh" } };

// parseContext / serializeContext

test("parseContext reports a missing file as missing with an empty doc", () => {
  assert.deepEqual(parseContext(null), { status: "missing", doc: empty });
});

test("parseContext reports invalid JSON as invalid", () => {
  assert.equal(parseContext("{nope").status, "invalid");
});

test("parseContext reports a wrong shape as invalid", () => {
  for (const text of ['{"version":0,"spaces":[]}', '{"version":1}', "[]", "null", '{"version":1,"spaces":[1]}']) {
    assert.equal(parseContext(text).status, "invalid", text);
  }
});

test("parseContext reports a newer version as unsupported", () => {
  assert.equal(parseContext('{"version":2,"spaces":[]}').status, "unsupported");
  assert.equal(parseContext('{"version":9,"spaces":[],"x":1}').status, "unsupported");
});

test("a round trip keeps unknown top-level and per-entry keys", () => {
  const text = '{"version":1,"spaces":[{"space":"s1","extra":{"a":1},"notes":["a.md"]}],"mood":"calm"}';
  const { status, doc } = parseContext(text);
  assert.equal(status, "ok");
  const back = JSON.parse(serializeContext(doc));
  assert.equal(back.mood, "calm");
  assert.deepEqual(back.spaces[0].extra, { a: 1 });
});

test("serializeContext writes known keys in spec order, 2-space indent and a trailing newline", () => {
  const doc = { mood: "x", spaces: [{ agents: {}, notes: [], vault: "/v", extra: 1, folder: "/f", name: "n", space: "s1", excluded: [] }], version: 1 };
  const text = serializeContext(doc);
  assert.deepEqual(Object.keys(JSON.parse(text)), ["version", "spaces", "mood"]);
  assert.deepEqual(Object.keys(JSON.parse(text).spaces[0]),
    ["space", "name", "folder", "vault", "notes", "excluded", "agents", "extra"]);
  assert.ok(text.startsWith('{\n  "version": 1,\n  "spaces": [\n    {\n      "space"'));
  assert.ok(text.endsWith("}\n"));
  assert.ok(!text.endsWith("\n\n"));
});

// applyChange

test("link creates the entry with space, name, folder and vault", () => {
  const doc = link(empty, "a.md");
  assert.deepEqual(doc.spaces, [{ ...where, notes: ["a.md"], excluded: [], agents: {} }]);
});

test("link appends a note once", () => {
  const doc = link(link(link(empty, "a.md"), "b.md"), "a.md");
  assert.deepEqual(doc.spaces[0].notes, ["a.md", "b.md"]);
});

test("link does not change the doc it was given", () => {
  const before = JSON.stringify(empty);
  link(empty, "a.md");
  assert.equal(JSON.stringify(empty), before);
});

test("unlink removes the note from notes", () => {
  const doc = applyChange(link(link(empty, "a.md"), "b.md"), { type: "unlink", note: "a.md" }, where, ["s1"]);
  assert.deepEqual(doc.spaces[0].notes, ["b.md"]);
});

test("unlink removes the note from the agent's extras", () => {
  const scoped = applyChange(link(empty, "a.md"), { type: "scope", note: "a.md", address: "t1", agentOnly: true }, where, ["s1"]);
  const doc = applyChange(scoped, { type: "unlink", note: "a.md", address: "t1" }, where, ["s1"]);
  assert.deepEqual(doc.spaces[0].notes, []);
  assert.deepEqual(doc.spaces[0].agents, {});
});

test("unlink without an entry leaves the doc as it is", () => {
  assert.deepEqual(applyChange(empty, { type: "unlink", note: "a.md" }, where, []), empty);
});

test("scope moves a note to this agent only and back", () => {
  const one = applyChange(link(empty, "a.md"), { type: "scope", note: "a.md", address: "t1", agentOnly: true }, where, ["s1"]);
  assert.deepEqual(one.spaces[0].notes, []);
  assert.deepEqual(one.spaces[0].agents, { t1: ["a.md"] });
  const two = applyChange(one, { type: "scope", note: "a.md", address: "t1", agentOnly: false }, where, ["s1"]);
  assert.deepEqual(two.spaces[0].notes, ["a.md"]);
  assert.deepEqual(two.spaces[0].agents, {});
});

test("exclude records an auto link once", () => {
  const change = { type: "exclude", note: "auto.md" };
  const doc = applyChange(applyChange(empty, change, where, ["s1"]), change, where, ["s1"]);
  assert.deepEqual(doc.spaces[0].excluded, ["auto.md"]);
});

test("link takes a note off the excluded list", () => {
  const excluded = applyChange(empty, { type: "exclude", note: "a.md" }, where, ["s1"]);
  assert.deepEqual(link(excluded, "a.md").spaces[0].excluded, []);
});

test("a change leaves the other entries and unknown keys untouched", () => {
  const other = { space: "s9", name: "o", folder: "/o", vault: "/v", notes: ["z.md"], excluded: [], agents: {}, extra: 1 };
  const doc = link({ version: 1, spaces: [other], mood: "calm" }, "a.md");
  assert.deepEqual(doc.spaces[0], other);
  assert.equal(doc.mood, "calm");
  assert.equal(doc.spaces.length, 2);
});

test("a change keeps the unknown keys of the entry it edits", () => {
  const entry = { ...where, notes: [], excluded: [], agents: {}, extra: 7 };
  assert.equal(link({ version: 1, spaces: [entry] }, "a.md").spaces[0].extra, 7);
});

// findEntry

const stored = { space: "s1", name: "work", folder: "/r/work", vault: "/v", notes: ["a.md"], excluded: [], agents: {} };

test("findEntry matches the space and vault exactly", () => {
  assert.equal(findEntry({ version: 1, spaces: [stored] }, where, ["s1"]), stored);
});

test("findEntry does not match another vault", () => {
  assert.equal(findEntry({ version: 1, spaces: [stored] }, { ...where, vault: "/w" }, ["s1"]), null);
});

test("findEntry adopts the entry of a closed space with the same folder and vault", () => {
  assert.equal(findEntry({ version: 1, spaces: [stored] }, { ...where, space: "s5" }, ["s5"]), stored);
});

test("findEntry does not adopt an entry whose space is still live", () => {
  assert.equal(findEntry({ version: 1, spaces: [stored] }, { ...where, space: "s5" }, ["s1", "s5"]), null);
});

test("findEntry does not adopt when the new space already has its own entry", () => {
  const own = { ...stored, space: "s5", notes: ["own.md"] };
  assert.equal(findEntry({ version: 1, spaces: [stored, own] }, { ...where, space: "s5" }, ["s5"]), own);
});

test("a link on an adopted entry rewrites its space id and keeps its notes", () => {
  const doc = link({ version: 1, spaces: [stored] }, "b.md", { ...where, space: "s5", name: "again" }, ["s5"]);
  assert.equal(doc.spaces.length, 1);
  assert.equal(doc.spaces[0].space, "s5");
  assert.equal(doc.spaces[0].name, "again");
  assert.deepEqual(doc.spaces[0].notes, ["a.md", "b.md"]);
});

// expandHome / autoLinks

test("expandHome expands ~, keeps absolute paths and ignores relative ones", () => {
  assert.equal(expandHome("~/code/x", "/h"), "/h/code/x");
  assert.equal(expandHome("~", "/h"), "/h");
  assert.equal(expandHome("/abs/x", "/h"), "/abs/x");
  assert.equal(expandHome("rel/x", "/h"), null);
});

const meta = new Map([
  ["n/repo.md", { herdsidian: ["/r/work"] }],
  ["n/list.md", { herdsidian: ["rel/ignored", "~/code/app"] }],
  ["n/none.md", { herdsidian: [] }],
  ["n/plain.md", {}],
]);

test("autoLinks matches a cwd equal to the path", () => {
  assert.deepEqual(autoLinks(meta, "/r/work", "/h"), ["n/repo.md"]);
});

test("autoLinks matches a cwd inside the path", () => {
  assert.deepEqual(autoLinks(meta, "/r/work/src/deep", "/h"), ["n/repo.md"]);
});

test("autoLinks does not match a sibling folder that shares a prefix", () => {
  assert.deepEqual(autoLinks(meta, "/r/work-two", "/h"), []);
});

test("autoLinks matches nothing for an unrelated cwd or no cwd", () => {
  assert.deepEqual(autoLinks(meta, "/else", "/h"), []);
  assert.deepEqual(autoLinks(meta, null, "/h"), []);
});

test("autoLinks reads a list value, expands ~ and ignores relative entries", () => {
  assert.deepEqual(autoLinks(meta, "/h/code/app/src", "/h"), ["n/list.md"]);
  assert.deepEqual(autoLinks(meta, "rel/ignored", "/h"), []);
});

// contextNotes

test("contextNotes orders space notes, agent extras, then auto links", () => {
  const entry = { notes: ["s1.md", "s2.md"], agents: { t1: ["g.md"] }, excluded: [] };
  const got = contextNotes(entry, "t1", ["auto.md"], new Set(["s1.md", "s2.md", "g.md", "auto.md"]));
  assert.deepEqual(got, [
    { path: "s1.md", scope: "space" }, { path: "s2.md", scope: "space" },
    { path: "g.md", scope: "agent" }, { path: "auto.md", scope: "auto" },
  ]);
});

test("contextNotes drops duplicates and keeps the first scope", () => {
  const entry = { notes: ["a.md"], agents: { t1: ["a.md"] }, excluded: [] };
  assert.deepEqual(contextNotes(entry, "t1", ["a.md"], new Set(["a.md"])), [{ path: "a.md", scope: "space" }]);
});

test("contextNotes drops a deleted note", () => {
  const entry = { notes: ["a.md", "gone.md"], agents: {}, excluded: [] };
  assert.deepEqual(contextNotes(entry, null, [], new Set(["a.md"])).map((n) => n.path), ["a.md"]);
});

test("contextNotes ignores the extras of an address that is not live", () => {
  const entry = { notes: ["a.md"], agents: { t9: ["x.md"] }, excluded: [] };
  assert.deepEqual(contextNotes(entry, "t1", [], new Set(["a.md", "x.md"])).map((n) => n.path), ["a.md"]);
  assert.deepEqual(contextNotes(entry, null, [], new Set(["a.md", "x.md"])).map((n) => n.path), ["a.md"]);
});

test("contextNotes drops an excluded auto link", () => {
  const entry = { notes: [], agents: {}, excluded: ["auto.md"] };
  assert.deepEqual(contextNotes(entry, "t1", ["auto.md", "keep.md"], new Set(["auto.md", "keep.md"])),
    [{ path: "keep.md", scope: "auto" }]);
});

test("contextNotes works with no entry", () => {
  assert.deepEqual(contextNotes(null, "t1", ["a.md"], new Set(["a.md"])), [{ path: "a.md", scope: "auto" }]);
});

// suggest

const notes = ["work.md", "02/Repo_Name.md", "x/alias.md", "x/tagged.md", "r1.md", "r2.md", "plain.md", "Other.md"];
const smeta = new Map([
  ["x/alias.md", { aliases: ["WORK"], tags: [] }],
  ["x/tagged.md", { aliases: [], tags: ["repo-name"] }],
]);
const base0 = { notes, meta: smeta, spaceName: "Work", repoName: "repo name", recent: [], linked: [] };

test("normName ignores case, dashes, underscores and spaces", () => {
  assert.equal(normName("My_Repo-Name x"), "myreponamex");
});

test("suggest (a) matches the space name and the repo name, ignoring case and separators", () => {
  assert.deepEqual(suggest({ ...base0, meta: new Map() }), ["work.md", "02/Repo_Name.md"]);
});

test("suggest (b) adds recent notes that exist", () => {
  const got = suggest({ ...base0, meta: new Map(), recent: ["r1.md", "gone.md", "r2.md"] });
  assert.deepEqual(got, ["work.md", "02/Repo_Name.md", "r1.md", "r2.md"]);
});

test("suggest (c) adds notes with a matching alias or tag", () => {
  assert.deepEqual(suggest(base0), ["work.md", "02/Repo_Name.md", "x/alias.md", "x/tagged.md"]);
});

test("suggest orders a, b, c without duplicates and skips linked notes", () => {
  const got = suggest({ ...base0, recent: ["x/tagged.md", "work.md", "r1.md"], linked: ["02/Repo_Name.md"] });
  assert.deepEqual(got, ["work.md", "x/tagged.md", "r1.md", "x/alias.md"]);
});

test("suggest gives at most 6", () => {
  const many = Array.from({ length: 10 }, (_, i) => `n${i}.md`);
  assert.equal(suggest({ ...base0, notes: many, meta: new Map(), recent: many }).length, 6);
});

test("suggest still gives (a) and (b) in a vault without any frontmatter", () => {
  const got = suggest({ ...base0, meta: new Map(), recent: ["r1.md"] });
  assert.deepEqual(got, ["work.md", "02/Repo_Name.md", "r1.md"]);
});

test("suggest with no space or repo name gives only recent notes", () => {
  assert.deepEqual(suggest({ ...base0, spaceName: "", repoName: null, recent: ["r1.md"] }), ["r1.md"]);
});

// matchNotes / pushRecent

test("matchNotes finds notes whose name contains the query, ignoring case", () => {
  const all = ["a/Git Flow.md", "b/gitignore.md", "c/Other.md", "Git/readme.md"];
  assert.deepEqual(matchNotes(all, "GIT", 10), ["a/Git Flow.md", "b/gitignore.md"]);
});

test("matchNotes applies the limit", () => {
  const all = Array.from({ length: 300 }, (_, i) => `n/note${i}.md`);
  assert.equal(matchNotes(all, "note", 200).length, 200);
  assert.equal(matchNotes(all, "note", 3).length, 3);
});

test("pushRecent puts the newest first, dedupes and keeps 5", () => {
  assert.deepEqual(pushRecent(["a", "b", "c"], "b"), ["b", "a", "c"]);
  assert.deepEqual(pushRecent(["a", "b", "c", "d", "e"], "f"), ["f", "a", "b", "c", "d"]);
});

// isClaude / deliveryText

test("isClaude knows Claude Code by program key or app", () => {
  assert.equal(isClaude(claude), true);
  assert.equal(isClaude({ program: { key: "claude" } }), true);
  assert.equal(isClaude({ app: "claude-code" }), true);
  assert.equal(isClaude(shell), false);
  assert.equal(isClaude(null), false);
});

test("deliveryText gives @path for Claude Code", () => {
  assert.deepEqual(deliveryText(["a.md"], "/v", claude), { text: "@/v/a.md ", skipped: 0 });
  assert.equal(deliveryText(["a.md"], "/v", { app: "claude-code" }).text, "@/v/a.md ");
});

test("deliveryText gives the plain path for another agent", () => {
  assert.equal(deliveryText(["a.md"], "/v", { app: "codex", program: { key: "codex" } }).text, "/v/a.md ");
});

test("deliveryText joins paths with one space and ends with one space", () => {
  assert.equal(deliveryText([{ path: "a.md" }, { path: "n/b.md" }], "/v", claude).text, "@/v/a.md @/v/n/b.md ");
});

test("deliveryText quotes a path with a space", () => {
  assert.equal(deliveryText(["a b.md"], "/v", claude).text, '@"/v/a b.md" ');
  assert.equal(deliveryText(["a b.md"], "/v", shell).text, '"/v/a b.md" ');
});

test("deliveryText can use either Claude quoted form", () => {
  assert.equal(deliveryText(["a b.md"], "/v", claude, quoteAtOutside).text, '@"/v/a b.md" ');
  assert.equal(deliveryText(["a b.md"], "/v", claude, quoteAtInside).text, '"@/v/a b.md" ');
});

test("deliveryText never has a newline or carriage return", () => {
  const { text } = deliveryText(["a.md", "b c.md", "n/d.md"], "/v", claude);
  assert.doesNotMatch(text, /[\n\r]/);
});

test("deliveryText skips and counts a path with a newline or a double quote", () => {
  const got = deliveryText(["ok.md", "bad\nname.md", 'q"uote.md', "cr\r.md"], "/v", claude);
  assert.deepEqual(got, { text: "@/v/ok.md ", skipped: 3 });
});

test("deliveryText gives empty text when nothing can be sent", () => {
  assert.deepEqual(deliveryText([], "/v", claude), { text: "", skipped: 0 });
});

test("delivery built from a state with suggestions holds only context notes", () => {
  const entry = { notes: ["ctx.md"], agents: {}, excluded: [] };
  const all = ["ctx.md", "work.md", "r1.md"];
  const ctx = contextNotes(entry, "t1", [], new Set(all));
  const hints = suggest({ ...base0, notes: all, meta: new Map(), recent: ["r1.md"], linked: ctx.map((n) => n.path) });
  assert.deepEqual(hints, ["work.md", "r1.md"]);
  assert.equal(deliveryText(ctx, "/v", claude).text, "@/v/ctx.md ");
});

// deliveryText cap (D4)

const long = (n, c = "x") => c.repeat(n - 6) + ".md"; // "/v/" + name = n chars with the vault "/v"

test("deliveryText keeps text of exactly 600 characters", () => {
  const got = deliveryText([long(299), long(299, "y")], "/v", shell);
  assert.equal(got.text.length, 600);
  assert.equal(got.skipped, 0);
  assert.equal(got.overflow, undefined);
});

test("deliveryText leaves out a note that goes one character over 600", () => {
  const got = deliveryText([long(299), long(300, "y")], "/v", shell);
  assert.equal(got.text, `/v/${long(299)} `);
  assert.equal(got.overflow, 1);
});

test("deliveryText caps at 600 by default and takes another limit", () => {
  assert.equal(MAX_SEND_CHARS, 600);
  assert.equal(deliveryText(["a.md", "b.md"], "/v", shell, undefined, 8).text, "/v/a.md ");
  assert.equal(deliveryText(["a.md", "b.md"], "/v", shell, undefined, 16).text, "/v/a.md /v/b.md ");
});

test("deliveryText keeps the order and sends the first notes that fit", () => {
  const notes = ["center.md", "pin.md", "space1.md", "space2.md"];
  const got = deliveryText(notes, "/v", shell, undefined, 30);
  assert.equal(got.text, "/v/center.md /v/pin.md ");
  assert.equal(got.overflow, 2);
});

test("deliveryText skips a note that is too long and still sends a later short one", () => {
  const got = deliveryText([long(700), "a.md"], "/v", shell);
  assert.equal(got.text, "/v/a.md ");
  assert.equal(got.overflow, 1);
});

test("deliveryText counts overflow apart from skipped paths", () => {
  const got = deliveryText(["bad\nname.md", "ok.md", long(700)], "/v", claude);
  assert.deepEqual(got, { text: "@/v/ok.md ", skipped: 1, overflow: 1 });
});

test("deliveryText counts the Claude @ and quotes toward the cap", () => {
  const got = deliveryText(["a b.md"], "/v", claude, quoteAtOutside, 12);
  assert.equal(got.text, "");
  assert.equal(got.overflow, 1);
  assert.equal(deliveryText(["a b.md"], "/v", claude, quoteAtOutside, 13).text, '@"/v/a b.md" ');
});

// pickAgent

const spaces = [{ id: "s1", active: true }, { id: "s2", active: false }];

test("pickAgent returns the focused agent and remembers it", () => {
  const got = pickAgent({ agents: [{ ...claude, focused: true, space: "s1" }], focused: { space: "s1", terminal: "t1" }, spaces, memory: {} });
  assert.equal(got.agent.address, "t1");
  assert.equal(got.spaceId, "s1");
  assert.deepEqual(got.memory, { s1: "t1" });
});

test("pickAgent returns the remembered agent when the keyboard is in a mod", () => {
  const agents = [{ ...claude, space: "s1", focused: false }];
  const got = pickAgent({ agents, focused: { space: "s1", terminal: null }, spaces, memory: { s1: "t1" } });
  assert.equal(got.agent.address, "t1");
  assert.deepEqual(got.memory, { s1: "t1" });
});

test("pickAgent falls back to the active space when nothing is focused", () => {
  const agents = [{ ...claude, space: "s1", focused: false }];
  assert.equal(pickAgent({ agents, focused: null, spaces, memory: { s1: "t1" } }).agent.address, "t1");
});

test("pickAgent gives no agent for a focused plain shell and clears that space's memory", () => {
  const agents = [{ ...claude, space: "s1", focused: false }];
  const got = pickAgent({ agents, focused: { space: "s1", terminal: "t2" }, spaces, memory: { s1: "t1", s2: "t5" } });
  assert.equal(got.agent, null);
  assert.equal(got.spaceId, "s1");
  assert.deepEqual(got.memory, { s2: "t5" });
});

test("pickAgent gives no agent when the remembered address is no longer live", () => {
  const got = pickAgent({ agents: [], focused: { space: "s1", terminal: null }, spaces, memory: { s1: "t1" } });
  assert.equal(got.agent, null);
  assert.deepEqual(got.memory, {});
});

test("pickAgent keeps one memory per space", () => {
  const agents = [{ ...claude, space: "s1", focused: false }, { address: "t7", space: "s2", focused: true }];
  assert.deepEqual(pickAgent({ agents, focused: null, spaces, memory: { s1: "t1" } }).memory, { s1: "t1", s2: "t7" });
});

// canSend

test("canSend says no agent focused first", () => {
  assert.deepEqual(canSend({ agent: null, space: { machine: null }, notes: [1] }), { ok: false, reason: "No agent focused" });
});

test("canSend says no context notes", () => {
  assert.deepEqual(canSend({ agent: claude, space: { machine: null }, notes: [] }), { ok: false, reason: "No context notes" });
});

test("canSend says the vault is local for a remote space", () => {
  assert.deepEqual(canSend({ agent: claude, space: { machine: "m1" }, notes: [1] }),
    { ok: false, reason: "Vault paths are local to this Mac" });
});

test("canSend is ok for a local space with an agent and notes", () => {
  assert.deepEqual(canSend({ agent: claude, space: { machine: null }, notes: [1] }), { ok: true, reason: null });
});

// control characters and whitespace

test("deliveryText skips and counts a path with any control character", () => {
  const names = ["esc\u001b[0m.md", "ctrl\u000f.md", "tab\t.md", "del\u007f.md", "c1\u0085.md"];
  const got = deliveryText(["ok.md", ...names], "/v", claude);
  assert.deepEqual(got, { text: "@/v/ok.md ", skipped: names.length });
});

test("deliveryText quotes a path with a no-break space", () => {
  assert.equal(deliveryText(["a\u00a0b.md"], "/v", shell).text, '"/v/a\u00a0b.md" ');
  assert.equal(deliveryText(["a\u00a0b.md"], "/v", claude).text, '@"/v/a\u00a0b.md" ');
});

// sendOrder (D4)

const n = (path, scope) => ({ path, scope });

test("sendOrder puts the center first, then agent, space and auto notes", () => {
  const notes = [n("a", "auto"), n("b", "space"), n("c", "agent"), n("d", "space"), n("e", "agent")];
  assert.deepEqual(sendOrder(notes, "d").map((x) => x.path), ["d", "c", "e", "b", "a"]);
});

test("sendOrder keeps the input order within a scope and ignores a center that is not a note", () => {
  const notes = [n("b", "space"), n("a", "space"), n("z", "auto")];
  assert.deepEqual(sendOrder(notes, "nope").map((x) => x.path), ["b", "a", "z"]);
  assert.deepEqual(sendOrder(notes, null).map((x) => x.path), ["b", "a", "z"]);
});

test("sendOrder drops duplicates and keeps the first scope", () => {
  const notes = [n("a", "space"), n("a", "agent"), n("b", "auto")];
  assert.deepEqual(sendOrder(notes, "b"), [n("b", "auto"), n("a", "space")]);
});
