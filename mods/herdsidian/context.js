// The Agent context's pure logic (context file, suggestions, delivery text, agent pick),
// with no Herdr or GPUI imports so it can be tested with node.
import { base } from "./notes.js";

const VERSION = 1;
const MAX_SUGGESTIONS = 6;
const MAX_RECENT = 5;

const TOP_KEYS = ["version", "spaces"];
const ENTRY_KEYS = ["space", "name", "folder", "vault", "notes", "excluded", "agents"];

export const emptyDoc = () => ({ version: VERSION, spaces: [] });
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// File text (null = no file) to { status: "ok" | "missing" | "invalid" | "unsupported", doc }.
// doc is only the parsed file when the status is "ok". "unsupported" is a file from a newer Herdsidian.
export function parseContext(text) {
  if (text === null || text === undefined) return { status: "missing", doc: emptyDoc() };
  let doc;
  try { doc = JSON.parse(text); } catch { return { status: "invalid", doc: emptyDoc() }; }
  if (isObject(doc) && Number.isInteger(doc.version) && doc.version > VERSION) return { status: "unsupported", doc: emptyDoc() };
  const valid = isObject(doc) && doc.version === VERSION && Array.isArray(doc.spaces) && doc.spaces.every(isObject);
  return valid ? { status: "ok", doc } : { status: "invalid", doc: emptyDoc() };
}

// Known keys first in spec order, unknown keys after them, 2-space indent, trailing newline.
const ordered = (obj, known) => {
  const out = {};
  for (const key of known) if (key in obj) out[key] = obj[key];
  for (const key of Object.keys(obj)) if (!known.includes(key)) out[key] = obj[key];
  return out;
};

export function serializeContext(doc) {
  const top = ordered({ ...doc, spaces: doc.spaces.map((entry) => ordered(entry, ENTRY_KEYS)) }, TOP_KEYS);
  return JSON.stringify(top, null, 2) + "\n";
}

// The entry for a space + vault. When the space id has none, adopt the entry with the same
// folder and vault whose space id is no longer live (A8).
export function findEntry(doc, where, liveSpaceIds) {
  const exact = doc.spaces.find((e) => e.space === where.space && e.vault === where.vault);
  if (exact) return exact;
  if (!where.folder) return null;
  const live = new Set(liveSpaceIds);
  return doc.spaces.find((e) => e.folder === where.folder && e.vault === where.vault && !live.has(e.space)) ?? null;
}

const without = (list, note) => list.filter((n) => n !== note);
const added = (list, note) => (list.includes(note) ? list : [...list, note]);

// A new doc with one change applied to the entry of `where`; other entries and unknown keys stay.
// change = { type: "link" | "unlink" | "exclude" | "scope", note, address?, agentOnly? }
export function applyChange(doc, change, where, liveSpaceIds) {
  const found = findEntry(doc, where, liveSpaceIds);
  if (!found && change.type === "unlink") return doc;
  const entry = {
    ...(found ?? {}),
    space: where.space, name: where.name, folder: where.folder, vault: where.vault,
    notes: found?.notes ?? [], excluded: found?.excluded ?? [], agents: { ...(found?.agents ?? {}) },
  };
  const address = change.address ?? where.address;
  const setAgent = (list) => {
    if (list.length) entry.agents[address] = list;
    else delete entry.agents[address];
  };
  const agentList = entry.agents[address] ?? [];

  if (change.type === "link") {
    entry.notes = added(entry.notes, change.note);
    entry.excluded = without(entry.excluded, change.note);
  } else if (change.type === "unlink") {
    entry.notes = without(entry.notes, change.note);
    if (address) setAgent(without(agentList, change.note));
  } else if (change.type === "exclude") {
    entry.excluded = added(entry.excluded, change.note);
  } else if (change.type === "scope" && address) {
    if (change.agentOnly) {
      entry.notes = without(entry.notes, change.note);
      setAgent(added(agentList, change.note));
    } else {
      setAgent(without(agentList, change.note));
      entry.notes = added(entry.notes, change.note);
    }
  }
  return { ...doc, spaces: found ? doc.spaces.map((e) => (e === found ? entry : e)) : [...doc.spaces, entry] };
}

