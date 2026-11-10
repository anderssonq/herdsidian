# agent-usage-context — Kiro and Grok in Usage, context window on agent rows

Status: Definition of Ready, written 2026-11-10 from the owner's final decisions (1a, 2a, 3a, 4). It replaces the proposal `kiro-usage.md`. It changes no code.

## Objective

Usage in the status bar covers two more agent CLIs, Kiro and Grok, and each agent row in the Agents sidebar shows how full that agent's context window is. Every number comes from files already on this Mac. Nothing new reaches the network, no token is read, and no agent CLI is started.

## User story

As a person who runs several agent CLIs side by side in Herdr, I want to see what Kiro and Grok have used this month and how full each running agent's context window is, so that I can pick the agent with room left and see my spend without opening each CLI.

## Owner decisions (2026-11-10, final)

- Everything is local. No new network host. No token or credential file is read. `kiro-cli chat` and `grok` are never run.
- 1a: Kiro is a Usage provider. Reading: credits spent in the current calendar month, from Kiro's local session files. No cap, no bar, never a percent.
- 2a: Grok is a Usage provider through a status-line hook script that this repo ships and the person installs by hand.
- 3a: each agent row shows the live context-window use of its session (small ring and percent) for Claude Code, Codex, Kiro and Grok. opencode: see "opencode decision".
- 4: only installed supported CLIs are shown. `EMPTY_NONE` names every supported CLI.

## Facts this spec relies on (checked 2026-11-10, read-only, key names and numbers only)

- Herdr's built-in program table (in the app binary) has `"kiro": {"name":"Kiro","icon":"icons/kiro.svg","run":["kiro-cli"],"match":["kiro-cli"],"tint":false,...}` and `"grok": {"name":"Grok","icon":"icons/grok.svg","run":["grok"],"match":["grok-build"],"tint":true,...}`. The program keys are `kiro` and `grok`. Both icons are in `~/.config/herdr-app/icons`.
- Herdr mod API (`~/.config/herdr-app/herdr.d.ts`): `AgentInfo` has `address`, `pane`, `program`, `status`, but no cwd, pid or session id. `PaneInfo` has `pane`, `cwd` (live folder) and `program`. `focused()` has `cwd`. `terminals()` is `hc ls --json` (argv, parent, state, ...). No API field gives an agent's session id. `readTextFile` reads at most 1 MiB. `exec` runs with the user's env, 30 s default timeout.
- Kiro 2.28.0 (`kiro-cli`): `~/.kiro/sessions/cli/` holds `<uuid>.json` (session state, measured 20-29 KB) and `<uuid>.jsonl` (transcripts, up to ~0.9 MB). Files are mode 0600, the folder 0700. `<uuid>.json` keys: `session_id`, `cwd`, `created_at`, `updated_at` (ISO 8601, UTC `Z`), `title`, `session_state.conversation_metadata.user_turn_metadatas[]` with `end_timestamp` (ISO 8601 string) and `metering_usage[]` = `{value: number, unit: "credit", unitPlural}`; `session_state.rts_model_state.model_info.context_window_tokens` (int); `session_state.rts_model_state.context_usage_percentage` (float, 0-100); `session_state.conversation_metadata.last_context_usage.percentage` (same value). Some sessions have no turns.
- Grok 1.0.77: `~/.grok/sessions` has no token counts. The `[ui.status_line]` `type = "command"` row pipes a JSON payload on stdin on every session state change (debounced 300 ms, 10 s timeout, no shell rc files run). Fields used here: `session_id`, `cwd`, `workspace.current_dir`, `model.id`, `model.display_name`, `cost.total_cost_usd` (absent when unknown), `context_window.context_window_size`, `.context_tokens`, `.used_percentage` (whole number), `.session_input_tokens`, `.session_output_tokens`. A script that prints nothing removes the row. The owner's `~/.grok/config.toml` has no `[ui.status_line]` today.
- Claude Code: `~/.claude/projects/<dir>/<session>.jsonl`. `<dir>` is the launch folder with every character outside `[A-Za-z0-9]` replaced by `-` (`add_ons` becomes `add-ons`). Assistant lines have `type: "assistant"`, `isSidechain`, `cwd`, `sessionId`, `message.model` and `message.usage.{input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens}`. The file stores no context-window size. 393 of 1301 session files are over 1 MiB.
- Codex: `~/.codex/sessions/YYYY/MM/DD/*.jsonl`. Line 1 is `type: "session_meta"` with `payload.cwd` (and a large `base_instructions` text). `payload.type: "token_count"` lines carry `payload.info.model_context_window` and `payload.info.last_token_usage.{input_tokens, total_tokens, ...}`. The newest file measured 1.38 MB, so Codex files do not always fit `readTextFile` (the vault note "Codex session files pass it" is out of date).
- opencode: `~/.local/share/opencode/opencode.db` is SQLite. Its schema (read-only, table definitions only) has a `credential` table and an `account` table next to `session` (`directory`, cumulative `tokens_*`, `model`) and `message`. No context-window size is stored.

