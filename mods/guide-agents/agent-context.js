// The context ring's data (ADR-0005): how full each agent's context window is, from the agent
// CLI's own session files. An agent maps to the newest session of its program whose folder is
// its pane's live cwd, modified in the last 24 h. Claude Code and Codex logs can pass 1 MiB, so
// one read-only /bin/sh exec per program looks at their last 256 KiB and prints only numbers,
// model ids and folders. Kiro and the Grok hook files are small JSON read with readTextFile; of a
// Kiro file too big for it only the cwd is taken, from its first 4 KiB.
// Pure: no host import; the mod hands in exec, readTextFile and sleep.
import {
  finite, formatTokens, isReadable, object, grokListScript, kiroListScript, parseGrokState, parseKiroSession, parseListing,
} from "./agent-files.js";

export const CONTEXT_KEYS = ["claude", "codex", "kiro", "grok"];
export const CONTEXT_EVERY_MS = 30000;
const CONTEXT_LIMIT_MS = 10000;
const FRESH_MS = 86400000;
const TAIL_BYTES = 262144;
const never = new Promise(() => {});

// Claude Code's project folder name: every character outside [A-Za-z0-9] becomes "-".
export const claudeDir = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, "-");

// Args: Claude folder names. Per folder, "@@ <dir>", then a walk over the top-level *.jsonl files
// modified in the last 24 h, newest first, at most 5, each looked at in its last 256 KiB only.
// A file is interactive when an "entrypoint" in that tail is "cli", or when the tail has none (old
// transcripts, or one huge line); a file whose entrypoints are all something else (sdk-cli,
// claude-desktop, ...) is skipped, so a `claude -p` run in the same folder cannot take a pane's
// ring. The first interactive file ends the walk: "## <path>", then, if it has one, the model,
// requestedModel and token fields of its last main-thread assistant line with a usage. So an
// older session's usage is never printed. Claude Code's synthetic API-error lines (all-zero
// usage) are skipped.
export const CLAUDE_CONTEXT_SCRIPT = `for d in "$@"; do
  case "$d" in ""|*/*|.|..) continue;; esac
  printf '@@ %s\\n' "$d"
  find "$HOME/.claude/projects/$d" -maxdepth 1 -type f -name '*.jsonl' -mmin -1440 -exec stat -f '%m %N' {} + 2>/dev/null | sort -rn | head -n 5 | while read -r m f; do
    e=$(tail -c ${TAIL_BYTES} "$f" 2>/dev/null | grep -o -E '"entrypoint":"[^"]*"' | sort -u)
    case "$e" in ""|*'"entrypoint":"cli"'*) ;; *) continue;; esac
    printf '## %s\\n' "$f"
    tail -c ${TAIL_BYTES} "$f" 2>/dev/null | grep '"type":"assistant"' | grep -v -E '"isSidechain":true|"isApiErrorMessage":true|"model":"<synthetic' | grep '"usage"' | tail -n 1 | grep -o -E '"(model|requestedModel|input_tokens|cache_read_input_tokens|cache_creation_input_tokens)":("[^"]*"|[0-9]+)'
    break
  done
done
exit 0`;

// Args (optional): "<mtimeSec> <size> <path>" of files whose cwd and usage the caller already
// has. Per Codex session modified in the last 24 h: "@@ <mtimeSec>", "## <size> <path>", then,
// unless the file is a known unchanged one, the cwd of its first line and the window and last
// usage of the last token_count line in its last 256 KiB. The known check is one sort, not a
// loop over the args per file: the args ("K <line>") and the listing ("L <line>") are sorted
// together on the line, so a known file's "K" comes right before its own "L".
export const CODEX_CONTEXT_SCRIPT = `k=
{ find "$HOME/.codex/sessions" -type f -name '*.jsonl' -mmin -1440 -exec stat -f 'L %m %z %N' {} + 2>/dev/null; [ "$#" -eq 0 ] || printf 'K %s\\n' "$@"; } | LC_ALL=C sort -k 2 | while read -r t m z f; do
  if [ "$t" = K ]; then k="$m $z $f"; continue; fi
  printf '@@ %s\\n' "$m"
  printf '## %s %s\\n' "$z" "$f"
  [ "$k" = "$m $z $f" ] && continue
  head -n 1 "$f" 2>/dev/null | grep -o -E '"cwd":"([^"\\\\]|\\\\.)*"' | head -n 1
  tail -c ${TAIL_BYTES} "$f" 2>/dev/null | grep '"model_context_window"' | tail -n 1 | grep -o -E '"model_context_window":[0-9]+|"last_token_usage":\\{[^}]*\\}'
done
exit 0`;

