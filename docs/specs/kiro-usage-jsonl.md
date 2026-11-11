# herdsidian-kiro-usage-jsonl — Kiro credits from messages.jsonl

> **TL;DR:** The Kiro Usage card can show 0.00 credits for the current month because it still reads only top-level `sessions/cli/*.json` and `metering_usage`. Kiro now records credits in `messages.jsonl` as `usage_summary` lines. Add a read-only reader for those lines, keep the old reader as a fallback, and leave the context ring for a later change.

Status: draft, waiting for Andersson's approval.
Extends the earlier usage specification (private vault). The hover card, the 5-minute cache, and the error texts stay as that spec and the later Kiro work defined them.
Upstream: https://github.com/anderssonq/herdsidian branch `main`, commit `8cdcc8d` (2026-11-11, `feat(herdsidian): add agent toast cards and polish the Files tab (#14)`). Line numbers below are from that commit.
This file is the spec only. Implementation goes to `anderssonq/herdsidian` after approval.

## Problem
On Andersson's machine the Kiro section of the Usage card shows 0.00 credits, 0 sessions and 0 turns for November 2026. His own count of the new session files is 616.22 credits, 223 turns and 26 sessions, and it grows with use. Those figures are reported. This agent had no copy of his `~/.kiro` tree and did not reproduce them.

Kiro stopped writing the old session JSON after 2026-10-21 (reported). The mod still sums that old shape, so a month with no old turns shows zeros while the new files hold the month.

## Evidence

### Confirmed in the upstream repo
Checked read-only on a depth-1 clone of `8cdcc8d`. `cmp` found `lib/agent-files.js`, `mods/herdsidian-status/agent-files.js` and `mods/guide-agents/agent-files.js` byte-identical.

| What | Where |
|---|---|
| `list_json` lists only top-level `*.json` (`find -maxdepth 1 -type f -name '*.json'`). `*.jsonl` and files in subfolders are omitted. | `lib/agent-files.js:19-32`. Locked by `tests/agent-files.test.js:60-78` (skipped unless `darwin`) |
| `kiroListScript` runs that lister on `"$(kiro_dir)/sessions/cli"` only. Usage calls it with no minute window, so every top-level JSON is listed and the month cut happens in JS. | `lib/agent-files.js:35-36`, `mods/herdsidian-status/usage-month.js:14`, `usage-month.js:47`, `usage-month.js:59` |
| `kiro_dir` prints `$KIRO_HOME` with one trailing slash removed when that value is absolute, is not `/` or `//`, is not `$HOME`, and is not a parent of `$HOME`. Every other value prints `$HOME/.kiro`. | `lib/agent-files.js:15-17`. Tests `tests/agent-files.test.js:24-40` passed here |
| `parseKiroSession` sums `session_state.conversation_metadata.user_turn_metadatas[].metering_usage[]` where `unit === "credit"` and `value` is a finite number. Turn time is `end_timestamp`. Title and every other field are dropped. | `lib/agent-files.js:66-89` |
| `fetchKiro` success value is `{ kind: "month", month, credits, costUsd: null, tokens: null, sessions, turns, skipped, at }`. `credits` is rounded to two decimals once. `month` is the local calendar month. | `mods/herdsidian-status/usage-month.js:21-26`, `usage-month.js:43`, `usage-month.js:76`, `usage-month.js:114-116` |
| Error keys are `kiroNoSessions` and `unavailable`. Card text is `No Kiro sessions found.` and `Usage unavailable.` | `usage-month.js:8-9`, `usage-month.js:50-53`, `usage-month.js:102`, `usage-month.js:116`; `mods/herdsidian-status/usage.js:13-21` |
| A listed file is read only when `size < MAX_READ_BYTES` (`1048576`). `fetchMonth` never calls `readTextFile` on the rest, and counts them in `skipped`. | `lib/agent-files.js:7-9`, `usage-month.js:45-47`, `usage-month.js:104`. Test `tests/agent-context-fixes-3.test.js:68-70` |
| The test double of `readTextFile` rejects when `size > 1024 * 1024` (`Text file exceeds 1 MiB`) and accepts a file of exactly 1 MiB. | `tests/support/real-host.js:13`, `tests/support/real-host.js:86-88`; `tests/vault-fs.test.js:116-121` |
| The three `agent-files.js` copies must match. Lint fails a mod copy that differs from `lib/agent-files.js`. | File comment `lib/agent-files.js:5`. Lint `scripts/lint.js:60-69`. Test `tests/agent-context-fixes-3.test.js:68-74` |
| The guide-agents context ring lists the same old folder (`kiroListScript(1440)`) and parses it with `parseKiroSession`. A file of 1 MiB or more contributes cwd only, from a `"cwd"` match in the first 4 KiB. | `mods/guide-agents/agent-context.js:5-6`, `agent-context.js:61-70`, `agent-context.js:197-201`, `agent-context.js:266-270`, `agent-context.js:289-314`, `agent-context.js:347-356` |
| The card prints Kiro as Credits / Sessions / Turns, then `1 file skipped` or `N files skipped` when `skipped > 0`. | `mods/herdsidian-status/usage-view.js:41-48` |
| README and RECIPE tell the reader the mod lists `sessions/cli/*.json` and then uses `readTextFile`. | `README.md:319-323`, `RECIPE.md:607-610` |

