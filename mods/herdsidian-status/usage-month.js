// Usage for the agent CLIs that report a month and no limits: Kiro (credits, from its session JSON)
// and Grok (cost and tokens, from the Herdsidian status line hook's state files). The listing scripts,
// the month sums and the text. Pure: imports only ./agent-files.js, so Node tests import it.
// Each reader runs one read-only /bin/sh listing, then reads the listed .json files.
import { formatTokens, isReadable, grokListScript, kiroListScript, parseGrokState, parseKiroSession, parseListing } from "./agent-files.js";

// Card notes for a missing source. usage.js looks them up through errorText().
export const MONTH_NOTES = {
  kiroNoSessions: "No Kiro sessions found.",
  grokNoHook: "Grok usage needs the Herdsidian status line hook. See Usage in the README.",
};
export const GROK_NOTE = "Only Grok sessions run with the Herdsidian status line.";

const KIRO_LIST_SCRIPT = kiroListScript();
const GROK_LIST_SCRIPT = grokListScript();

const DAY = 86400000;
const BATCH = 16;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The calendar month of `nowMs` in the local time zone: its key and its [start, end) in ms.
function monthOf(nowMs) {
  const d = new Date(nowMs);
  const y = d.getFullYear(), m = d.getMonth();
  return { month: `${y}-${String(m + 1).padStart(2, "0")}`, startMs: new Date(y, m, 1).getTime(), endMs: new Date(y, m + 1, 1).getTime() };
}

// "2026-11" -> "Nov".
export const monthLabel = (month) => MONTHS[Number(String(month).slice(5, 7)) - 1] ?? "";

// Credits and dollars: two decimals. The card shows the bare number after "Credits".
export const twoDecimals = (n) => n.toFixed(2);
const formatCredits = (n) => `${twoDecimals(n)} cr`;
export const formatUsd = (n) => `$${twoDecimals(n)}`;

// The status bar text of a month value: Kiro's credits, else Grok's cost, else its token total.
export function monthText(d) {
  if (d.credits !== null) return formatCredits(d.credits);
  if (d.costUsd !== null) return formatUsd(d.costUsd);
  return `${formatTokens(d.tokens ?? 0)} tok`;
}

const round2 = (n) => Math.round(n * 100) / 100;

// The listed files touched since `sinceMs`. One of MAX_READ_BYTES or more is never read (see
// isReadable), so the month counts it in `skipped` and the card warns about it.
const candidates = (listing, sinceMs) => listing.files.filter((f) => f.mtimeMs >= sinceMs);

// What a reader needs before it counts: a missing source, or "every candidate was skipped".
function sourceError(listing, found, skipped, note) {
  if (listing.dir === null || listing.files.length === 0) return { error: note };
  if (found > 0 && skipped === found) return { error: "unavailable" };
  return null;
}

// listing: parseListing(); texts: Map<path, file text | null>. -> a month value or { error }.
function kiroMonth(listing, texts, nowMs) {
  const { month, startMs, endMs } = monthOf(nowMs);
  const files = candidates(listing, startMs);
  let credits = 0, sessions = 0, turns = 0, skipped = 0, at = null;
  for (const f of files) {
    const s = texts.has(f.path) ? parseKiroSession(texts.get(f.path)) : null;
    if (!s) { skipped++; continue; }
    let counted = 0;
    for (const t of s.turns) {
      const when = t.endMs ?? s.updatedAt;
      if (when === null || when < startMs || when >= endMs) continue;
      counted++; credits += t.credits;
      if (at === null || when > at) at = when;
    }
    turns += counted;
    if (counted) sessions++;
  }
  const bad = sourceError(listing, files.length, skipped, "kiroNoSessions");
  if (bad) return bad;
  return { kind: "month", month, credits: round2(credits), costUsd: null, tokens: null, sessions, turns, skipped, at };
}

function grokMonth(listing, texts, nowMs) {
  const { month, startMs, endMs } = monthOf(nowMs);
  const files = candidates(listing, startMs - DAY); // updated_at decides; the day is slack
  let cost = null, tokens = 0, sessions = 0, skipped = 0, at = null;
  for (const f of files) {
    const s = texts.has(f.path) ? parseGrokState(texts.get(f.path)) : null;
    if (!s) { skipped++; continue; }
    if (s.updated_at < startMs || s.updated_at >= endMs) continue;
    sessions++;
    if (s.cost_usd !== null) cost = (cost ?? 0) + s.cost_usd;
    tokens += (s.session_input_tokens ?? 0) + (s.session_output_tokens ?? 0);
    if (at === null || s.updated_at > at) at = s.updated_at;
  }
  const bad = sourceError(listing, files.length, skipped, "grokNoHook");
  if (bad) return bad;
  // No session this month reads as $0.00, not as an unknown cost.
  const costUsd = sessions === 0 ? 0 : cost === null ? null : round2(cost);
  return { kind: "month", month, credits: null, costUsd, tokens, sessions, turns: null, skipped, at };
}

// One listing exec, then the candidate files in batches. -> a month value or { error }. Never throws.
async function fetchMonth(script, exec, readTextFile, nowMs, slackMs, build) {
  const res = await exec("/bin/sh", ["-c", script]);
  if (res.code !== 0) return { error: "unavailable" };
  const listing = parseListing(res.stdout);
  const files = candidates(listing, monthOf(nowMs).startMs - slackMs).filter(isReadable);
  const texts = new Map();
  for (let i = 0; i < files.length; i += BATCH) {
    await Promise.all(files.slice(i, i + BATCH).map(async (f) => {
      try { texts.set(f.path, await readTextFile(f.path)); } catch { texts.set(f.path, null); }
    }));
  }
  return build(listing, texts, nowMs);
}

export async function fetchKiro(exec, readTextFile, nowMs = Date.now()) {
  try { return await fetchMonth(KIRO_LIST_SCRIPT, exec, readTextFile, nowMs, 0, kiroMonth); }
  catch { return { error: "unavailable" }; }
}

export async function fetchGrok(exec, readTextFile, nowMs = Date.now()) {
  try { return await fetchMonth(GROK_LIST_SCRIPT, exec, readTextFile, nowMs, DAY, grokMonth); }
  catch { return { error: "unavailable" }; }
}