export const KIRO_CONTEXT_SCRIPT = kiroListScript(1440);
export const GROK_CONTEXT_SCRIPT = grokListScript(1440);

// Args: paths of Kiro session files too big for readTextFile. Per file, "@@ <path>", then the
// cwd from its first 4 KiB (Kiro writes it right after the session id). Nothing else is printed.
export const KIRO_BIG_CWD_SCRIPT = `for f in "$@"; do
  printf '@@ %s\\n' "$f"
  head -c 4096 "$f" 2>/dev/null | grep -o -E '"cwd":"([^"\\\\]|\\\\.)*"' | head -n 1
done
exit 0`;

// KIRO_BIG_CWD_SCRIPT output -> Map<path, cwd>.
export function parseBigCwds(stdout) {
  const out = new Map();
  let path = null;
  for (const line of String(stdout ?? "").split("\n")) {
    const head = line.match(/^@@ (\/.+)$/);
    if (head) { path = head[1]; continue; }
    const m = path !== null && !out.has(path) && line.match(/^"cwd":(".*")$/);
    if (m) out.set(path, object(`{"cwd":${m[1]}}`)?.cwd ?? null);
  }
  return out;
}

const isNum = (v) => finite(v) !== null;
const whole = (v) => (isNum(v) ? Math.round(v) : null);

// -> { percent: 0-100 integer, usedTokens, windowTokens, at } or null without a finite percent.
function contextValue({ percent, usedTokens, windowTokens }, at) {
  if (!isNum(percent)) return null;
  return { percent: Math.min(100, Math.max(0, Math.round(percent))), usedTokens: whole(usedTokens), windowTokens: whole(windowTokens), at: at ?? null };
}

export function contextTooltip(v) {
  return v.usedTokens !== null && v.windowTokens !== null
    ? `Context: ${formatTokens(v.usedTokens)} of ${formatTokens(v.windowTokens)} tokens`
    : `Context: ${v.percent}%`;
}

// The ring file's step for a percent: nearest 5, clamped 0-100, three digits ("060").
export const ringStep = (percent) => String(Math.min(100, Math.max(0, Math.round(percent / 5) * 5))).padStart(3, "0");

// Claude's file stores no window: 1M when the model the user asked for ends in [1m] (the
// top-level requestedModel, e.g. "claude-opus-5-5[1m]"; message.model is the bare API id) or once
// used passes 200K, else 200K.
function claudeValue({ model, requestedModel, tokens }, at) {
  if (!isNum(tokens.input_tokens)) return null;
  const used = tokens.input_tokens + (tokens.cache_read_input_tokens ?? 0) + (tokens.cache_creation_input_tokens ?? 0);
  const oneM = `${requestedModel ?? ""} ${model ?? ""}`.includes("[1m]");
  const windowTokens = oneM || used > 200000 ? 1000000 : 200000;
  return contextValue({ percent: (used / windowTokens) * 100, usedTokens: used, windowTokens }, at);
}