A search of that tree found no `usage_summary`, `messages.jsonl`, `promptTurnSummaries`, `sub_agent_start` or `sub-executions`. The new format is absent from the code.

Zeros are a success value, which is why the card can show 0.00 rather than an error. `sourceError` returns `kiroNoSessions` when the listing has no directory or no files. When at least one `*.json` is listed and no turn falls inside the month, `kiroMonth` returns credits 0, sessions 0, turns 0 (`usage-month.js:50-76`). `twoDecimals(0)` is `0.00` (`usage-month.js:32`, `usage-view.js:42`). Old files still sitting in `sessions/cli` after 2026-10-21 produce that result for November. This agent did not see those files.

### Reported by Andersson
Local data on his machine. Not reproduced here.

- Old files: `~/.kiro/sessions/cli/*.json` with per-turn `metering_usage`. Last write 2026-10-21.
- New files: `~/.kiro/sessions/<workspace-hash>/sess_<uuid>/messages.jsonl` plus `session.json` (cwd in `workspacePaths` / `rootPaths`). Also `sessions/_global/sess_*/`.
- A turn ends with one JSON line whose `payload.type` is `usage_summary`. `promptTurnSummaries[]` carries `unit`, `unitPlural`, `usage` and `usedTools`. The line also has `timestamp`, `turnId` and `executionId`. Credits are the sum of `usage` where `unit` is `credit`. The turn's date is the line's `timestamp`.
- `messages.jsonl` reaches 7.2 MB. 21 of 121 files are over 1 MiB, so `readTextFile` cannot carry them. The shell step has to return the usage lines only.
- His tree has 700 or more sessions. The independent November 2026 total is 616.22 credits, 223 turns, 26 sessions.

### Corrections
These are the places the report's shorthand is wider than the code. The spec follows the code.

- `kiro_dir` does not take every `$KIRO_HOME`. The rule in the table above is the one the tests lock. The new reader uses that same function.
- `kiroNoSessions` and `unavailable` are error keys. The visible strings are `No Kiro sessions found.` and `Usage unavailable.` The reported 0.00 card is the success object, which the code returns when old JSON files exist and none of their turns are in the month.
- Usage treats a file of exactly 1 MiB as not readable (`size < 1048576`). The test double of `readTextFile` still reads that exact size and rejects only a larger file. The comment in `lib/agent-files.js:8` says `readTextFile` refuses `MAX_READ_BYTES` or more. A file over 1 MiB is refused by both. The reported 7.2 MB files are over both bounds.
- The source comment calls the byte-copy rule ADR-0001. In this vault ADR-0001 (Every mod color derives from the theme) in the maintainer's notes is the color rule. The copy rule is what `scripts/lint.js` enforces, and ADR-0005 (Agent context window comes from each CLI's local session files) in the maintainer's notes also states it. Implementation keeps the three files byte-identical either way.
- `-newermt` is not in the current scripts. The lister's optional window is `-mmin`, and Usage does not pass one. The month cut for the old files is `mtimeMs >= startMs` in JS.

