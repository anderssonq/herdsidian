// The Archived store: spaces and agents hidden from the main sidebar lists, never closed.
// Canonical copy: lib/archive.js. Pure (no Herdr or GPUI imports), so Node tests import it.
// Stored in shared("herdsidian.archived") as { spaces: [space id], agents: [agent address] }.

export const ARCHIVE_KEY = "herdsidian.archived";

const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

// A stored value -> { spaces, agents }; anything missing or mistyped reads as empty.
export function readArchive(raw) {
  const ok = raw && typeof raw === "object" && !Array.isArray(raw);
  return { spaces: ok ? strings(raw.spaces) : [], agents: ok ? strings(raw.agents) : [] };
}

// `kind`: "spaces" | "agents". A write touches its own list only; the other is re-read as stored.
export function withArchived(raw, kind, id) {
  const now = readArchive(raw);
  return now[kind].includes(id) ? now : { ...now, [kind]: [...now[kind], id] };
}

export function withoutArchived(raw, kind, id) {
  const now = readArchive(raw);
  return now[kind].includes(id) ? { ...now, [kind]: now[kind].filter((x) => x !== id) } : now;
}

// An agent is archived on its own (its address) or through its space.
export const isArchivedAgent = (store, a) => store.agents.includes(a.address) || store.spaces.includes(a.space);

const machineOf = (id) => (id.includes("/") ? id.split("/")[0] : null);

// Drops space ids that are gone, but only on a machine whose layout is "ready" (a machine that is
// loading, away or unknown still has spaces we cannot see). Same object when nothing is dropped.
export function prunedSpaces(store, machineList, spaceList) {
  const ready = new Set((Array.isArray(machineList) ? machineList : []).filter((m) => m.layout === "ready").map((m) => m.name ?? null));
  const listed = new Set(spaceList.map((s) => s.id));
  const kept = store.spaces.filter((id) => listed.has(id) || !ready.has(machineOf(id)));
  return kept.length === store.spaces.length ? store : { ...store, spaces: kept };
}

// Drops agent addresses that ended, like prunePins: only for machines the terminals list has heard from.
export function prunedAgents(store, terminalList) {
  const heard = new Set(terminalList.map((k) => machineOf(k.address)));
  const live = new Set(terminalList.filter((k) => k.state === "live").map((k) => k.address));
  const kept = store.agents.filter((addr) => !heard.has(machineOf(addr)) || live.has(addr));
  return kept.length === store.agents.length ? store : { ...store, agents: kept };
}

// space.move indexes are 1-based over spaces() as a whole. A machine's spaces sit in one block.
const block = (spaceList, id) => {
  const machine = spaceList.find((s) => s.id === id)?.machine ?? null;
  const at = spaceList.map((s, i) => ((s.machine ?? null) === machine ? i : -1)).filter((i) => i >= 0);
  return { machine, first: at[0] ?? 0, count: at.length };
};

// Archive: the end of its machine's block.
export function endIndex(spaceList, id) {
  const b = block(spaceList, id);
  return b.first + b.count;
}

// Restore (`archivedIds` already without `id`): just after the last visible space of its machine, which
// is just before the first archived one left there, or the end of the block when none is.
export function restoreIndex(spaceList, archivedIds, id) {
  const b = block(spaceList, id);
  const others = spaceList.filter((s) => s.id !== id && (s.machine ?? null) === b.machine);
  const firstArchived = others.findIndex((s) => archivedIds.includes(s.id));
  return b.first + 1 + (firstArchived < 0 ? others.length : firstArchived);
}

// A visible space that sits after an archived one of its machine (a new space, or one moved by another
// screen): { id, index } to put it back before the archived ones, else null. One at a time.
// `skip`: a Set or array of ids not to return (already put back once).
export function stray(spaceList, archivedIds, skip = []) {
  const seen = new Set();
  const skipped = new Set(skip);
  for (const s of spaceList) {
    const machine = s.machine ?? null;
    if (archivedIds.includes(s.id)) seen.add(machine);
    else if (seen.has(machine) && !skipped.has(s.id)) return { id: s.id, index: restoreIndex(spaceList, archivedIds, s.id) };
  }
  return null;
}
