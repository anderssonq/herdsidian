# Plan: agent-usage-context — Kiro and Grok in Usage, context window on agent rows

Status: draft for Godfather, 2026-11-10. Spec: `docs/specs/agent-usage-context.md` (approved). Line refs are against `4c4bc51`. This plan changes no code.

## Blocker found (needs the owner before piece D)

The spec's list of locked assertions that change is incomplete. A dry run of the Settings switch (a scratch copy of the repo with `contextInSidebar` in `lib/keys.js`, all copies, and the `setSetting` change below) gives 7 failing tests, 1268 passing, lint green. The 8 approved assertions cover 4 of the 7 tests. Three more assertions in `tests/settings.test.js` fail, and they are fixture-only like the others:

| File:line | Assertion today | Needed |
|---|---|---|
| `tests/settings.test.js:29` | `readSettings({ other: 1, keyHints: "off" })` deep-equals `{ keyHints: "off", usageInStatus: true }` | add `contextInSidebar: true` |
| `tests/settings.test.js:64` | Layout ids `["right-sidebar", "sidebar-tab", "sidebar-width", "usage-in-status"]` | append `"context-in-sidebar"` |
| `tests/settings.test.js:103` | hidden sidebar ids `["right-sidebar", "sidebar-tab", "usage-in-status"]` | append `"context-in-sidebar"` |

AC 36a and 36b make these fail wherever the row and the default go. No design avoids them. Piece D waits until Andersson approves these 3 assertions with the 8 already approved (11 in 2 files). Pieces S, A and C do not wait. B needs D only for AC 36c.

`tests/settings-tab.test.js:278` stays unchanged and passes, but only with a code change. Today `setSetting` writes `{ ...settings(), [name]: value }`, which is the normalized object with every default filled in. With a third default, the toggle would store `contextInSidebar: true` too, and line 278 fails (the dry run confirmed this). D changes `setSetting` to write the changed key over the raw stored object (contract D2). `settings-tab.test.js:250-257` passes only if the new row reads a missing `contextInSidebar` as On (contract D1).

No other locked test breaks. I checked these against the file plan: `usage.test.js`, `usage-view.test.js`, `usage-status.test.js`, `sidebar.test.js`, `sidebar-view.test.js`, `mods-ui.test.js`, `lint.test.js`, `hints-hover.test.js`, `next-blocked.test.js`, `needs-next.test.js` and `palette.test.js` outside 722-726, 738 and 787 (see Risks).

## Approach