### Test run on this clone
`npm test` (`node --test tests/*.test.js`, Node v22.23.4) on Linux, exit code 1.

| Result | Count |
|---|---|
| pass | 1436 |
| fail | 8 |
| skipped | 51 |
| total | 1495 |

`kiro_dir` and `parseKiroSession` passed. The four `list_json` disk tests were skipped because the host is not `darwin` (`stat -f`). The Kiro temp-folder fetch tests are skipped the same way.

The 8 failures are outside the Kiro reader. One is `tests/usage.test.js` ("the token reader returns the claudeAiOauth token..."), whose script calls `plutil`, which this host does not have, so stdout was empty. The other seven are in `tests/vault-actions-fs.test.js` (folder rename and note-update cases, including "the guard uses the system stat"). They are a Linux run of macOS shell scripts, not a Kiro regression. `herdr-app check` was not run. Herdr is not on this host.

## Objective
A person who uses Kiro in Herdr hovers Usage and sees this month's credits, sessions and turns from the files Kiro writes now. Sessions that exist only in the old JSON still count. The card's shape does not change.

## User story
As a person who runs Kiro in Herdr, I want the Usage card to show this month's Kiro credits, sessions and turns from `messages.jsonl`, so that a month with no new `sessions/cli/*.json` file does not read as zero while Kiro is in use.

## Goals
- Count the new `usage_summary` lines for the local calendar month.
- Keep `parseKiroSession` and the `sessions/cli/*.json` reader, and merge the two without counting one session twice.
- Leave `fetchKiro`'s success object and the two error keys as they are.
- Read Kiro with one read-only `/bin/sh` and no network. The value kept in memory holds timestamp, unit and usage, plus the session id taken from the path.
- Read files over the 1 MiB limit in that shell step. `readTextFile` is not called on `messages.jsonl`.
- Keep the three `agent-files.js` files byte-identical so lint stays green.
- Add tests. Leave every existing assertion in place.

## Non-goals
- Grok, Claude Code, Codex and opencode.
- Switching the guide-agents context ring to the new files. That is Phase 2.
- Reading `session.json` for the usage total. The reported cwd fields are not part of the month object.
- Calling the `kiro` CLI, writing under `~/.kiro`, or any network call.
- A per-tool breakdown. `usedTools` is not kept.
- Raising `FETCH_LIMIT_MS` (15 s) or the `readTextFile` limit.
- Linux and Windows Kiro homes. The scripts stay on macOS `find` and `stat -f`, as today.