// "~/x" to home + "/x"; an absolute path is kept; a relative path gives null.
export function expandHome(path, home) {
  if (typeof path !== "string") return null;
  if (path === "~") return home;
  if (path.startsWith("~/")) return home.replace(/\/+$/, "") + path.slice(1);
  return path.startsWith("/") ? path : null;
}

// Notes whose `herdsidian` path equals the cwd or contains it. meta: Map<note, { herdsidian }>.
export function autoLinks(meta, cwd, home) {
  if (!cwd) return [];
  const out = [];
  for (const [note, m] of meta) {
    const hit = (m.herdsidian ?? []).some((raw) => {
      const abs = expandHome(raw, home);
      if (abs === null) return false;
      const dir = abs.length > 1 ? abs.replace(/\/+$/, "") : abs;
      return cwd === dir || cwd.startsWith(dir.endsWith("/") ? dir : dir + "/");
    });
    if (hit) out.push(note);
  }
  return out;
}

// Notes shown and sent: space links, then the agent's extras, then auto links (minus excluded),
// deduped, only notes that still exist. -> [{ path, scope: "space" | "agent" | "auto" }]
export function contextNotes(entry, address, auto, existing) {
  const excluded = new Set(entry?.excluded ?? []);
  const all = [
    ...(entry?.notes ?? []).map((path) => ({ path, scope: "space" })),
    ...(address ? entry?.agents?.[address] ?? [] : []).map((path) => ({ path, scope: "agent" })),
    ...auto.filter((path) => !excluded.has(path)).map((path) => ({ path, scope: "auto" })),
  ];
  const seen = new Set();
  return all.filter((n) => existing.has(n.path) && !seen.has(n.path) && seen.add(n.path));
}

// Case and "-", "_", space differences ignored.
export const normName = (s) => s.toLowerCase().replace(/[-_\s]/g, "");

// Up to 6 notes to offer: (a) named like the space or repo, (b) recent, (c) aliases or tags.
export function suggest({ notes, meta, spaceName, repoName, recent, linked }) {
  const names = [spaceName, repoName].filter(Boolean).map(normName).filter(Boolean);
  const exists = new Set(notes);
  const skip = new Set(linked);
  const a = notes.filter((p) => names.includes(normName(base(p))));
  const b = recent.filter((p) => exists.has(p));
  const c = notes.filter((p) => {
    const m = meta?.get(p);
    return m && [...(m.aliases ?? []), ...(m.tags ?? [])].some((v) => names.includes(normName(v)));
  });
  const seen = new Set();
  return [...a, ...b, ...c]
    .filter((p) => !skip.has(p) && !seen.has(p) && seen.add(p))
    .slice(0, MAX_SUGGESTIONS);
}

// The notes whose name contains the query (lower-cased), like the Find box.
export const matchNotes = (all, query, limit) => {
  const q = query.toLowerCase();
  return all.filter((p) => base(p).toLowerCase().includes(q)).slice(0, limit);
};

export const isClaude = (agent) => agent?.program?.key === "claude" || /claude/i.test(agent?.app ?? "");

// How Claude Code mentions a path with a space (D2). Switch the form here: @"/a b.md" or "@/a b.md".
export const quoteAtOutside = (abs) => `@"${abs}"`;
// The documented D2 alternative, kept to switch the form.
export const quoteAtInside = (abs) => `"@${abs}"`;
export const CLAUDE_QUOTED = quoteAtOutside;

// One line of paths for the agent's prompt: "@/abs" for Claude Code, "/abs" otherwise, quoted
// when it has whitespace, joined by spaces with one trailing space. Paths that cannot be on one
// line (any control character, double quote) are skipped and counted.
// D4: the text holds at most `maxChars` characters, trailing space included. Notes are taken in
// the order given; one that does not fit is left out and counted in `overflow` (a field that is
// only present when it is above 0).
export const MAX_SEND_CHARS = 600;

