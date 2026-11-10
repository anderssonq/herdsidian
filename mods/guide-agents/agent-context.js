// The context ring's data (ADR-0005): how full each agent's context window is, from the agent
// CLI's own session files. An agent maps to the newest session of its program whose folder is
// its pane's live cwd, modified in the last 24 h. Claude Code and Codex logs can pass 1 MiB, so
// one read-only /bin/sh exec per program looks at their last 256 KiB and prints only numbers,
// model ids and folders. Kiro and the Grok hook files are small JSON read with readTextFile.
// Pure: no host import; the mod hands in exec, readTextFile and sleep.
import {
  MAX_READ_BYTES, formatTokens, grokListScript, kiroListScript, parseGrokState, parseKiroSession, parseListing,
} from "./agent-files.js";

export const CONTEXT_KEYS = ["claude", "codex", "kiro", "grok"];
export const CONTEXT_EVERY_MS = 30000;
const CONTEXT_LIMIT_MS = 10000;
const FRESH_MS = 86400000;
const TAIL_BYTES = 262144;

// Claude Code's project folder name: every character outside [A-Za-z0-9] becomes "-".
export const claudeDir = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, "-");

// Args: Claude folder names. Per folder, "@@ <dir>", then from the newest top-level *.jsonl
// modified in the last 24 h, the model and token fields of the last main-thread assistant line
// with a usage, from its last 256 KiB only. Claude Code's synthetic API-error lines (all-zero
// usage) are skipped.
export const CLAUDE_CONTEXT_SCRIPT = `for d in "$@"; do
  case "$d" in ""|*/*|.|..) continue;; esac
  printf '@@ %s\\n' "$d"
  l=$(find "$HOME/.claude/projects/$d" -maxdepth 1 -type f -name '*.jsonl' -mmin -1440 -exec stat -f '%m %N' {} + 2>/dev/null | sort -rn | head -n 1)
  [ -n "$l" ] || continue
  tail -c ${TAIL_BYTES} "\${l#* }" 2>/dev/null | grep '"type":"assistant"' | grep -v -E '"isSidechain":true|"isApiErrorMessage":true|"model":"<synthetic' | grep '"usage"' | tail -n 1 | grep -o -E '"(model|input_tokens|cache_read_input_tokens|cache_creation_input_tokens)":("[^"]*"|[0-9]+)'
done
exit 0`;

// No args. Per Codex session modified in the last 24 h: "@@ <mtimeSec>", the cwd of its first
// line, then the window and last usage of the last token_count line in its last 256 KiB.
export const CODEX_CONTEXT_SCRIPT = `find "$HOME/.codex/sessions" -type f -name '*.jsonl' -mmin -1440 -exec stat -f '%m %N' {} + 2>/dev/null | while read -r m f; do
  printf '@@ %s\\n' "$m"
  head -n 1 "$f" 2>/dev/null | grep -o -E '"cwd":"([^"\\\\]|\\\\.)*"' | head -n 1
  tail -c ${TAIL_BYTES} "$f" 2>/dev/null | grep '"model_context_window"' | tail -n 1 | grep -o -E '"model_context_window":[0-9]+|"last_token_usage":\\{[^}]*\\}'
done
exit 0`;

export const KIRO_CONTEXT_SCRIPT = kiroListScript(1440);
export const GROK_CONTEXT_SCRIPT = grokListScript(1440);

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const whole = (v) => (finite(v) ? Math.round(v) : null);

// -> { percent: 0-100 integer, usedTokens, windowTokens, at } or null without a finite percent.
function contextValue({ percent, usedTokens, windowTokens }, at) {
  if (!finite(percent)) return null;
  return { percent: Math.min(100, Math.max(0, Math.round(percent))), usedTokens: whole(usedTokens), windowTokens: whole(windowTokens), at: at ?? null };
}

export function contextTooltip(v) {
  return v.usedTokens !== null && v.windowTokens !== null
    ? `Context: ${formatTokens(v.usedTokens)} of ${formatTokens(v.windowTokens)} tokens`
    : `Context: ${v.percent}%`;
}

// The ring file's step for a percent: nearest 5, clamped 0-100, three digits ("060").
export const ringStep = (percent) => String(Math.min(100, Math.max(0, Math.round(percent / 5) * 5))).padStart(3, "0");

// Claude's file stores no window: 1M for a [1m] model or once used passes 200K, else 200K.
function claudeValue({ model, tokens }, at) {
  if (!finite(tokens.input_tokens)) return null;
  const used = tokens.input_tokens + (tokens.cache_read_input_tokens ?? 0) + (tokens.cache_creation_input_tokens ?? 0);
  const windowTokens = (model ?? "").includes("[1m]") || used > 200000 ? 1000000 : 200000;
  return contextValue({ percent: (used / windowTokens) * 100, usedTokens: used, windowTokens }, at);
}

