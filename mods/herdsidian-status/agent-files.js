// Shared by Usage (herdsidian-status) and the context ring (guide-agents): where the agent
// CLIs keep their session files, the read-only listing scripts, and the parsers for Kiro's
// session JSON, Kiro's messages.jsonl usage lines and the Grok status line hook's state file. Pure: no imports, no file,
// process or network access here. The shell snippets are constant strings that a mod runs
// through /bin/sh. Copied byte for byte into both mods (ADR-0001); lint checks the copies.

export const MAX_READ_BYTES = 1048576;
// A listed file readTextFile can read (it refuses MAX_READ_BYTES or more).
export const isReadable = (f) => f.size < MAX_READ_BYTES;
// ADR-0002: the Herdsidian state folder, resolved by the shell.
export const STATE_DIR_SH = '${XDG_STATE_HOME:-$HOME/.local/state}/herdsidian';
// Run before STATE_DIR_SH: a relative $XDG_STATE_HOME is ignored (XDG spec), as the Grok hook does.
export const DROP_RELATIVE_STATE_HOME_SH = 'case "$XDG_STATE_HOME" in /*) ;; *) XDG_STATE_HOME= ;; esac';

// Prints <kiro>: $KIRO_HOME (one trailing / dropped) when it is absolute, not "/", not $HOME
// and not a parent of $HOME; otherwise $HOME/.kiro. This is Kiro's own rule.
export const KIRO_DIR_FN = 'kiro_dir() { k="${KIRO_HOME%/}"; case "$k" in /?*) case "$HOME/" in "$k"/*) k="";; esac;; *) k="";; esac; if [ -n "$k" ]; then printf %s "$k"; else printf %s "$HOME/.kiro"; fi; }';

// list_json <dir> [minutes]: "nodir" when <dir> is not a folder, else "dir <dir>" and one
// "<mtimeSec> <sizeBytes> <abs path>" line per top-level *.json (only those modified in the
// last <minutes> when given). Reads nothing and writes nothing.
export const LIST_JSON_FN = `list_json() {
  d="$1"
  if [ ! -d "$d" ]; then printf 'nodir\\n'; return 0; fi
  printf 'dir %s\\n' "$d"
  if [ -n "$2" ]; then
    find "$d" -maxdepth 1 -type f -name '*.json' -mmin "-$2" -exec stat -f '%m %z %N' {} + 2>/dev/null
  else
    find "$d" -maxdepth 1 -type f -name '*.json' -exec stat -f '%m %z %N' {} + 2>/dev/null
  fi
  return 0
}`;

const minutesArg = (minutes) => (minutes ? ` ${minutes}` : "");
// The listing of <kiro>/sessions/cli and of the Grok hook's folder; minutes as in list_json.
export const kiroListScript = (minutes) => [KIRO_DIR_FN, LIST_JSON_FN, `list_json "$(kiro_dir)/sessions/cli"${minutesArg(minutes)}`].join("\n");
export const grokListScript = (minutes) => [DROP_RELATIVE_STATE_HOME_SH, LIST_JSON_FN, `list_json "${STATE_DIR_SH}/grok"${minutesArg(minutes)}`].join("\n");

// Kiro's newer session files: <kiro>/sessions/<workspace hash or _global>/sess_<id>/messages.jsonl.
// The shell opens at most this many of them (newest first) per reading; the rest count as skipped.
export const KIRO_USAGE_MAX_FILES = 400;

// Per usage_summary line, rebuilds a small JSON line from three fields only: the line's
// "timestamp" and, per summary entry (the text after each "{"), its "unit" and numeric "usage"
// in any key order. Nothing else of the line is printed. Assumes an entry holds no nested object
// (usedTools is a string array, as reported); a nested "{" would drop that entry's credits.
// No ">" and no single quote: the program sits in single quotes in KIRO_USAGE_FN.
const KIRO_USAGE_AWK = `{
  t = ""
  if (match($0, /"timestamp":"[^"]*"/)) t = substr($0, RSTART, RLENGTH)
  i = index($0, "promptTurnSummaries")
  if (t == "" || i == 0) next
  n = split(substr($0, i), e, "{"); out = ""
  for (j = 2; j <= n; j++) {
    u = ""; v = ""
    if (match(e[j], /"unit":"[^"]*"/)) u = substr(e[j], RSTART, RLENGTH)
    if (match(e[j], /"usage":-?[0-9][0-9.eE+-]*/)) v = substr(e[j], RSTART, RLENGTH)
    if (u == "" || v == "") continue
    out = out (out == "" ? "" : ",") "{" u "," v "}"
  }
  print "new use {" t ",\\"payload\\":{\\"type\\":\\"usage_summary\\",\\"promptTurnSummaries\\":[" out "]}}"
}`;