## Decisions made in this spec
- S1. One turn is one `usage_summary` line whose `timestamp` parses and falls in `[startMs, endMs)` of `monthOf`. Credits for that line are the sum of `promptTurnSummaries[].usage` where `unit === "credit"` and `usage` is a finite number. Any other unit adds nothing. A line with no credit entry is still one turn with 0 credits when its timestamp is in the month.
- S2. A session counts when it has at least one such turn. `at` is the latest of those timestamps in milliseconds, or null when there are none. `credits` is rounded once with the existing `round2`.
- S3. The new session id is the parent directory name `sess_<uuid>`. The old session id is the top-level `session_id` string of the JSON already read for `parseKiroSession`. They are the same session when the strings are equal, or when one equals the other plus a `sess_` prefix. Same session and same timestamp: one turn, and the new-format credit sum wins. An old file with no string `session_id` stays its own session. cwd and title are not keys.
- S4. `parseKiroSession`'s return value stays as it is, so the current deep-equal tests stay word for word. A new pure function reads `session_id` for the merge.
- S5. The new lister selects `messages.jsonl` whose parent directory is `sess_*` under `<kiro>/sessions` (this covers `<workspace-hash>/sess_*` and `_global/sess_*`). It opens a file only when its mtime is at or after the local month start.
- S6. The mtime test is `find -newermt` with the month-start date when the macOS `find` Herdr already runs accepts it. Otherwise it is `-mmin` with the whole minutes since that month start, the form `list_json` already uses. Confirm which one on the Herdr Mac. Do not add a GNU-only flag.
- S7. After that filter, the shell handles at most 400 `messages.jsonl` files, newest mtime first. The rest increment `skipped`. The cap is a backstop for the reported 700 or more sessions. It sits above the reported 121 files. The shell is one exec and has to finish inside the existing 15 s fetch limit.
- S8. `kiroNoSessions` when both listings have nothing to read (no directory, or no files). `unavailable` when the shell exits nonzero, or when every new candidate was skipped and the old reader added no in-month turn. Old files that parse and simply have no in-month turn are not skipped, same as today. A new reading with an empty old folder is success.
- S9. Until OQ1 is answered, count `usage_summary` lines only in those listed `messages.jsonl` files. No second walk of a nested sub-executions folder in this change.
- S10. `parseKiroUsageLines` lives in `lib/agent-files.js` next to `parseKiroSession`, is exported, and imports nothing. Both mod copies are updated with `cp` in the same change. `guide-agents` does not call it in this change.

## Requirements
- K1. `parseKiroUsageLines` takes the text of `usage_summary` lines (fixture or shell output) and returns sessions of `{ id, turns: [{ atMs, credits }] }`. The returned JSON has only those keys. A line that is not JSON, or whose `payload.type` is not `usage_summary`, is dropped. A timestamp that does not parse drops that line.
- K2. The shell prints session ids from paths and, per credit or other summary entry, the timestamp, the unit and the usage. It does not print titles, prompts, message bodies, `usedTools`, `turnId` or `executionId`. A fixed selector may find `"type":"usage_summary"` lines. The following cut keeps the three fields. Neighboring lines of `messages.jsonl` are not printed.
- K3. `fetchKiro` does not call `readTextFile` on any `messages.jsonl`. Old `*.json` files under the 1 MiB rule still go through `readTextFile`.
- K4. File paths from `find` are command arguments (`-exec` or equivalent), never spliced into a `sh -c` string. The directory from `kiro_dir` is quoted on every expansion, as `"$(kiro_dir)/sessions/cli"` is today.
- K5. The script is read-only. No write redirection except `2>/dev/null` on `find` and `stat`, no `rm`, `mv`, `tee`, no network, no `kiro` CLI. Same bar as the `list_json` source test.
- K6. The merge follows S3 and S8. `fetchGrok`, `grokMonth` and `parseGrokState` stay as they are.
- K7. The success object keeps `kind`, `month`, `credits`, `costUsd: null`, `tokens: null`, `sessions`, `turns`, `skipped`, `at`. The card still shows Credits, Sessions, Turns, and the existing skipped line. Error keys stay `kiroNoSessions` and `unavailable`.
- K8. README, RECIPE and the header comment in `mods/herdsidian-status/usage.js` name the new `messages.jsonl` paths and say the shell prints only timestamp, unit and usage. The guide-agents disclosure stays on `sessions/cli` until Phase 2.
- K9. Sub-agent lines are handled only as S9. The open question stays written in the code comment next to the lister so a later walk is a conscious change.

## Acceptance criteria
Each item says where the proof lives. (unit) is a Node test with fixture strings, never a real transcript. (live) is on Andersson's Mac. (review) is a read of the diff.

