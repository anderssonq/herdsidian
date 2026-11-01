// The ⌘K palette's pure logic (ranking, filtering, key hints, lists, times), with no Herdr or
// GPUI imports so it can be tested with node. Note rules come from context.js, never copied.
import { base } from "./notes.js";
import { matchNotes, canSend, contextNotes, findEntry, autoLinks, deliveryText } from "./context.js";
import { sendToasts } from "./send.js";

export const LIMITS = { agents: 4, notes: 6, commands: 4, single: 50 };
export const ROW = { top: 56, row: 32, title: 24 }; // px, shared by the view and visibleWindow
export const LIST_MAX = 320; // px of a single-kind list before it scrolls
export const TABS = ["all", "notes", "agents", "commands"];

const MAX_AUTO = 200;
const KIND_ORDER = { note: 0, agent: 1, command: 2 };
const TITLE_ONLY_TIER = 4;
const WORD_BREAKS = " -_.";

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// 0 equals · 1 prefix · 2 word prefix (after a space, "-", "_" or ".") · 3 contains · -1 none. Case ignored.
export function tier(text, query) {
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  let at = t.indexOf(q);
  if (at < 0) return -1;
  while (at >= 0) {
    if (at > 0 && WORD_BREAKS.includes(t[at - 1])) return 2;
    at = t.indexOf(q, at + 1);
  }
  return 3;
}

// The set of matchNotes(all, query, Infinity), best first: tier, linked, shorter name, path.
export function rankNotes(all, query, linked = new Set()) {
  const scored = matchNotes(all, query, Infinity).map((path) => {
    const name = base(path);
    return { path, tier: tier(name, query), linked: linked.has(path) ? 0 : 1, len: name.length };
  });
  scored.sort((a, b) => a.tier - b.tier || a.linked - b.linked || a.len - b.len || byCode(a.path, b.path));
  return scored.map((s) => s.path);
}

const isBlank = (query) => query.trim() === "";

// [{ agent, tier }]. Empty query: agents() order, tier 0. Program, space or tab name by tier;
// a title-only match is tier 4. Equal tiers keep the given order (the sort is stable).
export function rankAgents(agents, query) {
  if (isBlank(query)) return agents.map((agent) => ({ agent, tier: 0 }));
  const q = query.trim();
  const out = [];
  for (const agent of agents) {
    const names = [agent.program?.name, agent.space_name, agent.tab_name].filter(Boolean);
    const best = names.map((n) => tier(n, q)).filter((n) => n >= 0).sort((a, b) => a - b)[0];
    if (best !== undefined) { out.push({ agent, tier: best }); continue; }
    if (agent.title && tier(agent.title, q) >= 0) out.push({ agent, tier: TITLE_ONLY_TIER });
  }
  return out.sort((a, b) => a.tier - b.tier);
}

// [{ command, tier }] by label.
export function rankCommands(commands, query) {
  if (isBlank(query)) return commands.map((command) => ({ command, tier: 0 }));
  const q = query.trim();
  return commands
    .map((command) => ({ command, tier: tier(command.label, q) }))
    .filter((r) => r.tier >= 0)
    .sort((a, b) => a.tier - b.tier);
}

const MODS = [["ctrl", "⌃"], ["alt", "⌥"], ["shift", "⇧"], ["cmd", "⌘"]];
const KEY_NAMES = { tab: "⇥", escape: "⎋", space: "Space", up: "↑", down: "↓", left: "←", right: "→" };

// "cmd-alt-1" -> "⌥⌘1". Modifier order ⌃⌥⇧⌘. The key itself may be "-" or "[".
export function formatChord(keys) {
  const held = new Set();
  let rest = keys;
  for (;;) {
    const hit = MODS.find(([name]) => rest.startsWith(`${name}-`) && rest.length > name.length + 1);
    if (!hit) break;
    held.add(hit[0]);
    rest = rest.slice(hit[0].length + 1);
  }
  const key = KEY_NAMES[rest] ?? (rest.length === 1 ? rest.toUpperCase() : rest);
  return MODS.filter(([name]) => held.has(name)).map(([, glyph]) => glyph).join("") + key;
}

// keys() list -> "⌘L" | null. The `layout:<name>` section first, then `global`, nothing else.
export function keyHint(bindings, action, layoutName) {
  if (!Array.isArray(bindings)) return null;
  for (const section of [`layout:${layoutName}`, "global"]) {
    const found = bindings.find((b) => b.section === section && b.action === action);
    if (found) return formatChord(found.keys);
  }
  return null;
}