export function deliveryText(notes, vault, agent, claudeQuoted = CLAUDE_QUOTED, maxChars = MAX_SEND_CHARS) {
  const claude = isClaude(agent);
  const parts = [];
  let skipped = 0, overflow = 0, used = 0;
  for (const note of notes) {
    const abs = `${vault}/${typeof note === "string" ? note : note.path}`;
    if (/[\u0000-\u001f\u007f-\u009f"]/.test(abs)) { skipped++; continue; }
    const spaced = /\s/.test(abs);
    const part = claude ? (spaced ? claudeQuoted(abs) : `@${abs}`) : (spaced ? `"${abs}"` : abs);
    if (used + part.length + 1 > maxChars) { overflow++; continue; }
    parts.push(part);
    used += part.length + 1;
  }
  const text = parts.length ? parts.join(" ") + " " : "";
  return overflow ? { text, skipped, overflow } : { text, skipped };
}

// Notes in send order (D4): the center first if it is a context note, then agent, space and auto
// notes, each in the given order, no duplicates. notes: [{ path, scope }].
export function sendOrder(notes, center) {
  const rank = { agent: 0, space: 1, auto: 2 };
  const seen = new Set();
  const unique = notes.filter((n) => !seen.has(n.path) && seen.add(n.path));
  const head = unique.filter((n) => n.path === center);
  const rest = unique.filter((n) => n.path !== center);
  return [...head, ...[0, 1, 2].flatMap((r) => rest.filter((n) => rank[n.scope] === r))];
}

// The focused agent (A3). focused: { space, terminal } | null. memory: { [spaceId]: address }.
export function pickAgent({ agents, focused, spaces, memory }) {
  const direct = agents.find((a) => a.focused);
  if (direct) return { agent: direct, spaceId: direct.space, memory: { ...memory, [direct.space]: direct.address } };

  const spaceId = focused?.space ?? spaces.find((s) => s.active)?.id ?? null;
  if (spaceId === null) return { agent: null, spaceId, memory };
  const { [spaceId]: remembered, ...rest } = memory;
  if (focused?.terminal) return { agent: null, spaceId, memory: rest };

  const agent = agents.find((a) => a.address === remembered) ?? null;
  return { agent, spaceId, memory: agent ? memory : rest };
}

// Whether Send to agent works, and why not.
export function canSend({ agent, space, notes }) {
  if (!agent) return { ok: false, reason: "No agent focused" };
  if (!notes.length) return { ok: false, reason: "No context notes" };
  if (space?.machine != null) return { ok: false, reason: "Vault paths are local to this Mac" };
  return { ok: true, reason: null };
}

// What to do with the palette's request in shared("herdsidian.request"). `handled` is the id
// already dealt with. A request older than 5 s is stale (left from a past session) and ignored.
// -> { action: "open" | "choose-vault" | "other-vault" | "none", id }
export function isFreshRequest(request, now, maxAgeMs = 5000) {
  if (!request || !Number.isFinite(request.at)) return false;
  const age = now - request.at;
  return age >= 0 && age < maxAgeMs;
}

export function pendingRequest(request, handled, vault, now, maxAgeMs = 5000) {
  const id = request?.id ?? null;
  if (id === handled || !isFreshRequest(request, now, maxAgeMs)) return { action: "none", id };
  if (request.op === "choose-vault") return { action: "choose-vault", id };
  if (request.op === "open" && request.path) return { action: request.vault === vault ? "open" : "other-vault", id };
  return { action: "none", id };
}

// Whether the context file must be read again: the palette bumped context-rev.
export const shouldReload = (rev, seenRev) => (rev ?? null) !== (seenRev ?? null);

// Whether a shared value changed (compared as JSON): a write is skipped when it did not.
export const changedJson = (prev, next) => JSON.stringify(prev ?? null) !== JSON.stringify(next ?? null);

// Newest first, at most 5, no duplicates.
export const pushRecent = (list, note) => [note, ...list.filter((n) => n !== note)].slice(0, MAX_RECENT);