// CLAUDE_CONTEXT_SCRIPT output -> Map<dir, value>. The model is the first match (message.model
// comes before the content), the token fields the last (usage comes after it).
export function parseClaudeContext(stdout, at = null) {
  const out = new Map();
  let cur = null;
  const finish = () => {
    const v = cur && claudeValue(cur, at);
    if (v) out.set(cur.dir, v);
  };
  for (const line of String(stdout ?? "").split("\n")) {
    const head = line.match(/^@@ (\S+)$/);
    if (head) {
      finish();
      cur = { dir: head[1], model: null, tokens: {} };
      continue;
    }
    const m = cur && line.match(/^"(model|input_tokens|cache_read_input_tokens|cache_creation_input_tokens)":(?:"([^"]*)"|(\d+))$/);
    if (!m) continue;
    if (m[1] === "model") cur.model ??= m[2] ?? null;
    else if (m[3] !== undefined) cur.tokens[m[1]] = Number(m[3]);
  }
  finish();
  return out;
}

const json = (text) => {
  try { return JSON.parse(text); } catch { return null; }
};

// CODEX_CONTEXT_SCRIPT output -> Map<cwd, value>, from the newest file of each folder.
export function parseCodexContext(stdout) {
  const newest = new Map();
  let cur = null;
  const finish = () => {
    if (!cur || typeof cur.cwd !== "string") return;
    if ((newest.get(cur.cwd)?.mtime ?? -1) >= cur.mtime) return;
    const total = cur.last?.total_tokens;
    const ok = finite(total) && cur.window > 0;
    newest.set(cur.cwd, { mtime: cur.mtime, value: ok ? contextValue({ percent: (total / cur.window) * 100, usedTokens: total, windowTokens: cur.window }, cur.mtime * 1000) : null });
  };
  for (const line of String(stdout ?? "").split("\n")) {
    const head = line.match(/^@@ (\d+)$/);
    if (head) {
      finish();
      cur = { mtime: Number(head[1]), cwd: null, window: 0, last: null };
      continue;
    }
    if (!cur) continue;
    let m;
    if ((m = line.match(/^"cwd":(".*")$/)) && cur.cwd === null) cur.cwd = json(m[1]);
    else if ((m = line.match(/^"model_context_window":(\d+)$/))) cur.window = Number(m[1]);
    else if ((m = line.match(/^"last_token_usage":(\{.*\})$/))) cur.last = json(m[1]);
  }
  finish();
  const out = new Map();
  for (const [cwd, { value }] of newest) if (value) out.set(cwd, value);
  return out;
}

// A parseKiroSession result -> value or null.
export function kiroContext(session) {
  if (!session?.context) return null;
  const { percent, windowTokens } = session.context;
  return contextValue({ percent, usedTokens: windowTokens === null ? null : (percent * windowTokens) / 100, windowTokens }, session.updatedAt);
}

// A parseGrokState result -> value or null (null too when updated over 24 h before nowMs).
export function grokContext(state, nowMs) {
  if (!state || nowMs - state.updated_at > FRESH_MS) return null;
  const tokens = state.context_tokens, size = state.context_window_size;
  const percent = state.used_percentage ?? (tokens !== null && size > 0 ? (tokens / size) * 100 : null);
  return contextValue({ percent, usedTokens: tokens, windowTokens: size }, state.updated_at);
}

// -> Map<address, { key, cwd }> of the agents that can have a value: local, a supported program,
// a pane with a cwd, and no other such agent of the same program in the same folder.
export function contextTargets(agents, panes) {
  const cwdOf = new Map((panes ?? []).map((p) => [p?.pane, p?.cwd]));
  const listed = [];
  for (const a of agents ?? []) {
    const key = a?.program?.key, cwd = cwdOf.get(a?.pane);
    if (typeof a?.address !== "string" || a.address.includes("/") || !CONTEXT_KEYS.includes(key)) continue;
    if (typeof cwd !== "string" || cwd === "") continue;
    listed.push([a.address, { key, cwd }]);
  }
  const count = new Map();
  for (const [, t] of listed) count.set(`${t.key}\u0000${t.cwd}`, (count.get(`${t.key}\u0000${t.cwd}`) ?? 0) + 1);
  return new Map(listed.filter(([, t]) => count.get(`${t.key}\u0000${t.cwd}`) === 1));
}