### Parser
- [ ] AC1. `parseKiroUsageLines` on the fixture below returns one turn at `2026-11-03T15:04:05.000Z` with credits `1.5`. The `token` entry adds nothing. The return value has no `usedTools`, `turnId`, `executionId` or `readFile`. A second line with a bad timestamp is dropped. A line that is not JSON is dropped. (unit)

```
{"timestamp":"2026-11-03T15:04:05.000Z","payload":{"type":"usage_summary","promptTurnSummaries":[{"unit":"credit","unitPlural":"credits","usage":1.25,"usedTools":["read"]},{"unit":"credit","usage":0.25},{"unit":"token","usage":9}],"turnId":"t1","executionId":"e1"}}
```

### The month
- [ ] AC2. Given several sessions and a fixed `now` in November 2026, the month value counts credits and turns inside `[startMs, endMs)`, ignores an October line and a December line, ignores a session whose only lines are outside the month, and sets `at` to the latest in-month timestamp. Credits are rounded once at the end (`1.005 + 1.005` follows the existing `round2`). `costUsd` and `tokens` are null. (unit)

### Fallback and merge
- [ ] AC3. An old JSON `session_id` of `sess_aaa` and a new folder `sess_aaa` with the same timestamp produce one session and one turn, and the credits are the new line's. An old-only timestamp on that id is kept. A different id is a second session. An old file with no `session_id` is not merged onto a new folder that shares its cwd. (unit)
- [ ] AC4. `fetchKiro` with an empty old folder and one new in-month line returns the success object, not `kiroNoSessions`. Both listings empty returns `{ error: "kiroNoSessions" }`. Every new file skipped, and no old in-month turn, returns `{ error: "unavailable" }`. A nonzero shell exit returns `{ error: "unavailable" }`. (unit)

### Files over 1 MiB
- [ ] AC5. A `messages.jsonl` larger than 1 MiB is not passed to `readTextFile`. A stub `readTextFile` throws if the path ends in `.jsonl`. The stub shell returns the usage fields for that file, and those credits are in the total. A file the shell cannot read increments `skipped`. Files past the 400 cap increment `skipped` and are not opened. (unit)

### Shell
- [ ] AC6. The script constant has no write, no network and no `kiro` CLI, and file paths are arguments. A path with a space and a path with a quote survive as one argument. (unit)
- [ ] AC7. The shell output that `fetchKiro` parses contains timestamp, unit and usage, and does not contain a fixture prompt planted on the next line of the same file. (unit)

### Copies and disclosure
- [ ] AC8. After the change, `lib/agent-files.js` and the copies in `mods/herdsidian-status` and `mods/guide-agents` are byte-identical. `npm run lint` passes. `parseKiroSession`'s existing tests still assert cwd, turns, context, and that the title is absent. (unit)
- [ ] AC9. README, RECIPE and the `usage.js` header name the new paths and the three fields the shell prints. `guide-agents` text still describes `sessions/cli` until Phase 2. (review)

### Checks
- [ ] AC10. On the machine that holds the sessions, a `python3` sum of the same fields (credit `usage`, line timestamp, session id from the `sess_*` directory), for the same local month, matches the mod's credits to the cent, and matches turns and sessions. The program prints those three numbers only. No session file is committed. (live)
- [ ] AC11. `herdr-app check mods/herdsidian-status` passes. (live)
- [ ] AC12. `npm test` in the herdsidian repo does not regress. New tests are added. No existing assertion is deleted or loosened to make a run pass. The baseline on the Linux clone of `8cdcc8d` is 1436 pass, 8 fail, 51 skipped, and those 8 failures are the `plutil` test and the vault-actions tests named above. A macOS run is the one that must stay green, including the tests this Linux host skipped. (unit)

