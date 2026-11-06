// Usage beside Search: the providers, the three parsers, the formatting, the fetch scripts and
// the cache. Pure: no herdr / gpui-kit imports, so Node tests import it. Programs run: /bin/sh
// (with /usr/bin/security, /usr/bin/plutil, /usr/bin/curl, cat, find, stat, sort, head, grep, tail) and opencode. Network: api.anthropic.com only.

export const PROVIDER_KEYS = ["claude", "codex", "opencode"]; // S1: the order everywhere
export const FETCH_LIMIT_MS = 15000; // S3, below exec's own 30 s
export const CACHE_MS = 5 * 60 * 1000; // D6

export const ERROR_TEXT = {
  signedOut: "Not signed in to Claude Code.",
  login: "Open Claude Code to refresh its login.",
  none: "No Codex usage recorded yet.",
  timeout: "Timed out.",
  unavailable: "Usage unavailable.",
};
export const EMPTY_NONE = "No supported agent CLI is installed. Usage covers Claude Code, Codex and opencode.";
export const EMPTY_FAILED = "Cannot list the installed agents.";

// The knownAgents() entries that are installed and supported, in S1 order, one per key.
export function providersFrom(list) {
  if (!Array.isArray(list)) return [];
  return PROVIDER_KEYS.map((key) => list.find((a) => a?.key === key && a.installed === true)).filter(Boolean);
}

const finite = (n) => typeof n === "number" && Number.isFinite(n);
const MINUTE = 60000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

// The one clamp: rounded, 0-100.
const clampPercent = (value) => Math.min(100, Math.max(0, Math.round(value)));

// 23.4 -> "23%", clamped to 0-100.
export const formatPercent = (value) => `${clampPercent(value)}%`;

// "reset" in the past or now, else how long is left. null (no reset time) gives no text.
export function formatReset(resetMs, now) {
  if (!finite(resetMs)) return "";
  const left = resetMs - now;
  if (left <= 0) return "reset";
  if (left < MINUTE) return "resets in <1 m";
  if (left < HOUR) return `resets in ${Math.floor(left / MINUTE)} m`;
  if (left < DAY) return `resets in ${Math.floor(left / HOUR)} h ${Math.floor((left % HOUR) / MINUTE)} m`;
  return `resets in ${Math.floor(left / DAY)} d ${Math.floor((left % DAY) / HOUR)} h`;
}

// 10080 -> "7 d", 300 -> "5 h", 45 -> "45 m".
export function formatWindow(minutes) {
  if (minutes % 1440 === 0) return `${minutes / 1440} d`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} m`;
}

// "updated 5 m ago". null (no reading time) gives no text.
export function formatAge(atMs, now) {
  if (!finite(atMs)) return "";
  const age = Math.max(0, now - atMs);
  if (age < MINUTE) return "updated just now";
  if (age < HOUR) return `updated ${Math.floor(age / MINUTE)} m ago`;
  if (age < DAY) return `updated ${Math.floor(age / HOUR)} h ago`;
  return `updated ${Math.floor(age / DAY)} d ago`;
}

// What a row shows. A window already reset shows 0% (`zeroPast`: Codex, whose reading can be old).
export function windowView(w, now, zeroPast = false) {
  const past = finite(w.resetsAt) && w.resetsAt - now <= 0;
  const percent = zeroPast && past ? 0 : clampPercent(w.percent);
  return { label: w.label, percent, percentText: `${percent}%`, resetText: formatReset(w.resetsAt, now) };
}

// ---- Claude Code ----

const isoMs = (v) => { if (typeof v !== "string") return null; const ms = Date.parse(v); return Number.isNaN(ms) ? null : ms; };

// The HTTP status and body of GET /api/oauth/usage. Other fields of the body are ignored.
export function parseClaude(status, body) {
  const code = Number(status);
  if (code === 401) return { error: "login" };
  if (code !== 200) return { error: "unavailable" };
  let json;
  try { json = JSON.parse(body); } catch { return { error: "unavailable" }; }
  const windows = [];
  for (const [field, label] of [["five_hour", "5 h"], ["seven_day", "7 d"]]) {
    const w = json?.[field];
    if (!w || typeof w !== "object" || !finite(w.utilization)) return { error: "unavailable" };
    windows.push({ label, percent: w.utilization, resetsAt: isoMs(w.resets_at) });
  }
  return { data: { kind: "limits", windows, plan: null, at: null } };
}

// The script prints the body, a newline, then the HTTP status; "nocreds" when it found no token.
export function parseClaudeOutput(stdout) {
  const text = String(stdout ?? "");
  const cut = text.lastIndexOf("\n");
  if (cut < 0) return { error: "unavailable" };
  const status = text.slice(cut + 1).trim();
  if (status === "nocreds") return { error: "signedOut" };
  return parseClaude(status, text.slice(0, cut));
}

// The token reader: stdin is the credentials JSON, stdout is claudeAiOauth.accessToken only (the
// same item also holds mcpOAuth.<server>.accessToken entries, which must never be sent). A missing
// path prints nothing. The JSON comes on stdin, so the token is in no argv.
export const TOKEN_FN = `tok() { /usr/bin/plutil -extract claudeAiOauth.accessToken raw -o - - 2>/dev/null ; }`;

// A constant: the token is read and sent inside this one pipeline. printf is a builtin and curl
// reads the header from stdin (-H @-), so the token is in no argv. `-q` (first) skips ~/.curlrc;
// only https, no redirect. Only the body and the status are printed. Nothing is written, and
// nothing but api.anthropic.com is reached.
export const CLAUDE_SCRIPT = [
  TOKEN_FN,
  `t=$(/usr/bin/security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null | tok)`,
  `[ -n "$t" ] || t=$(cat "$HOME/.claude/.credentials.json" 2>/dev/null | tok)`,
  `[ -n "$t" ] || { printf '\\nnocreds'; exit 0; }`,
  `printf 'Authorization: Bearer %s\\n' "$t" | /usr/bin/curl -q -s -m 12 --proto =https --max-redirs 0 -H @- -H "anthropic-beta: oauth-2025-04-20" -w '\\n%{http_code}' https://api.anthropic.com/api/oauth/usage`,
].join("\n");