## opencode decision

opencode gets no context reading in this change: its only local source is a SQLite file that also holds credentials, and it stores no context-window size. Its row looks as it does today. Its Usage reading (`opencode stats --days 7`) does not change.

## How Usage works today (line refs checked against `4c4bc51`)

- `PROVIDER_KEYS = ["claude", "codex", "opencode"]` (`mods/herdsidian-status/usage.js:5`). `providersFrom` keeps installed entries of `knownAgents()` in that order, one per key (`usage.js:20-23`). `EMPTY_NONE` (`usage.js:16`) is drawn when that list is empty (`usage-view.js:56`).
- `ERROR_TEXT` is one flat map (`usage.js:9-15`); `none` is Codex's text.
- `fetchProvider(key, exec)` returns `{data}` or `{error}` and never throws (`usage.js:175-191`). `createUsage` fetches on the first hover, then at most every 5 min, with a 15 s limit per provider (`usage.js:6-7, 195-232`).
- `reading()` (`usage-status.js:31-38`): a `stats` value shows its cost with the label `"7 d"` hard-coded; a `limits` value shows the `5 h` window, else the first. `HIGH_PERCENT = 90`.
- The card (`usage-view.js:27-38`) writes "Last 7 days, no usage limits" for `stats`, and shows `formatAge` and the plan only for Codex (`usage-view.js:35, 46`).
- `main.js:43-63` asks `knownAgents()` on every hover and hovers the keys `providersFrom` returns. `main.js` passes only `exec` to `createUsage` (`main.js:35-39`).
- The Agents rows are drawn in `mods/guide-agents/main.js` (`row`, lines 325-399; the collapsed rail at 329-343; sub-agent rows in `subRow`, 194-217). `init` already runs `cx.timer.every(30000, notify)` (line 89). The layout mounts it at `layouts/herdsidian.json:39`.

## Scope

1. Usage: Kiro and Grok as providers in `herdsidian-status` (reader, status bar, card, errors).
2. Grok hook: a script in this repo, `scripts/grok-status-line.sh`, that Grok runs as its status line. It writes a small state file per Grok session and prints a short status line.
3. Context window on each main agent row of `guide-agents`, for Claude Code, Codex, Kiro and Grok.
4. Disclosure text in `README.md`, `RECIPE.md` and the `usage.js` header comment; install steps for the Grok hook.

## Out of scope

- Any network call, any credential or token read (Keychain for Kiro or Grok, `~/.grok/auth.json`, Kiro's SQLite, `opencode.db`), and running `kiro-cli`, `grok` or `opencode` for context.
- Editing `~/.grok/config.toml` or any agent's config from the mod or from a script. The person installs the hook.
- Kiro's plan cap, overage, add-on credits, reset date. Kiro's V3 session layout (`sessions/<bucket>/sess_*/`); only `sessions/cli/*.json` is read.
- Chaining the Herdsidian hook with a Grok status-line script the person already has. The docs say what to do; no merge tool.
- Pruning old Grok state files (each is under 1 KB).
- Context for opencode, sub-agent rows, the collapsed rail, agents on another machine (address with `/`), and any program other than the four.
- Linux and Windows beyond "does not crash". The hook script is macOS-only (it uses `/usr/bin/plutil`).
- The README line "Not online. Nothing reaches the network." already conflicts with the Claude Usage call; fixing that wording is not part of this change, and this change adds no network use.

## Data contracts

Months are calendar months in the Mac's local time zone: from local midnight of the 1st to local midnight of the next 1st. `<state>` is `${XDG_STATE_HOME:-$HOME/.local/state}/herdsidian` (ADR-0002), resolved through `exec` as `mods/herdsidian/io.js:21-23` does. `<kiro>` is `$KIRO_HOME` when it is an absolute path that is not `/`, not `$HOME` and not a parent of `$HOME`; otherwise `$HOME/.kiro` (Kiro's own rule).

### Usage value: Kiro

```js
{ kind: "month", month: "2026-11", credits: 12.35, costUsd: null, tokens: null,
  sessions: 3, turns: 41, skipped: 0, at: 1762790000000 }
```

- Source files: `<kiro>/sessions/cli/*.json` only (never `*.jsonl`), listed by one read-only `/bin/sh` exec (`find`/`stat`), only files under 1 MiB whose mtime is on or after the month start. Each listed file is read with `readTextFile` (all measured files are under 30 KB).
- A turn counts when its `end_timestamp` falls in the current month; when `end_timestamp` is missing or not a date, the file's `updated_at` is used instead.
- `credits`: sum of `metering_usage[].value` where `unit === "credit"` and `value` is a finite number, over the counted turns, rounded to 2 decimals. `turns`: counted turns. `sessions`: files with at least one counted turn. `at`: the newest counted turn time (ms), or `null`. `skipped`: listed files that could not be read or parsed.
- No percent, no window, no bar, no plan.