// True when a visible block of layout() has content.mod === mod. A hidden node hides its subtree.
export function hasMod(tree, mod) {
  if (tree === null || typeof tree !== "object") return false;
  if (!Array.isArray(tree) && tree.hidden === true) return false;
  if (!Array.isArray(tree) && tree.content?.mod === mod) return true;
  return Object.values(tree).some((child) => hasMod(child, mod));
}

// True only when the node exists and neither it nor any ancestor has hidden: true.
export function isShown(tree, id) {
  const walk = (node) => {
    if (node === null || typeof node !== "object") return false;
    if (node.hidden === true) return false;
    if (node.id === id) return true;
    return (node.children ?? []).some(walk);
  };
  return walk(tree);
}

// The remembered agent counts only inside its own space.
export const targetAgent = (picked) => (picked.agent && picked.agent.space === picked.spaceId ? picked.agent : null);

// A memo key is a list of values compared one by one (===); identity values (notes, doc) are kept as they are.
export const sameKey = (a, b) => Boolean(a) && a.length === b.length && a.every((v, i) => v === b[i]);

// The ranked-notes memo key: the agents are not part of it, so an animated title never re-ranks the notes.
export const rankKey = ({ query, tab, notes, linked }) => [query, tab, notes, linked];

// The signature of the live agents; the program and app are in it so a late detection redraws the row.
export const agentSig = (agents) => agents
  .map((a) => `${a.address}|${a.status}|${a.title}|${a.space_name}|${a.tab_name}|${a.program?.key}|${a.program?.name}|${a.app}`)
  .join("\n");

// The list memo key: everything buildList and commandList read.
export function modelKey({ query, tab, notes, notesError, doc, linking, starter, agents, order, layoutName, bindings, notesHidden, hasList }) {
  return [
    query, tab, notes, notesError, doc, linking, starter, agentSig(agents),
    JSON.stringify(order ?? null), layoutName, JSON.stringify(bindings), notesHidden, hasList,
  ];
}

// "⌥⌘N" only when the address is the Nth of guide-agents' own list and N is really bound (Decision 3).
export function agentHint(address, order, bindings, layoutName, hasAgentsList) {
  if (!hasAgentsList || !Array.isArray(order)) return null;
  const at = order.indexOf(address);
  if (at < 0 || at > 8) return null;
  return keyHint(bindings, `guide-agents.focus-${at + 1}`, layoutName);
}

// The palette's own commands. action: run | link | request.
export function commandList({ vault, notesHidden, space, starter, bindings, layoutName }) {
  const hint = (action) => keyHint(bindings, action, layoutName);
  const out = [];
  if (vault && space) {
    out.push({ id: "link", label: "Link note to current agent…", hint: hint("herdsidian.link"), action: { type: "link" } });
  }
  if (starter && space) {
    out.push({
      id: "new-agent", label: `New ${starter.name} in ${space.name}`, hint: null,
      action: { type: "run", name: "tab.new", args: { space: space.id, argv: starter.run } },
    });
  }
  out.push({
    id: "notes", label: notesHidden ? "Show Notes" : "Hide Notes", hint: hint("layout.toggle:herdsidian"),
    action: { type: "run", name: "layout.toggle", args: { id: "herdsidian" } },
  });
  if (!vault) {
    out.push({ id: "vault", label: "Choose vault…", hint: null, action: { type: "request", op: "choose-vault" } });
  }
  out.push({
    id: "herdr", label: "All Herdr commands…", hint: hint("app.palette"),
    action: { type: "run", name: "app.palette", args: {} },
  });
  return out;
}

// The target space's context: { where, linked: Set, contextPaths }. target = { agent, space, liveIds? }.
export function scene({ doc, target, vault, cwd, auto, all, home }) {
  const { agent = null, space = null, liveIds = [] } = target ?? {};
  const where = space && vault
    ? { space: space.id, name: space.name, folder: space.folder, vault, ...(agent ? { address: agent.address } : {}) }
    : null;
  const entry = where ? findEntry(doc, where, liveIds) : null;
  const links = autoLinks(autoMeta(auto, vault), cwd, home);
  const contextPaths = contextNotes(entry, agent?.address ?? null, links, new Set(all)).map((n) => n.path);
  return { where, linked: new Set(contextPaths), contextPaths };
}

// Notes side: only the notes with a non-empty `herdsidian` list, at most 200.
export function autoFromIndex(meta, vault) {
  const notes = {};
  let count = 0;
  for (const [path, m] of meta ?? []) {
    if (count >= MAX_AUTO) break;
    if (!Array.isArray(m?.herdsidian) || m.herdsidian.length === 0) continue;
    notes[path] = m.herdsidian;
    count++;
  }
  return { vault, notes };
}