// Newest parsed file per folder: `when` gives a file's age key, `cwdOf` its folder.
function newestBy(entries, cwdOf, when) {
  const out = new Map();
  for (const e of entries) {
    const cwd = e.parsed ? cwdOf(e.parsed) : null;
    if (typeof cwd !== "string") continue;
    if (!out.has(cwd) || when(e) > when(out.get(cwd))) out.set(cwd, e);
  }
  return out;
}

export function createContextRefresher({ exec, readTextFile, sleep, now = Date.now }) {
  let values = new Map();
  let running = false;
  let generation = 0;
  // Per program: path -> { mtimeMs, size, parsed }, so an unchanged file is not read again. mtime is
  // whole seconds, so the size tells a same-second rewrite apart.
  const caches = { kiro: new Map(), grok: new Map() };

  const sh = async (script, args = []) => {
    const r = await exec("/bin/sh", ["-c", script, "sh", ...args], { timeout: CONTEXT_LIMIT_MS });
    if (!r || r.code !== 0 || typeof r.stdout !== "string") throw new Error("context script failed");
    return r.stdout;
  };

  const readListed = async (key, stdout, parse) => {
    const cache = caches[key];
    const files = parseListing(stdout).files.filter((f) => f.size < MAX_READ_BYTES && f.path.endsWith(".json"));
    const entries = await Promise.all(files.map(async (f) => {
      const hit = cache.get(f.path);
      if (hit && hit.mtimeMs === f.mtimeMs && hit.size === f.size) return { ...f, parsed: hit.parsed };
      try {
        const parsed = parse(await readTextFile(f.path));
        cache.set(f.path, { mtimeMs: f.mtimeMs, size: f.size, parsed });
        return { ...f, parsed };
      } catch {
        return { ...f, parsed: null };
      }
    }));
    const listed = new Set(files.map((f) => f.path));
    for (const path of cache.keys()) if (!listed.has(path)) cache.delete(path);
    return entries;
  };

  // Per program: its targets -> Map<cwd, value>.
  const tasks = {
    async claude(targets) {
      // Two folders can encode to one Claude folder name: such agents get no value either.
      const dirs = new Map();
      for (const t of targets) dirs.set(claudeDir(t.cwd), [...(dirs.get(claudeDir(t.cwd)) ?? []), t.cwd]);
      const byDir = parseClaudeContext(await sh(CLAUDE_CONTEXT_SCRIPT, [...dirs.keys()]), now());
      const out = new Map();
      for (const [dir, cwds] of dirs) if (cwds.length === 1 && byDir.has(dir)) out.set(cwds[0], byDir.get(dir));
      return out;
    },
    async codex() {
      return parseCodexContext(await sh(CODEX_CONTEXT_SCRIPT));
    },
    async kiro() {
      const entries = await readListed("kiro", await sh(KIRO_CONTEXT_SCRIPT), parseKiroSession);
      const out = new Map();
      for (const [cwd, e] of newestBy(entries, (s) => s.cwd, (e) => e.mtimeMs)) {
        const v = kiroContext(e.parsed);
        if (v) out.set(cwd, v);
      }
      return out;
    },
    async grok() {
      const entries = await readListed("grok", await sh(GROK_CONTEXT_SCRIPT), parseGrokState);
      const out = new Map();
      const at = now();
      for (const [cwd, e] of newestBy(entries, (s) => s.cwd, (e) => e.parsed.updated_at)) {
        const v = grokContext(e.parsed, at);
        if (v) out.set(cwd, v);
      }
      return out;
    },
  };

  // Resolves null after the limit. A sleep that fails never ends the race (exec has its own timeout).
  const limit = () => Promise.resolve().then(() => sleep(CONTEXT_LIMIT_MS)).then(() => null, () => new Promise(() => {}));

  return {
    async refresh(agents, panes) {
      if (running) return;
      running = true;
      const gen = generation;
      try {
        const targets = contextTargets(agents, panes);
        const keys = [...new Set([...targets.values()].map((t) => t.key))];
        const results = new Map(await Promise.all(keys.map(async (key) => {
          const mine = [...targets.values()].filter((t) => t.key === key);
          try {
            return [key, await Promise.race([tasks[key](mine), limit()])];
          } catch {
            return [key, null];
          }
        })));
        const next = new Map();
        for (const [address, t] of targets) {
          const v = results.get(t.key)?.get(t.cwd);
          if (v) next.set(address, v);
        }
        if (gen === generation) values = next;
      } catch {
        // Never throws: a failed refresh keeps the previous values.
      } finally {
        running = false;
      }
    },
    value: (address) => values.get(address) ?? null,
    clear() {
      generation += 1;
      values = new Map();
    },
    get running() { return running; },
  };
}