### Usage value: Grok

```js
{ kind: "month", month: "2026-11", credits: null, costUsd: 1.23, tokens: 1234567,
  sessions: 2, turns: null, skipped: 0, at: 1762790000000 }
```

- Source files: `<state>/grok/*.json` (the hook's files, below), listed by one read-only exec and read with `readTextFile`. A file counts when its `updated_at` is in the current month.
- `costUsd`: sum of `cost_usd` over counted files that have a finite one; `null` when no counted file has one. `tokens`: sum of `session_input_tokens + session_output_tokens` over counted files (missing counts as 0). `sessions`: counted files. `at`: newest `updated_at`.

### Grok hook state file

Path `<state>/grok/<session_id>.json`, folder mode 0700, file mode 0600, written atomically (temp file in the same folder, then rename). Exactly these keys; a value Grok did not send is `null`:

```json
{ "v": 1, "session_id": "…", "cwd": "/abs/path", "model": "grok-…", "updated_at": 1762790000000,
  "cost_usd": 1.23, "context_window_size": 256000, "context_tokens": 30720, "used_percentage": 12,
  "session_input_tokens": 900000, "session_output_tokens": 34567 }
```

`cwd` is `workspace.current_dir`, else the top-level `cwd`. `model` is `model.id`. `updated_at` is the time of the run (ms). Nothing else from the payload is written (no `session_name`, `transcript_path`, `prompt_id`, repo, branch or worktree fields). `session_id` must match `^[A-Za-z0-9._-]{1,128}$` and must not be `.` or `..`; otherwise nothing is written.

The hook prints one line: `<model.display_name> · <used_percentage>% ctx`, or `<model.display_name>` when the percent is absent; `Grok` stands in for a missing display name. It never prints an empty line.

### Context value (per agent row)

```js
{ percent: 62, usedTokens: 124000, windowTokens: 200000, at: 1762790000000 }
```

`percent` is an integer, clamped to 0-100. `usedTokens` / `windowTokens` may be `null` when the source gives only a percent. No value means "not available".

Pane to session mapping, the same for all four programs: take the agent's `pane` from `agents()`, find that pane in `panes()`, and use its `cwd` and the agent's `program.key`. The session is the newest session of that program whose folder equals that `cwd` and whose file was modified in the last 24 hours.

| Program key | Session files | Folder match | Numbers |
|---|---|---|---|
| `claude` | `~/.claude/projects/<cwd with [^A-Za-z0-9] → ->/*.jsonl` (top level only), newest by mtime | the encoded folder name | Last `type: "assistant"` line with `isSidechain` not true and a numeric `message.usage`. used = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. window = 1,000,000 when `message.model` contains `[1m]` or used > 200,000, else 200,000. |
| `codex` | `~/.codex/sessions/**/*.jsonl`, modified in the last 24 h | `payload.cwd` of line 1 (`session_meta`) | Last `token_count` line with `info.model_context_window > 0`: used = `info.last_token_usage.total_tokens`, window = `info.model_context_window`. |
| `kiro` | `<kiro>/sessions/cli/*.json`, modified in the last 24 h, read with `readTextFile` | top-level `cwd` | percent = `session_state.rts_model_state.context_usage_percentage`, else `session_state.conversation_metadata.last_context_usage.percentage`; window = `rts_model_state.model_info.context_window_tokens`; used = round(percent × window / 100). |
| `grok` | `<state>/grok/*.json`, `updated_at` in the last 24 h | `cwd` | percent = `used_percentage`, else `context_tokens / context_window_size × 100`; used = `context_tokens`; window = `context_window_size`. |

- Claude and Codex files can be over 1 MiB. They are read through one read-only `/bin/sh` exec per program per refresh that looks only at the last 256 KiB of each candidate file (`tail -c`), and prints only folder names, model ids and numbers (for example with `grep -o`). No message text, prompt text or instructions reach the mod. `readTextFile` is never used on a `.jsonl` file.
- Two or more local agents with the same program key and the same pane `cwd`: none of them shows a context value (the mapping cannot tell them apart).
- Refresh: once after the Agents view starts, then every 30 s (on the existing 30 s timer), in a background task. Render only reads the in-memory result. A refresh does not start while the previous one runs. Each refresh runs at most one exec per program that has a listed agent, whatever the number of agents, with a 10 s timeout. No refresh runs while the sidebar is collapsed to the rail or when no listed agent has a supported program key.

## Display contract

Usage, both providers (`kind: "month"`):

| Where | Kiro | Grok |
|---|---|---|
| Status bar main text | `12.35 cr` | `$1.23`, or `1.2M tok` when `costUsd` is `null` |
| Status bar label | the month's short English name, e.g. `Nov` | same |
| Bar, alert mark, `blocked` color | never | never |
| Card note | `This month, no usage limits` | `This month, no usage limits` and `Only Grok sessions run with the Herdsidian status line.` |
| Card lines (label, value) | `Credits 12.35`, `Sessions 3`, `Turns 41` | `Cost $1.23` (or `Cost unknown`), `Tokens 1.2M`, `Sessions 2` |
| Card extra | `updated 5 m ago` when `at` is set; `1 file skipped` / `N files skipped` when `skipped > 0` | `updated 5 m ago` when `at` is set |

Token counts: below 1,000 as is; below 1,000,000 as `12.3K`; else `1.2M` (one decimal). Credits and dollars: two decimals.

Context on a main agent row: on the row's second line, after the status word, a 12 px ring and the percent text, e.g. `62%`, 11 px, `muted`. The ring is `svg("mods/guide-agents/ring/ring-NNN.svg")`, one file per 5 % step (`ringStep(percent)`: the percent rounded to the nearest 5, clamped 0-100, three digits), drawn in `currentColor` with `text_color` `accent`; each file has a track circle at 24 % opacity of the same color and an arc from 12 o'clock clockwise. At 90 % and over, the ring and the text are `t.blocked`. The ring and the percent have the tooltip `Context: 124K of 200K tokens`, or `Context: 62%` when the token numbers are `null`. Colors only from `theme()` and `tokens.js` (ADR-0001). An agent with no context value draws exactly what it draws today.

## Error states

| Provider / feature | State | What shows |
|---|---|---|
| Kiro Usage | `kiro-cli` not installed (`knownAgents()`) | Kiro absent from the control and the card. Nothing runs for it. |
| Kiro Usage | `<kiro>/sessions/cli` missing or has no `*.json` | Card note `No Kiro sessions found.`; status `–` |
| Kiro Usage | sessions exist, no turn this month | A reading: `0.00 cr`, `Sessions 0`, `Turns 0` |
| Kiro Usage | listing exec rejects or exits non-zero | `Usage unavailable.`; status `–` |
| Kiro Usage | some files unreadable, too big or not JSON | Those files are skipped and counted in `skipped`; if every listed file is skipped, `Usage unavailable.` |
| Kiro Usage | over 15 s | `Timed out.` (existing limit) |
| Grok Usage | `grok` not installed | Grok absent. Nothing runs for it. |
| Grok Usage | `<state>/grok` missing or has no `*.json` | Card note `Grok usage needs the Herdsidian status line hook. See Usage in the README.`; status `–` |
| Grok Usage | hook files exist, none this month | A reading: `$0.00`, `Tokens 0`, `Sessions 0` |
| Grok Usage | exec rejects / non-zero, all files bad | `Usage unavailable.` |
| Grok Usage | over 15 s | `Timed out.` |
| Any provider | one provider fails | The others keep their sections and numbers (existing behavior). |
| Grok hook | empty or non-JSON stdin | Prints `Grok`, writes nothing, exits 0 |
| Grok hook | bad `session_id` | Prints the line, writes nothing, exits 0 |
| Grok hook | state folder cannot be created or written | Prints the line, exits 0 (Grok would paint an error otherwise) |
| Context | no source, stale (over 24 h), ambiguous, exec rejects, times out, bad JSON | No ring and no text on that row; no toast; other rows unaffected; no exception reaches render |

## Privacy and disclosure changes

- Usage still reaches only `https://api.anthropic.com/api/oauth/usage` (Claude, unchanged). Kiro and Grok add no host and no credential read.
- New reads by `herdsidian-status`: `<kiro>/sessions/cli/*.json` (session state: cwd, timestamps, credit and token counts; the files also hold a title, which is parsed in memory and never kept) and `<state>/grok/*.json`. New programs: `/bin/sh` with `find`, `stat` (already listed).
- New reads by `guide-agents` (it read no agent files before): the last 256 KiB of Claude Code and Codex session logs, Kiro session state files and the Grok hook files, every 30 s while agents are listed. Only numbers, model ids and folder paths are kept, in memory. It runs `/bin/sh` with `find`, `stat`, `sort`, `head`, `tail`, `grep`.
- The Grok hook writes `<state>/grok/<session_id>.json` (owner-only), one per Grok session, never deleted by Herdsidian. It reads only its stdin. It makes no network call and runs no `git`.
- `README.md` "What it runs and stores" (Usage bullet, lines 302-313, and the `guide-agents` bullet, lines 298-301), `RECIPE.md` (Usage, lines 128-142 and 596-605) and the `usage.js` header comment (lines 1-3) list the above. README "Only Claude Code, Codex and opencode are covered" becomes the five CLIs.
- README and RECIPE give the Grok install steps: copy `scripts/grok-status-line.sh` to a place of the person's choice, `chmod +x` it, and add to `~/.grok/config.toml`:
  ```toml
  [ui.status_line]
  type = "command"
  command = "~/.grok/herdsidian-status-line.sh"
  ```
  then restart Grok. They say that this replaces Grok's built-in status row and any other status-line command, and that Herdsidian never edits that file.

## Acceptance criteria

New tests go in new files, because `tests/usage.test.js`, `tests/usage-view.test.js`, `tests/usage-status.test.js` and the `guide-agents` tests are locked in `.test-lock`. Fixtures are strings or temp folders in the test; no test opens the real home, runs `kiro-cli` or `grok`, or uses the network.

### Usage: providers (tests/usage-providers.test.js)

1. Given `PROVIDER_KEYS`, then it equals `["claude", "codex", "opencode", "kiro", "grok"]`.
2. Given `knownAgents()` with installed `grok`, `kiro`, `gemini`, `opencode`, `codex`, `claude` in any order, plus `kiro` with `installed: false` first, then `providersFrom` returns keys `claude, codex, opencode, kiro, grok`, one each, and no `gemini`.
3. Given no supported CLI installed, then the card text is exactly `No supported agent CLI is installed. Usage covers Claude Code, Codex, opencode, Kiro and Grok.`
4. Given all five installed and the focused pane's `program.key` is `kiro` (then `grok`), when the status mod renders, then that provider's icon (`icons/kiro.svg` / `icons/grok.svg`) is in `usage-primary`, it carries the `focused pane` tag in the card, and the other four follow in `PROVIDER_KEYS` order.
5. Given Usage is off in Settings, or no hover yet, then no `exec` and no `readTextFile` call is made for `kiro` or `grok`.

### Usage: Kiro (tests/usage-kiro.test.js)

6. Given a temp `<kiro>` with: a file with two turns this month (credits 1.25 + 0.10, and 2.00), a file whose only turn ended last month, a file with a turn lacking `end_timestamp` whose `updated_at` is this month (credit 0.5), a file with no turns, a file of invalid JSON and a 1.1 MiB `*.json`, when Kiro is fetched, then the value is `{kind: "month", credits: 3.85, sessions: 2, turns: 3, skipped: 1, costUsd: null, tokens: null, month: <YYYY-MM>, at: <newest end>}` (the 1.1 MiB file is not listed; the bad JSON is skipped).
7. Given `KIRO_HOME` set to an absolute folder, then that folder is read; given `KIRO_HOME` relative, `/`, `$HOME` or a parent of `$HOME`, then `$HOME/.kiro` is read.
8. Given any Kiro fetch, then every `exec` call is `/bin/sh` with a script that contains no `kiro-cli`, `curl`, `http`, `rm`, `mv`, `tee` or redirection other than to `/dev/null`; every `readTextFile` path ends in `.json` and lies under `<kiro>/sessions/cli/`.
9. Given a Kiro reading of 12.346 credits in November, when Kiro is primary, then `usage-percent` reads `12.35 cr`, `usage-label` reads `Nov`, there is no `usage-bar`, and the color is never `t.blocked`; when Kiro is compact, `usage-other-kiro` reads `12.35 cr`.
10. Given that reading with `sessions: 3, turns: 41, skipped: 2` and `at` 5 minutes ago, then the card's Kiro section reads `This month, no usage limits`, `Credits 12.35`, `Sessions 3`, `Turns 41`, `updated 5 m ago`, `2 files skipped`.
11. Given a missing sessions folder, then the Kiro section reads `No Kiro sessions found.` and the status shows `–`; given a rejecting or non-zero listing exec, `Usage unavailable.`; given no answer within 15 s, `Timed out.`; in each case the Claude, Codex and opencode sections still show their readings.

### Usage: Grok (tests/usage-grok.test.js)

12. Given a temp `<state>/grok` with: two files updated this month (cost 1.00 and none; tokens 1,000,000 + 200,000 and 34,567 + 0), one file updated last month and one invalid file, when Grok is fetched, then the value is `{kind: "month", costUsd: 1.00, tokens: 1234567, sessions: 2, skipped: 1, credits: null, turns: null, ...}`.
13. Given counted files that all lack `cost_usd`, then `costUsd` is `null`, the status text is the token total with ` tok` (e.g. `1.2M tok`) and the card reads `Cost unknown`.
14. Given a Grok reading, then the card's Grok section reads `This month, no usage limits`, `Only Grok sessions run with the Herdsidian status line.`, `Cost $1.00`, `Tokens 1.2M`, `Sessions 2`, and there is no `usage-bar` when Grok is primary.
15. Given `grok` installed and no `<state>/grok` folder, then Grok is listed with the note `Grok usage needs the Herdsidian status line hook. See Usage in the README.` and status `–`.
16. Given any Grok fetch, then no `exec` runs `grok`, no path read contains `/.grok/`, and no script writes (same rules as criterion 8).

### Grok hook (tests/grok-hook.test.js; runs the real script, `skip` off macOS)

17. Given the payload fixture on stdin and `XDG_STATE_HOME` set to a temp folder, when the script runs, then it exits 0, prints exactly `Grok 4.5 · 12% ctx`, and writes `<temp>/herdsidian/grok/<session_id>.json` whose parsed keys are exactly the contract's eleven keys with the fixture's values.
18. Given a payload that also has `session_name`, `transcript_path`, `prompt_id`, `workspace.branch`, `workspace.repo` and a `SECRET-MARKER` string in each, then no file under the temp folder contains `SECRET-MARKER`.
19. Given `workspace.current_dir` with a space, a double quote, a backslash and non-ASCII letters, then the written file is valid JSON and its `cwd` equals the input.
20. Given `session_id` `../x`, `a/b`, an empty string or 200 characters, then nothing is written under the temp folder, the line is still printed and the exit code is 0.
21. Given a successful run, then the `grok` folder is mode 0700, the file is 0600, the folder holds only `<session_id>.json` (no temp file left), and a second run with new numbers replaces the file's values.
22. Given empty stdin or `not json`, then the script prints `Grok`, writes nothing and exits 0; given a payload without `model.display_name` or `used_percentage`, it prints `Grok` or `Grok 4.5`.
23. Given the script text, then it names no `jq`, `python`, `node`, `curl`, `git`, `http` or `rm`, and every path it writes is under `${XDG_STATE_HOME:-$HOME/.local/state}/herdsidian/grok/`.

### Context window: sources and mapping (tests/agent-context.test.js)

24. Given a temp home with a Claude session for `/tmp/a b_c` (folder `-tmp-a-b-c`) whose last non-sidechain assistant line has usage 2 + 130,000 + 3,998 and model `claude-x`, plus a later sidechain line with larger numbers, then the value is `{percent: 67, usedTokens: 134000, windowTokens: 200000}`; with used 250,000 the window is 1,000,000 and the percent 25.
25. Given a 2 MiB Claude file whose last 256 KiB hold the usage line, then the reading is found; given a file whose last 256 KiB hold no usage line, then there is no value. A `SECRET-MARKER` in message content appears in no exec output that the mod keeps and in no cached value.
26. Given Codex files for two folders, the newest token_count line of the matching one with `total_tokens` 35,333 and `model_context_window` 258,400, then the value for that folder is `{percent: 14, usedTokens: 35333, windowTokens: 258400}`; the 24-hour filter drops an older file.
27. Given a Kiro `*.json` with `cwd` `/w`, `context_usage_percentage` 12.763 and `context_window_tokens` 200,000, then the value is `{percent: 13, usedTokens: 25526, windowTokens: 200000}`; with only `last_context_usage.percentage`, the same percent.
28. Given a Grok hook file with `cwd` `/w`, `used_percentage` 12, `context_tokens` 30,720, `context_window_size` 256,000, then the value is `{percent: 12, usedTokens: 30720, windowTokens: 256000}`.
29. Given two local Claude agents whose panes have the same `cwd`, then neither row has a context value; given one Claude and one Codex agent in the same `cwd`, both have one.
30. Given a session file older than 24 h, a pane with `cwd: null`, an agent whose address contains `/`, or an `opencode` agent, then that agent has no context value and no exec is run for it.

### Context window: the row (tests/agent-context-view.test.js)

31. Given a Claude agent with a 62 % value, when `guide-agents` renders, then its row contains an element `ctx-<address>` with the text `62%`, a 12 px ring `mods/guide-agents/ring/ring-060.svg` with `text_color` `t.accent`, and the tooltip `Context: 124K of 200K tokens`.
32. Given a 90 % value, then the text and the ring (`ring-090.svg`) use `t.blocked`; given 140, the text is `100%` and the ring is `ring-100.svg`.
33. Given an agent with no value, then its row has no `ctx-` element and its texts equal those of the same row without this feature; sub-agent rows and the collapsed rail never have one.
34. Given the view, when `render` is called any number of times, then it makes no `exec` and no `readTextFile` call; the first refresh starts after `init`, the next ones on the 30 s timer, a refresh never starts while one runs, and with five Claude agents one refresh makes exactly one Claude exec.
35. Given a refresh whose exec rejects, exceeds 10 s or returns non-JSON, then no row shows a context value from it, nothing throws, no toast is shown, and the other programs' values still show.

### Context window: Settings switch (tests/agent-context-settings.test.js)

36a. `SETTING_DEFAULTS` is `{ keyHints: "modifier", usageInStatus: true, contextInSidebar: true }`; `readSettings` keeps a boolean `contextInSidebar` and replaces any other value with `true`. The shared copies of `lib/keys.js` stay byte-identical (lint).
36b. The Layout section lists the rows `right-sidebar`, `sidebar-tab`, `sidebar-width`, `usage-in-status`, `context-in-sidebar`, in that order. The new row's label is `Context in the sidebar`, its detail `On` or `Off`, and it toggles `contextInSidebar` the same way `usage-in-status` toggles `usageInStatus`, keeping the other stored keys. It shows in the sidebar Settings tab and in the ⌘K Settings tab (key `setting:context-in-sidebar`).
36c. Given `contextInSidebar: false`, `guide-agents` draws no `ctx-` element, starts no refresh timer and makes no `exec` or `readTextFile` call for context; turning it on later starts the refresh without a reload; turning it off stops the timer.

### Docs (tests/docs-usage.test.js)

36. Given `README.md` and `RECIPE.md`, then the Usage disclosure names Kiro, Grok, `sessions/cli`, the Grok hook state path `herdsidian/grok`, and still names only `https://api.anthropic.com/api/oauth/usage` as a host; the `guide-agents` disclosure names the Claude, Codex, Kiro and Grok session reads; README contains the `[ui.status_line]` block with `type = "command"` and says Herdsidian never edits `~/.grok/config.toml`.
37. Given `mods/herdsidian-status/usage.js`, then its header comment lists every program and path the Usage readers use.

### Gate (not a test file)

38. `npm --prefix <repo> test` and `npm --prefix <repo> run lint` pass; `test-lock.sh verify` passes; `herdr-app check` passes for `mods/herdsidian-status` and `mods/guide-agents`.

### Live checks (screenshots by Godfather, `herdr-app shot`, demo data for anything published)

39. With Kiro focused, the status bar shows the Kiro icon, `<n> cr` and the month label; the card lists all installed providers.
40. With the hook installed and a Grok session open, `<state>/grok/<id>.json` appears within 2 s of a turn and the Usage card shows Grok's month numbers.
41. An agent row for each of Claude Code, Codex, Kiro and Grok shows the ring and percent in `hs_carbon` and one light theme; the row height does not change.
42. `knownAgents()` returns `key: "kiro"` and `key: "grok"` with `installed: true` on the owner's Mac (expected from the program table; not yet seen live).

## Existing tests that change

Added 2026-11-10 with the Settings switch (locked files, fixture-only, approved by the owner 2026-11-10): `tests/settings.test.js:6`, `:29` and `tests/palette.test.js:722-726` add `contextInSidebar: true` to the expected settings; `tests/settings.test.js:64`, `:103` and `tests/palette.test.js:738` add `"context-in-sidebar"` and `tests/palette.test.js:787` adds `"setting:context-in-sidebar"` at the end of the row lists. 11 assertions in 2 files; no assertion is removed or loosened.


Grep run: `PROVIDER_KEYS`, `EMPTY_NONE`, `ERROR_TEXT`, provider key lists, `"7 d"`, `Last 7 days`, `fetchProvider`, `createUsage`, and every test that imports `mods/guide-agents/main.js`. Fixtures in the usage tests list only `opencode`, `codex`, `claude`, `gemini` (`usage-view.test.js:17-22`, `usage-status.test.js:24-29`), so adding `kiro` and `grok` to `PROVIDER_KEYS` does not change what they render. Tests import `EMPTY_NONE` as a constant (`usage-view.test.js:15, 106`), so its new text does not break them.

| File:line | Breaks? | Reason |
|---|---|---|
| `tests/usage.test.js:454-462` ("error texts are exactly the spec's (AC19)") | Yes, if the new notes are added to `ERROR_TEXT` | It asserts `ERROR_TEXT` deep-equals exactly five keys. Adding `No Kiro sessions found.` and the Grok hook note to that map makes it fail. The file is locked: changing it needs Andersson's `test-lock.sh unlock` after rule 3 of the test integrity rules. The texts are the contract, not their location: keeping the two notes outside `ERROR_TEXT` leaves this test untouched. Decide in design. |
| `.test-lock` | Yes (appended) | The new test files are locked after their red run. No existing hash changes unless the row above is changed. |
| `tests/usage.test.js:18-28, 30-34` (`providersFrom`) | No | Fixtures have no `kiro`/`grok`; the result stays `Claude Code, Codex, opencode`. |
| `tests/usage.test.js:300-318` (`fetchProvider` for 3 keys) | No | Kiro and Grok are not in its loops. A new optional reader argument must keep `fetchProvider(key, exec)` working. |
| `tests/usage.test.js:328-405` (cache hovers `["claude","codex","opencode"]`) | No | Keys are passed explicitly. |
| `tests/usage.test.js:443-452` (cache keys of a Claude entry) | No | Claude's value shape does not change. |
| `tests/usage-status.test.js:86-99` (`primaryKey`, `orderedProviders`) | No | Inputs are the three old keys; appended keys do not change the first installed one. |
| `tests/usage-status.test.js:101-109` (`reading`, opencode `label: "7 d"`) | No, if `stats` keeps `"7 d"` | Kiro and Grok use the new `month` kind. Changing `stats` would break line 106. |
| `tests/usage-status.test.js:129-138, 166-206, 230-242, 270-276, 362-371` (rendered control, card order, exec calls) | No | They render with the fixture `AGENTS` (no `kiro`/`grok`); exec calls stay `["/bin/sh", "/bin/sh", "opencode"]`. |
| `tests/usage-view.test.js:85-132, 160-171` (icons, `EMPTY_NONE`, card text, timers `[15000 ×3]`) | No | Same fixture reason; `EMPTY_NONE` is compared to the imported constant. |
| `tests/hints-hover.test.js:46-50`, `tests/next-blocked.test.js:76-85`, `tests/needs-next.test.js`, `tests/polish-needs.test.js`, `tests/sidebar-view.test.js`, `tests/palette.test.js` (render `guide-agents`) | No, if criteria 33-35 hold | They use the default stubs: `panes()` is `[]`, so no agent has a cwd and no context value; `exec` answers empty; `readTextFile` rejects (the code must catch it); `fakeCx().timer.after()` returns `undefined` (the code must not call `.cancel()` on it unguarded). `hints-hover` asserts `texts(row).includes(...)`, which an extra text would not break, and there will be none without a value. |
| `tests/lint.test.js`, `scripts/lint.js:109-110` | No test change | A new pure file (for example a context parser in `guide-agents`) should be added to the lint `pure` set; that is a code change in `scripts/lint.js`, not a test change. |
| `tests/mods-ui.test.js:136-142` (no Usage ids in the toolbar) | No | Nothing is added to the toolbar. |

## Known limits (accepted by the owner, 2026-11-10)

- Grok numbers come only from the status-line hook. Grok 1.0.77 writes no `signals.json` on this Mac and `grok usage <session>` reports "No usage recorded", so no second Grok source is read. Revisit when a Grok release persists usage by default.
- The context parse cache is keyed on whole-second mtime and size. A same-second, same-size rewrite of a Kiro or Grok file keeps the older value until the file changes again. Fixing it needs two locked tests changed; the owner kept it as is.


## Open questions

No blocking question. These can be answered after the build without changing a criterion:

1. Claude's window table: 200,000 by default and 1,000,000 for `[1m]` or used over 200,000. If the owner's Claude model has a 1M window by default, the ring reads high until the first turn passes 200K. Confirm against Claude Code's `/context` on the Mac.
2. Codex percent is `last_token_usage.total_tokens / model_context_window`. Codex's own footer may differ by a few points (it subtracts a fixed baseline). Accept the difference or match Codex's formula.
3. The 24-hour freshness rule can show the previous session's context for a just-started agent that has not written yet in the same folder. If `terminals()` exposes a start time, "modified after the terminal started" is better. Check `hc ls --json` field names on the Mac.
4. Resolved 2026-11-10 by the owner: yes, a Settings switch like Usage in the status bar (see "Context window: Settings switch").
5. Month boundaries use the Mac's local time zone. Kiro bills by its own cycle; small differences on the 1st are expected.
6. Grok's `cost.total_cost_usd` counts from the last resume, and a session that spans two months counts entirely in the later month. The card note says only hooked sessions count; say more, or accept.
7. Spec location: the project file says specs live in the vault `05-Specs/herdsidian/`; this one is in `docs/specs/` as requested. Confirm it may be public (it holds no names, paths beyond `~`, or personal numbers).

## Sources

- This repo at `4c4bc51`: `mods/herdsidian-status/{usage.js,usage-status.js,usage-view.js,main.js}`, `mods/guide-agents/main.js`, `mods/herdsidian/io.js`, `scripts/lint.js`, `tests/usage*.test.js`, `tests/support/mod-stubs.js`, `tests/hints-hover.test.js`, `.test-lock`, `README.md`, `RECIPE.md`.
- `~/.config/herdr-app/herdr.d.ts` and `AGENTS.md` (Programs, Agents, herdr-core).
- `~/.grok/docs/user-guide/25-status-line.md` (Grok 1.0.77).
- The superseded proposal `docs/specs/kiro-usage.md` (Kiro docs, CodexBar and RimZ references).