// Palette side: Map<path, { herdsidian }>; empty when the vault differs.
export function autoMeta(value, vault) {
  const out = new Map();
  if (!value || !vault || value.vault !== vault || !value.notes) return out;
  for (const [path, herdsidian] of Object.entries(value.notes)) out.set(path, { herdsidian });
  return out;
}

export { isFreshRequest } from "./context.js";

const agentRow = ({ agent, tier: t }, hintFor) => ({
  key: `agent:${agent.address}`, kind: "agent", label: agent.program?.name ?? agent.app ?? "Agent",
  detail: agent.title ?? "", hint: hintFor(agent.address), tier: t, agent,
});
const noteRow = (path, t) => ({
  key: `note:${path}`, kind: "note", label: base(path), detail: topFolder(path), hint: null, tier: t, path,
});
const commandRow = ({ command, tier: t }) => ({
  key: `command:${command.id}`, kind: "command", label: command.label, detail: "", hint: command.hint, tier: t, command,
});

// Rows of the Notes section for the empty query: context notes, then (single tab) the other notes A→Z.
function emptyQueryNotes(notes, contextPaths, limit, fillRest) {
  const context = contextPaths.map((p) => noteRow(p, 0));
  if (!fillRest) return context.slice(0, limit);
  const shown = new Set(contextPaths);
  const rest = notes.filter((p) => !shown.has(p)).slice(0, limit).map((p) => noteRow(p, 0));
  return [...context, ...rest].slice(0, limit);
}

// The ranked note rows for a non-empty query. The caller may memoize this apart from the agent rows.
export function rankNoteRows(notes, query, linked) {
  return rankNotes(notes, query.trim(), linked).map((p) => noteRow(p, tier(base(p), query.trim())));
}

// -> { top, sections, pickable, empty }. `rankedNotes` (from rankNoteRows) skips the ranking when given.
export function buildList({ query, tab, vault, notes, notesError, linked, contextPaths, agents, commands, hintFor, rankedNotes }) {
  const q = query.trim();
  const blank = q === "";
  const single = tab !== "all" && TABS.includes(tab) && !(tab === "notes" && !vault);
  const wants = (kind) => !single || tab === kind;

  const agentRows = wants("agents") ? rankAgents(agents, q).map((r) => agentRow(r, hintFor)) : [];
  const commandRows = wants("commands") ? rankCommands(commands, q).map(commandRow) : [];

  let noteRows = [];
  let noteMessage = null;
  if (vault && wants("notes")) {
    if (notesError) noteMessage = { text: notesError, tone: "blocked" };
    else if (notes === null) noteMessage = { text: "Loading notes…", tone: "muted" };
    else if (blank) noteRows = emptyQueryNotes(notes, contextPaths, single ? LIMITS.single : LIMITS.notes, single);
    else noteRows = rankedNotes ?? rankNoteRows(notes, q, linked);
  }

  let top = null;
  if (!single && !blank) {
    const firsts = [noteRows[0], agentRows[0], commandRows[0]].filter(Boolean);
    top = firsts.sort((a, b) => a.tier - b.tier || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])[0] ?? null;
  }
  const rest = (rows) => rows.filter((r) => r.key !== top?.key);
  const cap = (n) => (single ? LIMITS.single : n);

  const sections = [];
  const agentsList = rest(agentRows).slice(0, cap(LIMITS.agents));
  if (agentsList.length) sections.push({ kind: "agents", title: "Agents", rows: agentsList, message: null });
  else if (single && agents.length === 0) {
    sections.push({ kind: "agents", title: "Agents", rows: [], message: { text: "No agents running", tone: "muted" } });
  }
  const notesList = rest(noteRows).slice(0, cap(LIMITS.notes));
  if (notesList.length || noteMessage) sections.push({ kind: "notes", title: "Notes", rows: notesList, message: noteMessage });
  let cmdRows = rest(commandRows).slice(0, cap(LIMITS.commands));
  if (single && tab === "agents" && agents.length === 0) {
    cmdRows = commands.filter((c) => c.id === "new-agent").map((command) => commandRow({ command, tier: 0 }));
  }
  if (cmdRows.length) sections.push({ kind: "commands", title: "Commands", rows: cmdRows, message: null });

  const pickable = [...(top ? [top] : []), ...sections.flatMap((s) => s.rows)];
  const nothing = !top && sections.every((s) => s.rows.length === 0 && s.message === null);
  const empty = !blank && nothing ? `No matches for "${q}"` : null;
  return { top, sections, pickable, empty };
}

const pad = (n) => String(n).padStart(2, "0");