- One new shared pure file, `lib/agent-files.js`. It is copied byte-for-byte into `herdsidian-status` and `guide-agents`, and the lint copy guard checks the copies. It holds what Usage (A) and the context bar (B) both read: the `<kiro>` and `<state>` folder rules, the one listing script, the Kiro session parser, the Grok hook-file parser and the token formatter. A and B read different fields from the same files, so each mod keeps its own aggregation.
- Usage (A): a new pure file `usage-month.js` builds the two `kind: "month"` readers. `usage.js` gets the new keys, the new `EMPTY_NONE`, an optional `io` argument for `fetchProvider`, and `errorText()`. `usage-status.js` and `usage-view.js` learn `kind: "month"`.
- Context (B): a new pure file `guide-agents/agent-context.js` holds the four context scripts and parsers, the pane-to-session mapping, and a refresher with no host imports. `guide-agents/main.js` owns a dedicated 30 s context timer while the switch is on, and draws the bar from the in-memory map only.
- Grok hook (C): a POSIX `sh` script that uses only `/usr/bin/plutil` to read and to build the JSON. Atomic write by `mv` in the same folder. Docs follow.
- Settings (D): `contextInSidebar` in `lib/keys.js`. `setSetting` writes over the raw object. No palette code changes: the ⌘K Settings tab already renders `settingSections`. There is no other Settings UI. The "sidebar Settings tab" in AC 36b is the same `settingSections` list (`tests/settings-tab.test.js:1` says the palette's Settings tab is the only settings UI).

### Decisions frozen here (the spec left them open)

1. **Grok state file**: contract C1 below.
2. **Kiro and Grok parsing are shared through `lib/agent-files.js`**, not written as two parsers. Why:
   - The `KIRO_HOME` rule (AC 7) and the Grok file validation are used by both mods. Two copies would drift, and the cleanup review would flag them as duplicate code.
   - Byte-identical copies guarded by lint are the repo's existing pattern (ADR-0001, `scripts/lint.js:58-75`). The cost is one name in the guard list and `cp` on every change.
   - Each mod keeps only its own aggregation: month sums in A, newest-per-folder context in B.
3. **The two new Usage notes go in `MONTH_NOTES` in `mods/herdsidian-status/usage-month.js`**, not in `ERROR_TEXT`. `usage.js` exports `errorText(key)`, which looks in `ERROR_TEXT`, then `MONTH_NOTES`, then falls back to `ERROR_TEXT.unavailable`. `usage-view.js` uses `errorText` instead of indexing `ERROR_TEXT`. `ERROR_TEXT` keeps its 5 keys, so `usage.test.js:454-462` still passes.
4. **Settings switch**: contracts D1 and D2.
5. **Context refresh timer**: the spec says "on the existing 30 s timer", but AC 36c says "starts no refresh timer" when off and "turning it off stops the timer". Both can hold only with a separate timer. Contract B4: the existing `every(30000, notify)` stays as it is, and a second `every(30000, refresh)` runs only while the switch is on. Godfather: confirm this reading.

## Contracts

### S — `lib/agent-files.js` (pure, no imports; copies in `mods/herdsidian-status/` and `mods/guide-agents/`)

```js
export const MAX_READ_BYTES = 1048576;            // readTextFile limit
export const STATE_DIR_SH = '${XDG_STATE_HOME:-$HOME/.local/state}/herdsidian'; // ADR-0002, as io.js:22
// sh function: prints <kiro>. $KIRO_HOME (one trailing / dropped) when it is absolute, not "/",
// not $HOME and not a parent of $HOME; otherwise $HOME/.kiro.
export const KIRO_DIR_FN = `kiro_dir() { ... }`;
// sh function: list_json <dir> [minutes]. Prints "nodir" when <dir> is not a folder. Otherwise
// "dir <dir>", then one "<mtimeSec> <sizeBytes> <abs path>" line per top-level *.json
// (find -maxdepth 1 -type f -name '*.json' [-mmin -<minutes>] -exec stat -f '%m %z %N' {} +).
// Reads nothing, writes nothing; stderr only to /dev/null.
export const LIST_JSON_FN = `list_json() { ... }`;
export function parseListing(stdout)
  // -> { dir: string | null, files: [{ path, mtimeMs, size }] }   dir null for "nodir"; bad lines dropped
export function parseKiroSession(text)
  // -> null (not JSON / not an object) | {
  //   cwd: string | null, updatedAt: ms | null,
  //   turns: [{ endMs: ms | null, credits: number }],   // credits = sum of finite metering_usage[].value with unit "credit"
  //   context: { percent: number, windowTokens: number | null } | null }
  // percent from rts_model_state.context_usage_percentage, else conversation_metadata.last_context_usage.percentage.
  // title and every other field are never copied.
export function parseGrokState(text)
  // -> null unless a JSON object with v === 1, session_id a string and updated_at finite;
  // else exactly the 11 keys of C1, each non-matching type set to null.
export function formatTokens(n)
  // < 1000: String(Math.round(n)); < 1e6: one-decimal K; else one-decimal M; a trailing ".0" is dropped
  // (124000 -> "124K", 12300 -> "12.3K", 1234567 -> "1.2M"); a K that rounds to 1000 becomes "1M".
```

Shell sketch for `kiro_dir`, frozen in behavior (AC 7). `case "$HOME/" in "$k"/*)` treats `$HOME` and every parent of `$HOME` as invalid:
```sh
kiro_dir() { k="${KIRO_HOME%/}"; case "$k" in /?*) case "$HOME/" in "$k"/*) k="";; esac;; *) k="";; esac; if [ -n "$k" ]; then printf %s "$k"; else printf %s "$HOME/.kiro"; fi; }
```

Lint (`scripts/lint.js`, owned by S):
- Add `"agent-files"` to the copy-guard list (line 60).
- Add to `pure`: `mods/herdsidian-status/agent-files.js`, `mods/guide-agents/agent-files.js`, `mods/herdsidian-status/usage-month.js`, `mods/guide-agents/agent-context.js`. Lint checks only files that exist, so a path listed before its file exists does no harm.

### A — Usage (`mods/herdsidian-status`)

`usage.js`:
```js
export const PROVIDER_KEYS = ["claude", "codex", "opencode", "kiro", "grok"];
export const EMPTY_NONE = "No supported agent CLI is installed. Usage covers Claude Code, Codex, opencode, Kiro and Grok.";
export const ERROR_TEXT = { /* unchanged, 5 keys */ };
export const errorText = (key) => ERROR_TEXT[key] ?? MONTH_NOTES[key] ?? ERROR_TEXT.unavailable;
export async function fetchProvider(key, exec, io = {})   // io = { readTextFile, now: ms }; old 2-arg calls unchanged
  // "kiro" -> fetchKiro(exec, io.readTextFile, io.now); "grok" -> fetchGrok(...). No readTextFile -> { error: "unavailable" }.
export function createUsage({ exec, readTextFile, after, now, onChange, limitMs, ttlMs })
  // start() calls fetchProvider(key, exec, { readTextFile, now: now() }). Nothing else changes.
```
The header comment (lines 1-3) lists every program and path. That is AC 37: `<kiro>/sessions/cli/*.json` (`$KIRO_HOME` rule) and `${XDG_STATE_HOME:-~/.local/state}/herdsidian/grok/*.json`. `find` and `stat` are already listed.

`usage-month.js` (new, pure; imports only `./agent-files.js`):
```js
export const MONTH_NOTES = {
  kiroNoSessions: "No Kiro sessions found.",
  grokNoHook: "Grok usage needs the Herdsidian status line hook. See Usage in the README.",
};
export const GROK_NOTE = "Only Grok sessions run with the Herdsidian status line.";
export const KIRO_LIST_SCRIPT;  // KIRO_DIR_FN + LIST_JSON_FN + `list_json "$(kiro_dir)/sessions/cli"`
export const GROK_LIST_SCRIPT;  // LIST_JSON_FN + `list_json "${STATE_DIR_SH}/grok"`
export function monthOf(nowMs)          // -> { month: "YYYY-MM", startMs, endMs }, local time zone
export function monthLabel(month)       // "2026-11" -> "Nov" (fixed English array, no locale)
export function kiroMonth(listing, texts, nowMs)  // texts: Map<path, string | null>; -> value | { error }
export function grokMonth(listing, texts, nowMs)
export async function fetchKiro(exec, readTextFile, nowMs)  // one exec, then readTextFile per listed file; never throws
export async function fetchGrok(exec, readTextFile, nowMs)
export const formatCredits = (n) => `${n.toFixed(2)} cr`;
export const formatUsd = (n) => `$${n.toFixed(2)}`;
export function monthText(d)  // status text: Kiro formatCredits(credits); Grok formatUsd(costUsd), else `${formatTokens(tokens)} tok`
```
- Execs: `exec("/bin/sh", ["-c", SCRIPT])`, and nothing else.
- Listed files: `size < MAX_READ_BYTES` and `mtimeMs >= startMs` (Kiro). For Grok, `mtimeMs >= startMs - 86400000`, then `updated_at` decides.
- Files are read in batches of 16.
- Errors:
  - exec rejects or exits non-zero: `unavailable`.
  - `nodir`, or a folder with no `*.json` at all: `kiroNoSessions` / `grokNoHook`.
  - Files listed and every one skipped: `unavailable`.
  - No file in the month: a zero reading.
- Values match the spec's "Usage value" shapes exactly. `credits` and `costUsd` are rounded to 2 decimals.

`usage-status.js`: `reading()` gains, before the `stats` branch:
`if (d.kind === "month") return { text: monthText(d), percent: null, label: monthLabel(d.month), high: false };`
The `stats` branch keeps `"7 d"`.

`usage-view.js`:
- `body()` uses `errorText(entry.error)`.
- New `kind === "month"` branch:
  - The note `This month, no usage limits`, plus `GROK_NOTE` for Grok.
  - Lines `Credits` / `Sessions` / `Turns`, or `Cost` (`Cost unknown` when null) / `Tokens` / `Sessions`.
  - `formatAge(d.at, now)` when `at` is set.
  - For Kiro, `1 file skipped` / `N files skipped`.
- `primaryPart` already hides the bar when `percent === null`.

`main.js`: imports `readTextFile` from `herdr` and passes it to `createUsage`. No other change.

### B — Context (`mods/guide-agents`)

`agent-context.js` (new, pure; imports only `./agent-files.js`):
```js
export const CONTEXT_KEYS = ["claude", "codex", "kiro", "grok"];
export const CONTEXT_EVERY_MS = 30000, CONTEXT_LIMIT_MS = 10000, FRESH_MS = 86400000, TAIL_BYTES = 262144;
export const claudeDir = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, "-");
export function contextTargets(agents, panes)
  // -> Map<address, { key, cwd }>. Drops: address with "/", program.key not in CONTEXT_KEYS,
  // pane missing or cwd null, and every agent sharing (key, cwd) with another listed agent.
export const CLAUDE_CONTEXT_SCRIPT; // args: encoded dir names. Per dir, the newest top-level *.jsonl with
  //   -mmin -1440, then: tail -c 262144 | grep '"type":"assistant"' | grep -v '"isSidechain":true' |
  //   grep '"usage"' | tail -n 1 | grep -o -E '"(model|input_tokens|cache_read_input_tokens|
  //   cache_creation_input_tokens)":("[^"]*"|[0-9]+)'. Prints "@@ <dir>" before each dir's lines.
export const CODEX_CONTEXT_SCRIPT;  // no args. For each ~/.codex/sessions/**/*.jsonl with -mmin -1440:
  //   "@@ <mtimeSec>", the first '"cwd":"…"' match of line 1 (head -n 1 | grep -o -E '"cwd":"([^"\\]|\\.)*"' | head -n 1),
  //   then from tail -c 262144 the last token_count line with "model_context_window":
  //   grep -o -E '"model_context_window":[0-9]+|"last_token_usage":\{[^}]*\}'.
export const KIRO_CONTEXT_SCRIPT;   // KIRO_DIR_FN + LIST_JSON_FN + list_json "$(kiro_dir)/sessions/cli" 1440
export const GROK_CONTEXT_SCRIPT;   // LIST_JSON_FN + list_json "${STATE_DIR_SH}/grok" 1440
export function parseClaudeContext(stdout)   // -> Map<dir, ContextValue>; model is the first match, token fields the last
export function parseCodexContext(stdout)    // -> Map<cwd, ContextValue>, newest file per cwd (cwd JSON-decoded)
export function kiroContext(session)         // parseKiroSession result -> ContextValue | null
export function grokContext(state, nowMs)    // parseGrokState result -> ContextValue | null (updated_at older than 24 h -> null)
export function contextValue({ percent, usedTokens, windowTokens }, at)
  // -> { percent: int clamped 0-100, usedTokens: int | null, windowTokens: int | null, at } | null
export function contextTooltip(v)  // "Context: 124K of 200K tokens" | "Context: 62%"
export function createContextRefresher({ exec, readTextFile, sleep, now = Date.now })
  // -> { refresh(agents, panes): Promise<void>, value(address): ContextValue | null, clear(), get running(): boolean }
```
Rules for the refresher:
- `refresh` returns at once when `running` is true.
- It computes `contextTargets`, then runs one task per program key that has at least one target, in parallel.
- Each task is `Promise.race([work, sleep(CONTEXT_LIMIT_MS)])`. A task that rejects, times out or gets bad output gives no values.
- Every exec is `exec("/bin/sh", ["-c", SCRIPT, "sh", ...args], { timeout: CONTEXT_LIMIT_MS })`.
- Kiro and Grok read every listed file with `readTextFile` only when its `(path, mtimeMs)` changed (a parse cache). Never on a `.jsonl`.
- The values map is replaced as a whole at the end of each refresh.
- Never throws.

Claude window: 1,000,000 when the model contains `[1m]` or used > 200,000, else 200,000. Codex: used = `last_token_usage.total_tokens`, window = `model_context_window`.

`main.js` (B4, the timer contract):
- `init`: when not `sortMenu`, keep the existing `every(30000, notify)`. Then:
  - `this.cx = cx` (the AsyncContext `init` receives, the same as `herdsidian-status/main.js:33`).
  - `this.context = createContextRefresher({ exec, readTextFile, sleep: (ms) => this.cx.sleep(ms) })`.
  - `this.syncContext(cx)`.
- `syncContext(cx)`:
  - When `settings().contextInSidebar` is on and `this.contextOn` is false: set `this.contextOn = true` and `this.contextTask = cx.timer.every(CONTEXT_EVERY_MS, (cx) => this.tickContext(cx))`, then `cx.spawn((cx) => this.tickContext(cx))` for the first refresh.
  - When the switch is off and `this.contextOn` is true: `this.contextTask?.cancel?.()`, `this.contextOn = false`, `this.context.clear()`.
  - Guard every handle with `?.`: `fakeCx` timers return `undefined`.
- `tickContext(cx)`: does nothing when the switch is off or `narrow()` is true. Otherwise `await this.context.refresh(agents(), panes())`, then `cx.notify()`.
- `render(cx)`: when `settings().contextInSidebar !== this.contextOn` and no sync is pending, set the pending flag and `this.cx.spawn((cx) => { pending = false; this.syncContext(cx); })`. Render never calls exec or readTextFile and never starts the refresh itself.
- Row, main expanded rows only:
  - With `const v = settings().contextInSidebar && !machine ? this.context?.value(a.address) : null`, the status line becomes `h_flex().gap(6).items_center()`. It holds the existing status `div` unchanged, then `h_flex().id(\`ctx-${a.address}\`).gap(4).items_center().tooltip(contextTooltip(v))`.
  - That `h_flex` holds a 12 px ring `svg(\`mods/guide-agents/ring/ring-${ringStep(v.percent)}.svg\`)` tinted `t.accent`, or `t.blocked` at 90 % and over (the text too); `ringStep` rounds to the nearest 5 and clamps 0-100, and the text `${v.percent}%` (11 px).
  - Colors: the text is `t.blocked` at 90 or more, else `t.muted`.
  - With no value, the existing `div` is passed as today (AC 33).
  - Sub-agent rows and the collapsed rail never call `value`.
- New `herdr` imports: `exec`, `readTextFile`.

### C — Grok hook (`scripts/grok-status-line.sh`)

**C1, the state-file contract** (A and B read it through `parseGrokState`):
- Folder: `${XDG_STATE_HOME:-$HOME/.local/state}/herdsidian/grok/`, mode 0700 (`umask 077`, `mkdir -p`, `chmod 700`).
- File: `<session_id>.json`, mode 0600. `session_id` must match `^[A-Za-z0-9._-]{1,128}$` and must not be `.` or `..`; otherwise nothing is written.
- Atomic write: the JSON goes to `.<session_id>.$$.tmp` in the same folder, then `mv -f` onto the final name. A failed write can leave that hidden `.tmp` file, which `list_json` never matches (`*.json`), and the script never deletes (AC 23 forbids `rm`).
- Exactly 11 keys, nothing else:

| Key | Type | Source |
|---|---|---|
| `v` | integer `1` | constant |
| `session_id` | string | `session_id` |
| `cwd` | string or null | `workspace.current_dir`, else `cwd` |
| `model` | string or null | `model.id` |
| `updated_at` | integer ms | `$(date +%s)000` (second precision) |
| `cost_usd` | number or null | `cost.total_cost_usd` |
| `context_window_size` | integer or null | `context_window.context_window_size` |
| `context_tokens` | integer or null | `context_window.context_tokens` |
| `used_percentage` | number or null | `context_window.used_percentage` |
| `session_input_tokens` | integer or null | `context_window.session_input_tokens` |
| `session_output_tokens` | integer or null | `context_window.session_output_tokens` |

- Reading: `payload=$(cat)`, then `printf '%s' "$payload" | /usr/bin/plutil -extract <keypath> raw -o - -` for each key. A number is kept only when it matches a numeric `case` pattern, and is inserted with `-json "$value"`. A missing key or a non-number gives `-json null`.
- Building: start from `printf '{"v":1}'`, then chain `| /usr/bin/plutil -insert <key> -string "$s" -o - -` (strings go in as argv, so plutil escapes them; AC 19). Seed with `{"v":1}`, never `{}`: plutil reads `{}` on stdin as OpenStep and fails.
- Probe on macOS 27.2, 2026-11-10: `-extract … raw`, `-insert … -string|-json`, `-type` and `{"v":1}` stdin chaining work. Floats print through `raw` with 6 decimals (`1.230000`), which is still valid JSON.
- Output: one line, `<display_name> · <percent>% ctx` (percent through `printf '%.0f'`), or `<display_name>`, with `Grok` when the name is missing. Always exit 0. Absolute program paths only: `/usr/bin/plutil`, `/bin/mkdir`, `/bin/chmod`, `/bin/mv`, `/bin/date`, `/bin/cat`. Grok runs no rc file and its PATH can be bare.
- Mode 0755 in git.

### D — Settings switch (`lib/keys.js`, `lib/settings.js`, all copies)

- **D1** in `keys.js`:
  - `SETTING_DEFAULTS = { keyHints: "modifier", usageInStatus: true, contextInSidebar: true }`.
  - `readSettings` keeps a boolean `contextInSidebar`; any other value becomes the default.
  - `settingSections` appends a last Layout row, after `usage-in-status`, shown whether the sidebar is hidden or not:
    `{ id: "context-in-sidebar", label: "Context in the sidebar", detail: on ? "On" : "Off", action: { type: "setting", name: "contextInSidebar", value: !on } }`, with `const on = settings.contextInSidebar !== false`. A missing key reads as On, so `settings-tab.test.js:250` still matches.
- **D2** in `settings.js`:
  - `setSetting(name, value)` writes `{ ...(raw is a plain object ? raw : {}), [name]: value }`, where `raw = shared(SETTINGS_KEY)`.
  - Only the changed key is added over what is stored. Reads still go through `readSettings`, so a mistyped stored value has no effect.
  - This keeps `settings-tab.test.js:278` passing unchanged (dry run: passes with D2, fails without it).
- Copies: `lib/keys.js` to `mods/{herdsidian,herdsidian-status,herdsidian-tabs,guide-agents,guide-spaces}/keys.js`, and `lib/settings.js` to the same 5 mods, by `cp`.

## Affected files

| Piece | Create | Modify |
|---|---|---|
| S | `lib/agent-files.js`, `mods/herdsidian-status/agent-files.js`, `mods/guide-agents/agent-files.js`, `tests/agent-files.test.js` | `scripts/lint.js` |
| D | `tests/agent-context-settings.test.js` | `lib/keys.js`, `lib/settings.js`, 5 × `mods/*/keys.js`, 5 × `mods/*/settings.js`, `tests/settings.test.js` (lines 6, 29, 64, 103) and `tests/palette.test.js` (722-726, 738, 787), after Andersson's unlock |
| A | `mods/herdsidian-status/usage-month.js`, `tests/usage-providers.test.js`, `tests/usage-kiro.test.js`, `tests/usage-grok.test.js` | `mods/herdsidian-status/{usage.js,usage-status.js,usage-view.js,main.js}` |
| B | `mods/guide-agents/agent-context.js`, `tests/agent-context.test.js`, `tests/agent-context-view.test.js` | `mods/guide-agents/main.js` |
| C | `scripts/grok-status-line.sh`, `tests/grok-hook.test.js`, `tests/docs-usage.test.js` | `README.md`, `RECIPE.md` |
| Godfather | — | `.test-lock` (one serial `test-lock.sh lock` per new test file after its red run: parallel pieces must not append at the same time) |

No file is in two pieces.

## Pieces, ACs and tests

| Piece | Owns ACs (code) | Writes tests | Depends on | Agent / model | Effort |
|---|---|---|---|---|---|
| S shared files | contract for 7, 8, 16 (kiro_dir, list_json) and C1 parsing; lint copy and pure rules | `tests/agent-files.test.js`: `kiro_dir` through `spawnSync` with a temp HOME (AC 7 cases), `list_json` (nodir, size, `-mmin`), `parseKiroSession`, `parseGrokState` (extra keys dropped, bad types to null), `formatTokens` | — | implementer (Sonnet) | M |
| D settings | 36a, 36b | `tests/agent-context-settings.test.js` (36a, 36b and the black-box 36c tests for B); the 11 locked edits | owner approval of the 3 extra assertions + unlock | implementer (Sonnet) for tests, mechanic (Haiku) for the `cp` and locked edits | S |
| A Usage | 1-16, 37 (header) | `usage-providers`, `usage-kiro`, `usage-grok` | S | implementer (Opus: month edges, timeouts, view) | L |
| B Context | 24-35, 36c | `agent-context`, `agent-context-view` | S; D for 36c | implementer (Opus: shell parsing, timer lifecycle, live-cx rules) | L |
| C Hook + docs | 17-23, 36, 37 (test only) | `grok-hook` (skip off macOS), `docs-usage` | C1 only (no code dependency) | implementer (Sonnet) | M |
| Gate / live | 38-42 | — | all | Godfather + verifiers | — |

## Order and parallel groups

1. **Group 1, in parallel**: S, C, and D's test file 36a/36b part. The D code and locked edits run only after approval and unlock.
2. **Group 2, in parallel, after S is merged in the working tree**: A and B. B's 36c goes green once D's code has landed.
3. **Group 3**: gate (AC 38): `npm --prefix <repo> test`, `npm --prefix <repo> run lint`, `test-lock.sh verify`, `herdr-app check` on `mods/herdsidian-status` and `mods/guide-agents`. Then the cleanup review (a second agent) and the live checks 39-42.

Each piece writes its red tests first. Godfather locks them serially, then the code is written.

## Risks

- **3 extra locked assertions (settings.test.js:29, 64, 103)**: D blocked; owner decision above.
- **`setSetting` semantics change (D2)**: stored objects are no longer back-filled with defaults. Reads normalize through `readSettings`, and `settings-tab.test.js:278` encodes exactly this behavior. Old mistyped keys stay stored and have no effect.
- **Keeping init's `cx` (B4)**: `live-cx.js` kills a render `cx`, but the `cx` that `init` receives is an AsyncContext (gpui-kit.d.ts: "It is what `init` receives"), as in `herdsidian-status/main.js:33`. Render uses only `this.cx.spawn`, never the render `cx`, for timers. AC 34 tests use `fakeCx`. B's tests should also run render through `during()` to catch a kept render `cx`.
- **Existing guide-agents tests** (`hints-hover`, `next-blocked`, `needs-next`, `polish-needs`):
  - `init` now calls `timer.every` twice and spawns one refresh. Their agents have no `program.key` in `CONTEXT_KEYS` and `panes()` is `[]`, so no target exists, nothing execs and the rows are unchanged.
  - `timer.every()` returns `undefined` under `fakeCx`, so every handle must be guarded.
  - The stub module binds runtime functions at import. `exec` and `readTextFile` go through `state.*`, so B's tests can swap them after import, but `agents`, `panes` and `terminals` must be set before the import.
- **grep on JSON lines** (B): the patterns need unescaped quotes, so the same keys inside JSON strings (`\"model\":`) do not match. For Claude, `model` is taken as the first match and the token fields as the last, because `usage` comes after `content`. Tool-use inputs are raw JSON objects and could in theory hold a `"model"` key before `message.model`. `message.model` comes first in the line, so the first match is still right. A test fixture covers this.
- **Codex key order**: `last_token_usage` is a flat object, so `\{[^}]*\}` holds. A future nested field would drop the value (no bar, no wrong number).
- **`stat -f` is BSD**: on Linux the listings print nothing. Kiro and Grok then show their "not found" notes and there is no context. "Does not crash" holds. Tests that run the scripts use `skip` off macOS, as `usage.test.js` does today.
- **Five same-folder agents**: the ambiguity rule hides them all. AC 34's "five Claude agents, one exec" test must use five different folders.
- **Grok month rule** (open question 6): unchanged; the card note covers it.
- **plutil float noise**: `1.230000` is valid JSON. `parseGrokState` keeps the number as is, and the views round.
- **Docs reference lines move**: C finds the README and RECIPE sections by heading, not by the spec's line numbers. RECIPE's `lib/` list gains `lib/agent-files.js` and `contextInSidebar`.
- **Lint home-path rule**: fixtures and docs must use `~` or temp folders. An absolute macOS or Linux home path in a `.js`, `.json` or `.md` file fails lint (`scripts/lint.js`, "Nothing personal").

## Verification

From `01-Projects/Herdsidian.md` `## Verification`:
- Lint: `npm --prefix ~/Software/add_ons/herdsidian run lint`.
- Unit: `npm --prefix ~/Software/add_ons/herdsidian test`.
- Mod load: `herdr-app check <abs>/mods/herdsidian-status` and `<abs>/mods/guide-agents` (macOS).
- Run the app: copy into `~/.config/herdr-app`, `herdr-app status`, then `herdr-app shot` in `hs_carbon` and one light theme (AC 41), using demo data.
- AC 40 needs the hook installed by hand on the Mac. AC 42 needs `knownAgents()` checked live.
- `test-lock.sh verify` after the new files are locked.

## ADR draft

### ADR-0005 Agent context window comes from each CLI's local session files, mapped by pane folder
**Status:** proposed · **Date:** 2026-11-10
- **Context:** Herdr's API gives an agent no session id, pid or context field. The owner wants each agent row to show context use, with nothing on the network and no credential read. Claude Code and Codex logs can be over 1 MiB (`readTextFile`'s limit). Grok stores no token counts, so it needs a status-line hook.
- **Decision:**
  - `guide-agents` maps each agent to the newest session of its program whose folder equals the pane's live `cwd`, modified in the last 24 h. When two agents share the same program and folder, neither shows a value.
  - Claude Code and Codex are read through one read-only `/bin/sh` exec per program per 30 s refresh. It looks at the last 256 KiB only and prints only numbers, model ids and folders.
  - Kiro's session JSON and the Grok hook's state files (`<state>/grok/<session_id>.json`, 11 keys, written by `scripts/grok-status-line.sh`) are read with `readTextFile`.
  - Parsers shared with Usage live in `lib/agent-files.js`, copied byte-for-byte and guarded by lint.
  - A `contextInSidebar` setting (default on) starts and stops a dedicated refresh timer.
- **Consequences:**
  - A just-started agent can show the previous session in the same folder until it writes. Ambiguous agents show nothing.
  - opencode gets no context (its SQLite file also holds credentials).
  - The `guide-agents` disclosure grows: it now reads agent files every 30 s.
  - Grok numbers exist only after the person installs the hook by hand.
  - Settings writes now keep the raw stored object and add the changed key (`setSetting`).
- **Verification:** `tests/agent-context*.test.js`, `tests/agent-files.test.js`, `tests/grok-hook.test.js`, the lint copy guard, and the live checks AC 40-42.

## Open questions for the owner

1. Approve the 3 extra fixture-only assertions in `tests/settings.test.js` (lines 29, 64, 103), and unlock that file and `tests/palette.test.js`.
2. Confirm the dedicated context timer (decision 5) as the reading of "existing 30 s timer" against AC 36c.
3. The ADR-0005 draft needs Andersson's OK.