// ---- Codex ----

// The last token_count line of a session file: windows, plan and reading time, or null.
export function parseCodexLine(text) {
  let line;
  try { line = JSON.parse(text); } catch { return null; }
  if (line?.payload?.type !== "token_count") return null;
  const limits = line.payload.rate_limits;
  if (!limits || typeof limits !== "object") return null;
  const windows = [];
  for (const field of ["primary", "secondary"]) {
    const w = limits[field];
    if (!w || !finite(w.used_percent) || !finite(w.window_minutes) || w.window_minutes <= 0) continue;
    windows.push({ label: formatWindow(w.window_minutes), percent: w.used_percent, resetsAt: finite(w.resets_at) ? w.resets_at * 1000 : null });
  }
  if (!windows.length) return null;
  const at = typeof line.timestamp === "string" ? Date.parse(line.timestamp) : NaN;
  return { kind: "limits", windows, plan: typeof limits.plan_type === "string" ? limits.plan_type : null, at: Number.isNaN(at) ? null : at };
}

// For the 5 newest session files (newest first), the last token_count line that has a window.
// Read-only: find, stat, sort, grep and tail on ~/.codex/sessions. "mtime path" lines sorted on the
// number, so the whole set is ordered at once (no batches); the path is what follows the first space.
export const CODEX_SCRIPT = [
  `find "$HOME/.codex/sessions" -type f -name '*.jsonl' -exec stat -f '%m %N' {} + 2>/dev/null | sort -rn | head -n 5 | while IFS= read -r line; do`,
  `  f=\${line#* }`,
  `  grep '"token_count"' "$f" 2>/dev/null | grep '"primary"' | tail -n 1`,
  `done`,
].join("\n");

export function parseCodexOutput(stdout) {
  for (const line of String(stdout ?? "").split("\n")) {
    if (!line.trim()) continue;
    const data = parseCodexLine(line);
    if (data) return { data };
  }
  return { error: "none" };
}

// ---- opencode ----

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

// The "Total Cost", "Input" and "Output" rows of `opencode stats --days 7`, as printed.
export function parseOpencode(text) {
  const found = {};
  for (const raw of String(text ?? "").replace(ANSI, "").split("\n")) {
    const row = raw.replace(/[│┃|]/g, " ").trim();
    for (const [key, name] of [["cost", "Total Cost"], ["input", "Input"], ["output", "Output"]]) {
      if (row.startsWith(name) && /\s/.test(row.charAt(name.length))) found[key] ??= row.slice(name.length).trim();
    }
  }
  if (!found.cost || !found.input || !found.output) return { error: "unavailable" };
  return { data: { kind: "stats", cost: found.cost, input: found.input, output: found.output } };
}

// ---- fetching ----

// One provider's reading: {data} or {error}. Never throws.
export async function fetchProvider(key, exec) {
  try {
    if (key === "claude") {
      const res = await exec("/bin/sh", ["-c", CLAUDE_SCRIPT]);
      return res.code === 0 ? parseClaudeOutput(res.stdout) : { error: "unavailable" };
    }
    if (key === "codex") {
      const res = await exec("/bin/sh", ["-c", CODEX_SCRIPT]);
      return res.code === 0 ? parseCodexOutput(res.stdout) : { error: "unavailable" };
    }
    if (key === "opencode") {
      const res = await exec("opencode", ["stats", "--days", "7"]);
      return res.code === 0 ? parseOpencode(res.stdout) : { error: "unavailable" };
    }
  } catch {}
  return { error: "unavailable" };
}

// The in-memory cache (S4). `exec(command, args)` runs a program; `after(ms, fn)` starts a timer and
// returns its cancel function; `onChange()` asks for a redraw. Only the parsed readings are kept.
export function createUsage({ exec, after, now = Date.now, onChange = () => {}, limitMs = FETCH_LIMIT_MS, ttlMs = CACHE_MS }) {
  const entries = new Map();
  const running = new Set(); // providers whose process has not settled, even past the limit
  let serial = 0;

  const finish = (key, id, result) => {
    const entry = entries.get(key);
    if (!entry || entry.id !== id || entry.state !== "loading") return; // a late answer after the limit
    entry.cancel?.();
    entries.set(key, result.error
      ? { id, state: "error", error: result.error }
      : { id, state: "ok", data: result.data, at: now() });
    onChange();
  };

  const start = (key) => {
    const id = ++serial;
    const entry = { id, state: "loading", cancel: null };
    entries.set(key, entry);
    entry.cancel = after(limitMs, () => finish(key, id, { error: "timeout" }));
    running.add(key);
    fetchProvider(key, exec).then((result) => { running.delete(key); finish(key, id, result); });
  };

  return {
    // The pointer entered the control: fetch what is missing, failed or older than the cache.
    hover(keys) {
      for (const key of keys) {
        const entry = entries.get(key);
        if (entry?.state === "loading" || running.has(key)) continue; // a timed-out process may still run (a Keychain dialog)
        if (entry?.state === "ok" && now() - entry.at < ttlMs) continue;
        start(key);
      }
    },
    // {state: "loading" | "ok" | "error", ...}; a provider not fetched yet is loading.
    view: (key) => entries.get(key) ?? { state: "loading" },
  };
}