// kiro_usage <sessions dir> <since epoch s>: "new nodir" when <dir> is not a folder, else
// "new dir <dir>", one "new total" per sess_*/messages.jsonl, and for each one modified at or
// after <since> (newest first, at most KIRO_USAGE_MAX_FILES): "new skip" when over the cap or
// not readable, else "new sess <sess_ folder name>" and one "new use <json>" per usage_summary
// line (timestamp, unit and usage only). Paths stay arguments. Reads only, writes nothing.
// OQ1 (open): only these parent files are read. Whether sub-agent executions write their own
// usage_summary lines elsewhere is unverified; walking more folders is a later, conscious change.
const KIRO_USAGE_FN = `kiro_usage() {
  d="$1"
  if [ ! -d "$d" ]; then printf 'new nodir\\n'; return 0; fi
  printf 'new dir %s\\n' "$d"
  n=0
  find "$d" -mindepth 3 -maxdepth 3 -type f -name messages.jsonl -path '*/sess_*/messages.jsonl' -exec stat -f '%m %N' {} + 2>/dev/null | sort -rn | while IFS= read -r l; do
    m="\${l%% *}"; f="\${l#* }"; s="\${f%/messages.jsonl}"
    case "$m" in ''|*[!0-9]*) continue ;; esac
    case "\${s##*/}" in sess_*) ;; *) continue ;; esac
    printf 'new total\\n'
    if [ "$m" -lt "$2" ]; then continue; fi
    n=$((n + 1))
    if [ "$n" -gt ${KIRO_USAGE_MAX_FILES} ] || [ ! -r "$f" ]; then printf 'new skip\\n'; continue; fi
    printf 'new sess %s\\n' "\${s##*/}"
    grep -F '"type":"usage_summary"' "$f" 2>/dev/null | awk '${KIRO_USAGE_AWK}'
  done
  return 0
}`;

// Usage's one Kiro exec: the old sessions/cli listing, then the messages.jsonl usage lines
// for files touched since <sinceSec> (the local month start, an integer from JS).
export const kiroUsageScript = (sinceSec) => [KIRO_DIR_FN, LIST_JSON_FN, KIRO_USAGE_FN,
  'list_json "$(kiro_dir)/sessions/cli"', `kiro_usage "$(kiro_dir)/sessions" ${Math.floor(Number(sinceSec)) || 0}`].join("\n");

// -> { dir: string | null, files: [{ path, mtimeMs, size }] }. Lines that do not fit are dropped.
export function parseListing(stdout) {
  const out = { dir: null, files: [] };
  for (const line of String(stdout ?? "").split("\n")) {
    if (line.startsWith("dir /")) { out.dir = line.slice(4); continue; }
    const m = line.match(/^(\d+) (\d+) (\/.+)$/);
    if (m) out.files.push({ path: m[3], mtimeMs: Number(m[1]) * 1000, size: Number(m[2]) });
  }
  return out;
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const object = (raw) => {
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw);
    return isObject(v) ? v : null;
  } catch { return null; }
};
export const finite = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v) => (typeof v === "string" ? v : null);
const ms = (v) => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