// "just now" < 60 s · "Nm ago" · "Nh ago" · "yesterday" (24 to 48 h) · "YYYY-MM-DD" (local date).
export function relativeTime(ms, now) {
  const age = now - ms;
  if (age < 60_000) return "just now";
  const minutes = Math.floor(age / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(age / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return "yesterday";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "01-Projects / NVSinner" · "" at the vault root.
export const breadcrumb = (path) => path.split("/").slice(0, -1).join(" / ");

// The first folder or "".
export const topFolder = (path) => (path.includes("/") ? path.split("/")[0] : "");

// "<breadcrumb> · linked to <space> · edited <time>", empty parts left out.
export function topMeta({ path, linkedTo, mtime, now }) {
  return [
    breadcrumb(path),
    linkedTo ? `linked to ${linkedTo}` : "",
    Number.isFinite(mtime) ? `edited ${relativeTime(mtime, now)}` : "",
  ].filter(Boolean).join(" · ");
}

// Wraps around both ends. No rows gives 0.
export function wrap(index, delta, count) {
  if (count <= 0) return 0;
  return (((index + delta) % count) + count) % count;
}

// The ⌘↵ sequence as pure decisions (AC26-28, AC36). Call it twice: with `mtime` undefined before the
// note is statted, then with noteTime's result. Returns one of:
//   { type: "blocked", reason }  not allowed, or a send is already checking or running
//   { type: "stat" }             the guard passed: stat the note, then call again with mtime
//   { type: "stop" }             the popup closed meanwhile: do nothing
//   { type: "toast", title, level }
//   { type: "send", text, address, name, more, onDone }  onDone(dead) closes the popup unless it is dead
export function planSend({ row, target, space, vault, mtime, checking, sending = false, dead, close, deliver = deliveryText }) {
  const state = sendState({ row, target, space, vault, sending: checking || sending });
  if (!state.ok) return { type: "blocked", reason: state.reason };
  if (mtime === undefined) return { type: "stat" };
  if (dead) return { type: "stop" };
  if (mtime === null) return { type: "toast", title: `Note not found: ${row.label}`, level: "warning" };
  const { text, skipped, overflow = 0 } = deliver([row.path], vault, target);
  const name = target.program?.name ?? target.app ?? "the agent";
  const toasts = sendToasts(name, skipped, overflow);
  if (!text) return { type: "toast", title: toasts.nothing, level: "warning" };
  return { type: "send", text, address: target.address, name, more: toasts.more, onDone: (isDead) => { if (!isDead) close(); } };
}

// Whether ⌘↵ can send, and why not. row is the selected row.
export function sendState({ row, target, space, vault, sending }) {
  if (!vault) return { ok: false, reason: "Choose a vault first" };
  if (row?.kind !== "note") return { ok: false, reason: "Pick a note to send" };
  const can = canSend({ agent: target, space, notes: [row.path] });
  if (!can.ok) return can;
  if (sending) return { ok: false, reason: "Sending…" };
  return { ok: true, reason: null };
}

const OPEN_LABEL = { note: "Open", agent: "Focus", command: "Run" };

// The footer keys. ⇥ only when preview.supported.
export function footer({ row, send, preview }) {
  const keys = [
    { keys: "↵", label: OPEN_LABEL[row?.kind] ?? "Open", active: Boolean(row), reason: null },
    { keys: "⌘↵", label: "Send to agent", active: Boolean(send?.ok), reason: send?.reason ?? null },
  ];
  if (preview?.supported) keys.push({ keys: "⇥", label: "Preview", active: row?.kind === "note", reason: null });
  keys.push({ keys: "esc", label: "Close", active: true, reason: null });
  return keys;
}

// Fixed-height rows in a strip. Keeps row `selected` in view, returns the rows to draw (first..last,
// the visible ones plus `margin` each side), each row's top, the strip height and the clamped scroll.
export function visibleWindow(heights, scroll, viewport, margin = 2, selected = -1) {
  const tops = [];
  let total = 0;
  for (const h of heights) { tops.push(total); total += h; }
  let at = Math.max(0, Math.min(scroll, Math.max(0, total - viewport)));
  if (selected >= 0 && selected < heights.length) {
    if (tops[selected] < at) at = tops[selected];
    const bottom = tops[selected] + heights[selected];
    if (bottom > at + viewport) at = bottom - viewport;
    at = Math.max(0, Math.min(at, Math.max(0, total - viewport)));
  }
  if (heights.length === 0) return { first: 0, last: -1, tops, total, scroll: 0 };
  const firstVisible = tops.findIndex((top, i) => top + heights[i] > at);
  let lastVisible = firstVisible;
  while (lastVisible + 1 < heights.length && tops[lastVisible + 1] < at + viewport) lastVisible++;
  return {
    first: Math.max(0, firstVisible - margin), last: Math.min(heights.length - 1, lastVisible + margin),
    tops, total, scroll: at,
  };
}