// CLAUDE_CONTEXT_SCRIPT output -> Map<dir, { value | null, path | null }>, path being the "## <path>"
// line (the script prints at most one: the newest interactive file, whose value this is, or null
// when its tail has no usage line). The model and requestedModel are the first matches
// (they come before the content), the token fields the last (usage comes after it).
export function parseClaudeScan(stdout, at = null) {
  const out = new Map();
  let cur = null;
  const finish = () => {
    if (cur) out.set(cur.dir, { value: claudeValue(cur, at), path: cur.path });
  };
  for (const line of String(stdout ?? "").split("\n")) {
    const head = line.match(/^@@ (\S+)$/);
    if (head) {
      finish();
      cur = { dir: head[1], model: null, requestedModel: null, tokens: {}, path: null };
      continue;
    }
    const path = cur && line.match(/^## (\/.+)$/);
    if (path) {
      cur.path = path[1];
      continue;
    }
    const m = cur && line.match(/^"(model|requestedModel|input_tokens|cache_read_input_tokens|cache_creation_input_tokens)":(?:"([^"]*)"|(\d+))$/);
    if (!m) continue;
    if (m[1] === "model" || m[1] === "requestedModel") cur[m[1]] ??= m[2] ?? null;
    else if (m[3] !== undefined) cur.tokens[m[1]] = Number(m[3]);
  }
  finish();
  return out;
}

// CLAUDE_CONTEXT_SCRIPT output -> Map<dir, value>, for the folders that have one.
// Test helper: wraps parseClaudeScan.
export function parseClaudeContext(stdout, at = null) {
  const out = new Map();
  for (const [dir, { value }] of parseClaudeScan(stdout, at)) if (value) out.set(dir, value);
  return out;
}

// CODEX_CONTEXT_SCRIPT output -> { out: Map<cwd, value> from the newest file of each folder,
// files: Map<path, { mtime, size, cwd, window, last }> of the files that had a "## <size> <path>"
// line }. A file the script skipped (header and marker only) takes its fields from `cache`
// when the cache has the same mtime and size.
export function parseCodexScan(stdout, cache = new Map()) {
  const newest = new Map();
  const files = new Map();
  let cur = null;
  const finish = () => {
    if (!cur) return;
    const hit = cur.path !== null && cur.cwd === null ? cache.get(cur.path) : null;
    if (hit && hit.mtime === cur.mtime && hit.size === cur.size) Object.assign(cur, { cwd: hit.cwd, window: hit.window, last: hit.last });
    if (cur.path !== null) files.set(cur.path, { mtime: cur.mtime, size: cur.size, cwd: cur.cwd, window: cur.window, last: cur.last });
    if (typeof cur.cwd !== "string") return;
    if ((newest.get(cur.cwd)?.mtime ?? -1) >= cur.mtime) return;
    const total = cur.last?.total_tokens;
    const ok = isNum(total) && cur.window > 0;
    newest.set(cur.cwd, { mtime: cur.mtime, value: ok ? contextValue({ percent: (total / cur.window) * 100, usedTokens: total, windowTokens: cur.window }, cur.mtime * 1000) : null });
  };
  for (const line of String(stdout ?? "").split("\n")) {
    const head = line.match(/^@@ (\d+)$/);
    if (head) {
      finish();
      cur = { mtime: Number(head[1]), path: null, size: null, cwd: null, window: 0, last: null };
      continue;
    }
    if (!cur) continue;
    let m;
    if ((m = line.match(/^## (\d+) (\/.+)$/))) {
      cur.size = Number(m[1]);
      cur.path = m[2];
    } else if ((m = line.match(/^"cwd":(".*")$/)) && cur.cwd === null) cur.cwd = object(`{"cwd":${m[1]}}`)?.cwd ?? null;
    else if ((m = line.match(/^"model_context_window":(\d+)$/))) cur.window = Number(m[1]);
    else if ((m = line.match(/^"last_token_usage":(\{.*\})$/))) cur.last = object(m[1]);
  }
  finish();
  const out = new Map();
  for (const [cwd, { value }] of newest) if (value) out.set(cwd, value);
  return { out, files };
}

// Test helper: wraps parseCodexScan.
export const parseCodexContext = (stdout, cache) => parseCodexScan(stdout, cache).out;

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
  // Kiro files too big to read: path -> { mtimeMs, size, cwd }.
  const bigCwds = new Map();
  // Claude, per folder: the last good { path, value }. A huge line can fill the 256 KiB tail so no
  // usage line is found; the value is then kept only while that same file is still the newest
  // interactive one. Another file without a usage line (a new session) gives no value.
  const claudeKept = new Map();
  // Codex: path -> { mtime, size, cwd, window, last }. The script skips known unchanged files, and
  // a path that is no longer listed drops out (the cache is replaced by each scan).
  let codexCache = new Map();
  // Per program: the task still running, as { skips } (never started twice, see due), and its
  // last settled result.
  const inflight = new Map();
  const lastResults = new Map();

  const sh = async (script, args = []) => {
    const r = await exec("/bin/sh", ["-c", script, "sh", ...args], { timeout: CONTEXT_LIMIT_MS });
    if (!r || r.code !== 0 || typeof r.stdout !== "string") throw new Error("context script failed");
    return r.stdout;
  };

  // Files of MAX_READ_BYTES or more are never read (readTextFile's limit); for Kiro see tooBig.
  // `live()` is false once the calling task was dropped as stuck: it then writes no cache.
  const readListed = async (key, stdout, parse, live) => {
    const cache = caches[key];
    const files = parseListing(stdout).files.filter((f) => isReadable(f) && f.path.endsWith(".json"));
    const entries = await Promise.all(files.map(async (f) => {
      const hit = cache.get(f.path);
      if (hit && hit.mtimeMs === f.mtimeMs && hit.size === f.size) return { ...f, parsed: hit.parsed };
      try {
        const parsed = parse(await readTextFile(f.path));
        if (live()) cache.set(f.path, { mtimeMs: f.mtimeMs, size: f.size, parsed });
        return { ...f, parsed };
      } catch {
        return { ...f, parsed: null };
      }
    }));
    if (live()) {
      const listed = new Set(files.map((f) => f.path));
      for (const path of cache.keys()) if (!listed.has(path)) cache.delete(path);
    }
    return entries;
  };

  // Kiro files of MAX_READ_BYTES or more, as entries with their cwd and no context, so a too-big
  // newest session gives its folder no value instead of an older session's. Their cwd comes from
  // KIRO_BIG_CWD_SCRIPT, run only for new or changed ones. If it fails, those files' cwd is unknown
  // (no folder gets their "no value") and they are tried again next time.
  const tooBig = async (stdout, live) => {
    const files = parseListing(stdout).files.filter((f) => !isReadable(f) && f.path.endsWith(".json"));
    const fresh = files.filter((f) => {
      const hit = bigCwds.get(f.path);
      return !hit || hit.mtimeMs !== f.mtimeMs || hit.size !== f.size;
    });
    const cwds = new Map();
    if (fresh.length > 0) {
      let found = null;
      try {
        found = parseBigCwds(await sh(KIRO_BIG_CWD_SCRIPT, fresh.map((f) => f.path)));
      } catch {
        // Unknown cwd for these files.
      }
      for (const f of fresh) cwds.set(f.path, found?.get(f.path) ?? null);
      if (found && live()) for (const f of fresh) bigCwds.set(f.path, { mtimeMs: f.mtimeMs, size: f.size, cwd: cwds.get(f.path) });
    }
    if (live()) {
      const listed = new Set(files.map((f) => f.path));
      for (const path of bigCwds.keys()) if (!listed.has(path)) bigCwds.delete(path);
    }
    return files.map((f) => ({ ...f, parsed: { cwd: cwds.has(f.path) ? cwds.get(f.path) : bigCwds.get(f.path)?.cwd ?? null, context: null } }));
  };

  // Per program: its targets -> Map<cwd, value>. `live()` is true while the task is still the
  // program's current one; a dropped task that settles late writes no shared cache.
  const tasks = {
    async claude(targets, live) {
      // Two folders can encode to one Claude folder name: such agents get no value either.
      const dirs = new Map();
      for (const t of targets) dirs.set(claudeDir(t.cwd), [...(dirs.get(claudeDir(t.cwd)) ?? []), t.cwd]);
      const scan = parseClaudeScan(await sh(CLAUDE_CONTEXT_SCRIPT, [...dirs.keys()]), now());
      const out = new Map();
      if (!live()) return out;
      for (const dir of claudeKept.keys()) if (!dirs.has(dir)) claudeKept.delete(dir);
      for (const [dir, cwds] of dirs) {
        const s = scan.get(dir);
        const old = claudeKept.get(dir);
        const path = s?.path ?? null;
        const kept = s?.value ? { path, value: s.value } : old && path !== null && path === old.path ? old : null;
        if (!kept) claudeKept.delete(dir);
        else if (cwds.length === 1) {
          claudeKept.set(dir, kept);
          out.set(cwds[0], kept.value);
        }
      }
      return out;
    },
    async codex(_targets, live) {
      const known = [...codexCache].map(([path, c]) => `${c.mtime} ${c.size} ${path}`);
      const { out, files } = parseCodexScan(await sh(CODEX_CONTEXT_SCRIPT, known), codexCache);
      if (live()) codexCache = files;
      return out;
    },
    async kiro(_targets, live) {
      const listing = await sh(KIRO_CONTEXT_SCRIPT);
      // Too-big files first: on a same-second tie newestBy keeps the first, so it gets no value.
      const entries = [...await tooBig(listing, live), ...await readListed("kiro", listing, parseKiroSession, live)];
      const out = new Map();
      for (const [cwd, e] of newestBy(entries, (s) => s.cwd, (e) => e.mtimeMs)) {
        const v = kiroContext(e.parsed);
        if (v) out.set(cwd, v);
      }
      return out;
    },
    async grok(_targets, live) {
      const entries = await readListed("grok", await sh(GROK_CONTEXT_SCRIPT), parseGrokState, live);
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
  const limit = () => Promise.resolve().then(() => sleep(CONTEXT_LIMIT_MS)).then(() => null, () => never);

  // A program's task still running at its STUCK_REFRESHES-th later refresh is dropped (it never
  // settles: a hung read), so a new one starts; a late result of the dropped one is ignored.
  const STUCK_REFRESHES = 3;
  // Whether the program's task should start now: none runs, or the running one is dropped as stuck.
  const due = (key) => {
    const busy = inflight.get(key);
    if (!busy) return true;
    busy.skips += 1;
    if (busy.skips < STUCK_REFRESHES) return false;
    inflight.delete(key);
    return true;
  };

  // Starts the program's task; a program not due reuses its last result.
  const start = (key, mine, gen, lim, run) => {
    if (!run) return Promise.resolve(lastResults.get(key) ?? null);
    const entry = { skips: 0 };
    const mineNow = () => inflight.get(key) === entry;
    const task = Promise.resolve().then(() => tasks[key](mine, mineNow));
    task.then((r) => { if (gen === generation && mineNow()) lastResults.set(key, r); }, () => {}).finally(() => { if (mineNow()) inflight.delete(key); });
    inflight.set(key, entry);
    return Promise.race([task, lim]).catch(() => null);
  };

  return {
    async refresh(agents, panes) {
      if (running) return;
      running = true;
      const gen = generation;
      try {
        const targets = contextTargets(agents, panes);
        const keys = [...new Set([...targets.values()].map((t) => t.key))];
        const runs = new Map(keys.map((key) => [key, due(key)]));
        const lim = [...runs.values()].some(Boolean) ? limit() : never;
        const results = new Map(await Promise.all(keys.map(async (key) => [key, await start(key, [...targets.values()].filter((t) => t.key === key), gen, lim, runs.get(key))])));
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
      lastResults.clear();
      claudeKept.clear();
      codexCache = new Map();
    },
    get running() { return running; },
  };
}