// Kiro session JSON -> { cwd, updatedAt, turns: [{ endMs, credits }], context } or null.
// The title and every other field are never copied.
export function parseKiroSession(raw) {
  const j = object(raw);
  if (!j) return null;
  const state = isObject(j.session_state) ? j.session_state : {};
  const meta = isObject(state.conversation_metadata) ? state.conversation_metadata : {};
  const turns = (Array.isArray(meta.user_turn_metadatas) ? meta.user_turn_metadatas : []).filter(isObject).map((t) => {
    let credits = 0;
    for (const u of Array.isArray(t.metering_usage) ? t.metering_usage : []) {
      if (isObject(u) && u.unit === "credit" && finite(u.value) !== null) credits += u.value;
    }
    return { endMs: ms(t.end_timestamp), credits };
  });
  const rts = isObject(state.rts_model_state) ? state.rts_model_state : {};
  const last = isObject(meta.last_context_usage) ? meta.last_context_usage : {};
  const percent = finite(rts.context_usage_percentage) ?? finite(last.percentage);
  const windowTokens = finite(isObject(rts.model_info) ? rts.model_info.context_window_tokens : null);
  return {
    cwd: text(j.cwd),
    updatedAt: ms(j.updated_at),
    turns,
    context: percent === null ? null : { percent, windowTokens },
  };
}

// Kiro session JSON -> its top-level session_id string, or null. Usage merges on it.
export const kiroSessionId = (raw) => text(object(raw)?.session_id);

// usage_summary lines (whole messages.jsonl lines or the shell's three-field lines), with
// optional "sess <id>" lines that start a session -> [{ id, turns: [{ atMs, credits }] }].
// A turn's credits are the finite `usage` of its "credit" entries. A line that is not one JSON
// object of type usage_summary, or whose timestamp does not parse, is dropped.
export function parseKiroUsageLines(raw) {
  const sessions = [];
  let current = null;
  const start = (id) => { current = { id, turns: [] }; sessions.push(current); };
  for (const line of String(raw ?? "").split("\n")) {
    if (line.startsWith("sess ")) { start(line.slice(5)); continue; }
    const j = object(line);
    const p = j && isObject(j.payload) ? j.payload : null;
    const atMs = p?.type === "usage_summary" ? ms(j.timestamp) : null;
    if (atMs === null) continue;
    let credits = 0;
    for (const u of Array.isArray(p.promptTurnSummaries) ? p.promptTurnSummaries : []) {
      if (isObject(u) && u.unit === "credit" && finite(u.usage) !== null) credits += u.usage;
    }
    if (!current) start(null);
    current.turns.push({ atMs, credits });
  }
  return sessions;
}

// The "new ..." lines of kiroUsageScript -> { dir, total, skipped, sessions } (sessions as in
// parseKiroUsageLines). No such lines -> dir null.
export function parseKiroUsageListing(stdout) {
  const out = { dir: null, total: 0, skipped: 0, sessions: [] };
  const lines = [];
  for (const line of String(stdout ?? "").split("\n")) {
    if (!line.startsWith("new ")) continue;
    const l = line.slice(4);
    if (l.startsWith("dir /")) out.dir = l.slice(4);
    else if (l === "total") out.total++;
    else if (l === "skip") out.skipped++;
    else if (l.startsWith("sess ")) lines.push(l);
    else if (l.startsWith("use ")) lines.push(l.slice(4));
  }
  out.sessions = parseKiroUsageLines(lines.join("\n"));
  return out;
}

// Grok hook state file -> exactly the 11 keys of the state-file contract, or null.
export function parseGrokState(raw) {
  const j = object(raw);
  if (!j || j.v !== 1 || typeof j.session_id !== "string" || finite(j.updated_at) === null) return null;
  return {
    v: 1,
    session_id: j.session_id,
    cwd: text(j.cwd),
    model: text(j.model),
    updated_at: j.updated_at,
    cost_usd: finite(j.cost_usd),
    context_window_size: finite(j.context_window_size),
    context_tokens: finite(j.context_tokens),
    used_percentage: finite(j.used_percentage),
    session_input_tokens: finite(j.session_input_tokens),
    session_output_tokens: finite(j.session_output_tokens),
  };
}

// 999 -> "999", 12300 -> "12.3K", 124000 -> "124K", 1234567 -> "1.2M". A trailing ".0" is dropped.
export function formatTokens(n) {
  if (!Number.isFinite(n)) return "0";
  const one = (x) => x.toFixed(1).replace(/\.0$/, "");
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) {
    const k = Math.round(n / 100) / 10;
    return k >= 1000 ? "1M" : `${one(k)}K`;
  }
  return `${one(Math.round(n / 1e5) / 10)}M`;
}