## Tasks
- [ ] T1. Add `parseKiroUsageLines` and the session-id helper in `lib/agent-files.js`. Add fixture tests. Copy the file with `cp` into both mods.
- [ ] T2. Add the read-only lister (mtime filter, 400-file cap, quoted paths, three-field output) and call it from `fetchKiro`.
- [ ] T3. Merge old and new turns per S3 and S8. Leave `parseKiroSession`'s return value and the Grok functions as they are.
- [ ] T4. Update README, RECIPE and the `usage.js` header comment.
- [ ] T5. Run `npm test`, `npm run lint` and `herdr-app check mods/herdsidian-status`. Andersson runs the `python3` comparison. Do not commit his session files.

## Phase 2
Separate change. Not part of the tasks above.

The context ring still reads `sessions/cli/*.json` through `parseKiroSession`, which takes `context_usage_percentage` and `last_context_usage.percentage` (`lib/agent-files.js:80-88`). The reported `usage_summary` line has `type`, `promptTurnSummaries` (`unit`, `unitPlural`, `usage`, `usedTools`), `turnId` and `executionId`. No context percentage is in that line. `session.json` is reported to carry cwd in `workspacePaths` / `rootPaths`. No context field was reported for it.

Whether the new format carries a context percentage is unverified. Do not invent a field name. Phase 2 looks at a real file only to see if such a field exists, and only then teaches the ring. Until that change, a session that exists only as `messages.jsonl` shows no context value. That gap is accepted here.

## Platforms
macOS, Herdr desktop. The shell uses the same `find` and `stat -f` as the current Kiro lister. No E2E agent fits Herdr. AC10 and AC11 are Andersson's live checks.

## Scope
- `lib/agent-files.js`, then the byte copies `mods/herdsidian-status/agent-files.js` and `mods/guide-agents/agent-files.js`.
- `mods/herdsidian-status/usage-month.js` (`fetchKiro` and the merge).
- Tests for the parser, the merge, the oversize path and the script constant.
- README, RECIPE, and the Kiro sentence in the `usage.js` header comment.

## Out of scope
- `mods/guide-agents/agent-context.js` behavior (Phase 2).
- Grok's lister, parser and card.
- Any write to Kiro's files, the `kiro` CLI, and the network.
- Committing real `messages.jsonl` files or their prompts.
- Changing the 15 s fetch limit, the 5-minute cache, or the card layout.

## Risks
- R1. The reported layout is one machine. A `messages.jsonl` whose parent is not `sess_*`, or a usage line with a different shape, is skipped rather than guessed. AC1 locks the shape that was reported.
- R2. A month with more than 400 touched `messages.jsonl` files under-counts and shows the skipped line. The cap is there so a hover does not walk 700 sessions.
- R3. A prompt that itself contains `"type":"usage_summary"` can match the selector. The parser keeps the line only when it is one JSON object of that type, and the shell prints the three fields rather than the line. A prompt on the next line is not printed (AC7).
- R4. The month boundary is local time, the same `monthOf` as today. An ISO timestamp near midnight can fall in the next local month.
- R5. The context ring stays on the old files until Phase 2. New sessions can show no context percentage. That is the accepted gap, not a silent success.
- R6. OQ1 can under-count if sub-agent credits live only outside the parent `messages.jsonl`. This change does not add a second walk that could also double-count them.

## Open questions
- OQ1. Do sub-agent executions (`sub_agent_start` / sub-executions) emit their own `usage_summary` lines in the parent `messages.jsonl`, in another file, or both? The upstream repo contains neither string. S9 counts the listed parent files only. Answer this before any second walk, so those credits are neither duplicated nor dropped.
- OQ2. Confirm on one synthetic pair whether the old `session_id` equals `sess_<uuid>` or the bare uuid. S3 treats those two as the same session. Do not use a real transcript as the fixture.
- OQ3. Phase 2 context percentage. Unverified. No field name is proposed here.
- OQ4. Whether the macOS `find` on the Herdr machine accepts `-newermt`. Not run on this Linux clone. S6 is the fallback.

