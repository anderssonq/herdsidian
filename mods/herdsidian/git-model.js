// The Git tab's view model: initials, author slot, pill choice, filter, header text, splitter clamp, refs key. Pure.

const LETTER = /\p{L}/u;
const MIN_GRAPH = 96;
const MIN_DETAIL = 120;
const SLOTS = 6;

export const shortHash = (hash) => String(hash || "").slice(0, 7);

// The first letter (one whole code point) of each of the first and the last word that has a letter.
export function initialsOf(name) {
  const letters = [];
  for (const word of String(name || "").split(/\s+/)) {
    for (const ch of word) {
      if (LETTER.test(ch)) { letters.push(ch.toUpperCase()); break; }
    }
  }
  if (!letters.length) return "?";
  return letters.length === 1 ? letters[0] : letters[0] + letters[letters.length - 1];
}

// FNV-1a over the UTF-16 units of the lower-cased email (the name when there is no email).
export function authorSlot(email, name) {
  const key = String(email || "").toLowerCase() || String(name || "").toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) % SLOTS;
}

export function refsByCommit(refs) {
  const map = new Map();
  for (const r of refs || []) {
    const list = map.get(r.sha);
    if (list) list.push(r); else map.set(r.sha, [r]);
  }
  return map;
}

// The refs the tab draws: the snapshot's, plus a "HEAD" pill on HEAD's commit when HEAD is detached (AC32). It is
// current, so pickPill shows it first and it is outlined; it comes first in the detail too.
export const shownRefs = (snap) => (!snap.branch && snap.head
  ? [{ full: "HEAD", name: "HEAD", kind: "head", sha: snap.head, current: true }, ...(snap.refs || [])]
  : snap.refs || []);

const byName =(a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export const refsKey = (snap) => {
  const refs = [...(snap.refs || [])].sort(byName).map((r) => `${r.kind}:${r.name}=${r.sha}`);
  return [snap.head || "", snap.branch || "", ...refs].join("\n");
};

// The ref a commit shows: current branch, then local, remote, tag; name order inside a kind.
export function pickPill(refs) {
  if (!refs || !refs.length) return null;
  let chosen = refs.find((r) => r.current);
  if (!chosen) {
    for (const kind of ["local", "remote", "tag"]) {
      const group = refs.filter((r) => r.kind === kind).sort(byName);
      if (group.length) { chosen = group[0]; break; }
    }
  }
  if (!chosen) chosen = refs[0];
  return { ref: chosen, more: refs.length - 1 };
}

export function matchCommits(commits, byCommit, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return commits;
  return commits.filter((c) => {
    if (c.hash.toLowerCase().startsWith(q)) return true;
    if (`${c.subject}\n${c.author}\n${c.email}`.toLowerCase().includes(q)) return true;
    return (byCommit.get(c.hash) || []).some((r) => r.name.toLowerCase().includes(q));
  });
}

export const headerOf = (snap) => {
  const detached = !snap.branch;
  return {
    label: detached ? `detached HEAD ${shortHash(snap.head)}` : snap.branch,
    ahead: snap.ahead,
    behind: snap.behind,
    noUpstream: !detached && !snap.upstream,
  };
};

// The detail height: the graph keeps 96 first, then the detail keeps 120 when there is room.
export function clampSplit(detail, total) {
  const max = Math.max(0, total - MIN_GRAPH);
  return Math.min(Math.max(detail, MIN_DETAIL), max);
}
