# SDD: Kiro as a fourth Usage provider

Status: proposal. Implementation waits for the owner's approval. This document changes no code.

## Objective

Show Kiro in the Usage control of the `herdsidian-status` mod, the same way Claude Code, Codex and opencode are shown today: the focused pane's provider in full (icon, main number, bar, window label), the others compact, and the hover card with every installed supported provider.

The reader must be local and read-only if a local source of the account numbers exists. It must not call a Kiro or AWS API, must not read a token, and must not start a Kiro chat, until the owner approves that path. When Kiro is missing or not signed in, the control degrades the way the other providers do and the card keeps rendering.

## Scope

- One new provider key, `kiro`, appended to `PROVIDER_KEYS`.
- A pure parser and a read-only fetch path in `mods/herdsidian-status/usage.js`, mapped onto the existing `{ kind: "limits", windows, plan, at }` value that `windowView` and `usageCard` already draw.
- Status-bar and card behavior for that value: primary when the focused pane's program key is `kiro`, plan name beside the provider name, dash and an error note when there is no reading.
- Node tests for the parser, the provider order, and the card, using fixtures the owner confirms. No live `kiro-cli`.
- The disclosure paragraphs in `README.md` and `RECIPE.md` that list every program Usage runs.

## Out of scope

- Any edit in this change set. The implementation below is a plan, not a patch.
- A new icon, a layout edit, or a `programs.json` edit. Herdr already ships Kiro.
- Calling `GetUsageLimits`, reading `kiro-cli`'s token store, or running `kiro-cli chat` (including `chat --no-interactive "/usage"`). Those are named below and stay blocked until the owner approves one of them.
- Overage billing, bonus-credit packs, context-window percentage, and per-session credit totals, except as fields a confirmed source already separates.
- Linux and Windows behavior beyond "do not crash". The layout is tested on macOS.
- Refreshing, writing, or deleting Kiro sessions, credentials, or settings.

## How Usage works today

`mods/herdsidian-status` is a frozen copy of Herdr's `workspace-status` 0.1.10 (`mods/herdsidian-status/mod.json` lines 1–5). Usage was added in this repo. The layout mounts it as the 28 px status block (`layouts/herdsidian.json` lines 121–130).

`PROVIDER_KEYS` is `["claude", "codex", "opencode"]` (`mods/herdsidian-status/usage.js` line 5). `providersFrom` keeps `knownAgents()` entries whose `key` is in that list and whose `installed` is `true`, one per key, in that order (lines 19–23). Gemini is installed in the tests and is dropped (`tests/usage.test.js` lines 18–27, `tests/usage-view.test.js` lines 17–21).

`EMPTY_NONE` is the card text when that list is empty (`usage.js` line 16, drawn at `usage-view.js` lines 52–56):

> No supported agent CLI is installed. Usage covers Claude Code, Codex and opencode.

Each provider returns `{ data }` or `{ error }` and never throws (`usage.js` lines 174–190). The cache fetches on the first hover, then at most every 5 minutes (`CACHE_MS`, lines 6 and 220–227). `main.js` asks `knownAgents()`, then hovers exactly the keys `providersFrom` returned (lines 43–61). No `main.js` change is required for a fourth key.

`focusedProgramKey` reads `pane.program.key` (`usage-status.js` lines 10–14). `primaryKey` uses that key when it is both supported and installed, otherwise the first installed key (lines 17–19). `orderedProviders` puts the primary first (lines 23–27).

A limits reading is `{ kind: "limits", windows, plan, at }`. Each window is `{ label, percent, resetsAt }` with `resetsAt` in milliseconds or `null` (Claude: `usage.js` lines 80–86; Codex: lines 125–133). `windowView` clamps the percent to 0–100 and formats the reset (`usage.js` lines 63–67). The status bar's main number is the window labeled `"5 h"`, otherwise the first window (`usage-status.js` lines 31–38). Codex is the only key that zeros a window whose reset is already past (`zeroPast`). The card draws one row per window (`usage-view.js` lines 15–21 and 35–37) and shows `data.plan` only for Codex (line 46).

opencode is the other shape, `{ kind: "stats", cost, input, output }`, with no bar (`usage-status.js` line 34, `usage-view.js` lines 31–33). Kiro should not use that shape: its account numbers are a credit allowance, not a 7-day dollar cost.

## Where Kiro already is

This repo has no `programs.json` and no `kiro` string. Herdr's built-in table does. From `herdrdev/herdr-app` `defaults/programs.json` (blob `a1b17af918880f52589528e9ff68298fbb0859d1`, line 17):

```json
"kiro": {"name":"Kiro","icon":"icons/kiro.svg","run":["kiro-cli"],"match":["kiro-cli"],"tint":false,"tile":"#1c1d21","color":"#ffffff"}
```

`knownAgents()` lists programs that have a `run` command and reports whether that command is installed (Herdr's `defaults/AGENTS.md`, "Programs: `programs.json`" and the `knownAgents({ on })` bullet). Kiro has `run: ["kiro-cli"]`, so an installed `kiro-cli` is `{ key: "kiro", name: "Kiro", icon: "icons/kiro.svg", tint: false, installed: true }`. The icon is Herdr's `defaults/icons/kiro.svg`. This layout does not ship it. `icon()` already draws `tint: false` pictures as-is (`usage-view.js` lines 44 and 68).

The program key to match is `kiro`, not `kiro-cli`. `match` also recognizes the `kiro-cli` process. Herdr's agent detector uses the same pair (`herdr` `src/detect/mod.rs`: label `"kiro"`, executable `"kiro-cli"`).

Until `kiro` is in `PROVIDER_KEYS`, an installed Kiro is ignored, the same way Gemini is ignored today.

## 1. Where the usage data comes from

Official Kiro docs do not publish a `kiro-cli usage` subcommand. The command reference lists `crew`, `agent`, `chat`, `acp`, `update`, `integrations`, `login`, `logout`, `whoami`, `settings`, `diagnostic`, `issue`, `version` and `mcp` ([CLI commands](https://kiro.dev/docs/reference/cli-commands/)). There is no usage command in that list. Two open Kiro requests ask for one and say it does not exist yet: [kirodotdev/Kiro#7752](https://github.com/kirodotdev/Kiro/issues/7752), [kirodotdev/Kiro#8477](https://github.com/kirodotdev/Kiro/issues/8477). The JSON in #8477 is a proposed wish, not output. Do not parse it.

What official docs do describe:

| Source | What it is | Stable enough for the card? |
|---|---|---|
| Interactive `/usage` | Slash command inside `kiro-cli chat`. "Show billing and credits information." In CLI 3.1.0+ it also shows credits the current session used. In a non-interactive run it "prints the full usage breakdown instead of a one-line summary." ([Slash commands](https://kiro.dev/docs/reference/slash-commands/), [Terminal UI](https://kiro.dev/docs/cli/terminal-ui/)) | The public account view. Text, not a schema. V3 does not honor it as a slash command; see below. |
| `kiro-cli chat --no-interactive` plus a positional `INPUT` | Documented separately. `--no-interactive` "Print[s] first response to STDOUT without interactive mode." `INPUT` is "The first question to ask." ([CLI commands](https://kiro.dev/docs/reference/cli-commands/)) | Composing these into `kiro-cli chat --no-interactive "/usage"` is what other tools do. It is not a documented usage API, and it starts a chat. |
| `kiro-cli whoami` | Prints the signed-in user, method and profile. Not logged in is an error that tells you to run `kiro-cli login`. ([CLI commands](https://kiro.dev/docs/reference/cli-commands/)) | A sign-in probe only. It does not return credits, a cap, or a reset. |
| `~/.kiro/` session store | Official page: sessions are a SQLite database in `~/.kiro/`, per directory, saved after every turn ([Session management](https://kiro.dev/docs/cli/chat/session-management/)). `KIRO_HOME` replaces `~/.kiro` for global config, sign-ins, sessions and agent state ([Configuration](https://kiro.dev/docs/configuration/)). | The documented store. Official pages do not say it holds the monthly allowance. |
| V3 session files | Third-party engine notes, not official docs: `~/.kiro/sessions/<bucket>/sess_<uuid>/messages.jsonl` with `usage_summary.promptTurnSummaries[].usage` in credits, and `session_metadata` `contextUsage.usagePercentage`. V2 files sit in `~/.kiro/sessions/cli/<uuid>.jsonl`. ([RimZ kiro reference](https://github.com/rimio-ai/rimz/blob/main/docs/externals/agent-adapter/kiro-reference.md), sections "Session store" and "Usage, credits, and context") | Local and read-only. Per turn, not the plan cap or the cycle reset. |
| `~/.aws/sso` | Not mentioned by the Kiro usage or auth pages read for this spec. Identity Center is one login method ([Authentication](https://kiro.dev/docs/getting-started/authentication/)). | Do not read it. |
| `GetUsageLimits` | Not a Kiro-documented API. CodexBar describes `POST https://codewhisperer.us-east-1.amazonaws.com/` and `POST https://q.eu-central-1.amazonaws.com/` with header `X-Amz-Target: AmazonCodeWhispererService.GetUsageLimits`. The token comes from the CLI's sqlite. ([CodexBar `docs/kiro.md`](https://github.com/steipete/CodexBar/blob/main/docs/kiro.md)) | Structured, private, credentialed, networked. Needs the owner's approval. Out of scope until then. |

**Most stable source that is actually local and read-only:** the session files under `${KIRO_HOME:-~/.kiro}/sessions`. They can be opened the way Codex sessions are opened (find, grep, tail, no writes). They do not contain the plan cap or the reset date, so they cannot fill the bar by themselves.

**Most stable source of the numbers the card needs** (credits used, credits total, cycle reset, plan name) is the CLI's own `/usage` report, and CodexBar's preferred alternative is the private `GetUsageLimits` call. Neither is a local read. `/usage` text has already changed shape across CLI versions, and under the V3 harness the non-interactive form does not run the slash command at all ([CodexBar#4853](https://github.com/steipete/CodexBar/issues/4853)).

Recommendation: keep the shipped reader local and read-only. On the owner's Mac, look for an already-written account snapshot under `~/.kiro` (and `KIRO_HOME` if set) before accepting a chat probe or an API. If that snapshot is not there, ship Kiro as an installed provider whose reading is an error note, and do not spawn `kiro-cli chat`.

## 2. What the data gives

Official docs, in prose, not as a sample:

- `/usage` shows billing, current usage, remaining credits, and (CLI 3.1.0+) credits used in the current session. A non-interactive run prints a full breakdown rather than one line ([Slash commands](https://kiro.dev/docs/reference/slash-commands/)).
- A credit is a unit of work, metered to 0.01. Free is 50 credits per month. Paid tiers are Pro, Pro+, Pro Max, Power and Teams. Plan credits reset at the start of the next month. Add-on credits are combined with plan credits in the usage display and are spent only after plan credits ([FAQ](https://kiro.dev/faq/), [Add-on credits](https://kiro.dev/docs/billing/add-on-credits/)).
- `whoami` shows the login method and profile. The documented plain-text examples are "Logged in with Builder ID" plus an email, and "Logged in with IAM Identity Center" plus a profile name and an ARN ([CLI commands](https://kiro.dev/docs/reference/cli-commands/)). The docs do not show `whoami --format json`. Do not invent that JSON.
- Session `usage_summary` rows, per third-party engine notes, carry a credit amount for one turn (`unit: "credit"`, `usage` a number such as `0.1` on a 2.12.1 capture). They do not carry the monthly cap. ([RimZ](https://github.com/rimio-ai/rimz/blob/main/docs/externals/agent-adapter/kiro-reference.md))

**There is no official sample of `/usage` output.** Do not treat any block below as Kiro's format until the owner pastes a real one.

Observed third-party output, not from kiro.dev. CodexBar issue #4853 records this V2 command on a signed-in CLI:

```text
$ kiro-cli chat --no-interactive "/usage" --v2
Estimated Usage | resets on 2026-11-01 | KIRO PRO+
Credits (1470.38 of 2000 covered in plan), 73.5%
Overages: Disabled
Your plan is managed by your organization's administrator.
```

The same issue records that the same command without `--v2`, on the V3 harness, returns model prose ("I can't show usage or quota data…") and completes a real model turn. That prose is a failure, not a reading.

CodexBar's own `docs/kiro.md` also prints a box-drawing "Output format (example)" (`KIRO FREE`, `Monthly credits`, `100% (resets on 01/01)`, `(0.00 of 50 covered in plan)`, a bonus line). The page labels it an example. It is a different shape from the #4853 capture. A parser cannot accept one and assume the other.

The JSON in Kiro issue #8477 (`plan`, `period`, `limits.daily`, `limits.monthly`) is the requester's sketch. Kiro has not shipped it.

**Assumed card shape, to confirm on the owner's Mac.** If a confirmed source has used `1470.38`, total `2000`, reset date `2026-11-01`, plan `KIRO PRO+`, the limits value would be:

```json
{
  "kind": "limits",
  "windows": [
    { "label": "30 d", "percent": 73.519, "resetsAt": 1761955200000 }
  ],
  "plan": "KIRO PRO+",
  "at": null
}
```

`73.519` is `1470.38 / 2000 * 100`. `windowView` then rounds it to `74%` (`usage.js` lines 28–32 and 63–67). The captured line says `73.5%`, so the card will not match the CLI's one decimal. `1761955200000` is `2026-11-01T00:00:00Z`, which the capture does not state (no time, no zone). Both the rounding and the midnight-UTC choice stay open until the owner confirms.

A second window for bonus or overage credits is not part of this assumption. The official add-on page says the usage display combines add-on credits with plan credits, so one percent may already be a mix. CodexBar keeps bonus off the plan gauge. Do not add the second window unless the owner's sample has a separate line.

## 3. Network and credentials

The recommended reader uses none. It reads files under `${KIRO_HOME:-~/.kiro}` as the same user, or it does not read anything and returns an error code. It does not send those files anywhere.

`kiro-cli whoami` is the documented sign-in check. The docs do not say it stays offline, and they do not promise it will not offer a browser when logged out. Confirm that on the Mac before the mod runs it. `kiro-cli login` opens a browser or a device-code flow ([CLI commands](https://kiro.dev/docs/reference/cli-commands/)). The mod must not run it.

`kiro-cli chat`, with or without `--no-interactive` and `--v2`, is the CLI using the existing login. The mod would not put a token in argv, but the child process would use the network and the CLI's credentials, and under V3 it spends plan credits on a model turn (CodexBar#4853). CodexBar#4746 also reports that the probe writes empty session pairs. That breaks this mod's current rule: the Claude token is read and sent inside one pipeline, and nothing is written (`usage.js` lines 104–114; README lines 302–313).

**API that needs the owner's approval before anyone implements it.** CodexBar's Kiro provider prefers:

- `POST https://codewhisperer.us-east-1.amazonaws.com/`
- `POST https://q.eu-central-1.amazonaws.com/` (Frankfurt profiles)
- Header `X-Amz-Target: AmazonCodeWhispererService.GetUsageLimits`
- Body `{"profileArn": ...}`, or `{}` when a Builder ID login has no profile row
- Token from `~/Library/Application Support/kiro-cli/data.sqlite3`, table `auth_kv`, key `kirocli:odic:token`, field `access_token`. The profile ARN is `state` / `api.codewhisperer.profile`.

That sqlite path is CodexBar's macOS note, not a Kiro doc. This spec does not adopt the call. Implementing it means the mod reads a credential and reaches a new host, which the README disclosure does not allow today (the only host is `https://api.anthropic.com/api/oauth/usage`).

## 4. Mapping onto `windows`, and whether Codex is the model

Yes for the plumbing. No for the file contents.

Codex is the right model for the code path:

- A constant read-only script (`CODEX_SCRIPT`, `usage.js` lines 139–144): `find`, `stat`, `sort`, `grep`, `tail`, redirections only to `/dev/null`. The tests reject writes (`tests/usage.test.js` lines 210–213).
- A pure parser that returns `{ kind: "limits", windows, plan, at }` or `null` (`parseCodexLine`, lines 119–134).
- `fetchProvider` turns "no lines" into `{ error: "none" }` and a thrown or nonzero exec into `{ error: "unavailable" }` (lines 181–183 and 189–190).
- The card shows the plan and an "updated … ago" age because the log line can be old (`usage-view.js` lines 35–36 and 46).
- `zeroPast` is true only for Codex, so a window whose `resetsAt` is already past draws 0% (`usage-status.js` line 36).

Claude is the model for a reading that was just fetched: `plan: null`, `at: null`, `zeroPast` false. The percent stands, and a past reset still says `reset` via `formatReset`.

Kiro's account file, if the owner finds one, should follow Codex: parse into the same object, set `plan` from the plan name, set `at` from the file's mtime or an embedded timestamp, and set `zeroPast` only if that timestamp can be older than the reset. A live probe that is current at fetch time should follow Claude (`zeroPast` false).

The window itself:

| Field | Kiro value |
|---|---|
| `label` | `"30 d"`. `formatWindow(43200)` already returns `"30 d"` (`usage.js` lines 46–49). The row's label column is 28 px (`usage-view.js` line 18); `"5 h"` and `"7 d"` fit, `"month"` may not. |
| `percent` | `used / total * 100` when both are finite and `total > 0`. `windowView` clamps and rounds. Missing either number is `{ error: "unavailable" }`, not 0%. |
| `resetsAt` | The cycle instant in milliseconds, or `null` if the source has no date. `null` prints no reset text (`formatReset`, lines 35–36). |
| `plan` | The plan string, or `null`. |
| `at` | The file time for a file reader, so the card can show `formatAge`. `null` for a reading with no timestamp. |

`reading()` already selects the first window when none is labeled `"5 h"` (`usage-status.js` line 35). A single `"30 d"` window becomes the status-bar percent, the 40×4 bar and the label, and it turns `blocked` at 90% (`HIGH_PERCENT`, line 6). No special case is required in `reading()` unless `zeroPast` should be true.

The plan line is special-cased to `p.key === "codex"` (`usage-view.js` line 46). That condition has to include `kiro`, or the plan is parsed and never drawn. The age line is special-cased the same way (line 35) and has to include `kiro` when `at` is set.

opencode is not the model. A credit allowance is not a cost.

## 5. macOS, not installed, not signed in

The layout is built and tested on macOS (README lines 327–328). The Codex script uses BSD `stat -f` and its real-filesystem test is skipped off Darwin (`tests/usage.test.js` line 253). A Kiro file script must do the same, or it will fail the moment it runs on the Mac. `KIRO_HOME` must be honored when it is an absolute path; Kiro ignores a relative path, `/`, `$HOME`, and a parent of `$HOME`, and uses `~/.kiro` ([Configuration](https://kiro.dev/docs/configuration/)).

Herdr's install check for `knownAgents()` is cached for about a minute and, on macOS, looks through the login shell's PATH (`defaults/AGENTS.md`, Programs). The mod already re-asks `knownAgents()` on every hover (`main.js` lines 43–44). No extra `which kiro-cli` is needed.

| State | What happens | Same as |
|---|---|---|
| `kiro` absent from `knownAgents()`, or `installed !== true` | `providersFrom` drops it. Nothing is spawned. The other providers are unchanged. | Gemini today (`usage.js` lines 19–23). |
| No supported CLI installed at all | The card is `EMPTY_NONE`. The sentence must mention Kiro, or it is wrong once Kiro is supported. The control still renders; it shows the word "Usage" when there is no primary (`usage-view.js` line 90). | `usage-view.js` lines 52–56. |
| `knownAgents()` rejects | The card is `EMPTY_FAILED` ("Cannot list the installed agents."). | `usage.js` line 17, `usage-view.js` line 54. |
| Installed, not signed in, or `~/.kiro` missing | `{ error: "signedOut" }` with a Kiro sentence, proposed: "Not signed in to Kiro." The section shows that note. The status number is the dash `–`. | Claude's `signedOut` (`usage.js` lines 10 and 95, `usage-status.js` line 32). |
| Installed, signed in, no usable snapshot | `{ error: "unavailable" }` ("Usage unavailable.") or, if the reader is session-file based and the directory is empty, a Kiro-specific "none" sentence. | Codex `none` (`usage.js` line 12, `parseCodexOutput` line 152). |
| Timeout (15 s) | `{ error: "timeout" }` ("Timed out."). A still-running process is not started again. | `createUsage` (`usage.js` lines 210–227). |
| Exec throws or exits nonzero | `{ error: "unavailable" }`. `fetchProvider` catches. | `usage.js` lines 175–190, test at `tests/usage.test.js` lines 304–309. |

One bad Kiro reading must not drop Claude, Codex or opencode. The card already isolates errors per section (`usage-view.js` lines 27–29 and 57–60). The fetch loop already lets a slow provider finish on its own (`tests/usage.test.js` lines 329–343).

Do not read the macOS Keychain for Kiro. Claude does (`/usr/bin/security`, `usage.js` line 110) because its token is stored there. Kiro's documented store is `~/.kiro`, and the third-party token path is the CLI sqlite, which this spec refuses.

## 6. Surviving an upstream update

Two upstreams get confused here.

**Herdr** (`github.com/herdrdev/herdr-app`) replaces its own layouts and mods on every start. The escape hatch is a clone, which Herdr never updates (`defaults/AGENTS.md`, "Changing things safely"):

```sh
herdr-app do layout.clone '{"name":"main","as":"my-layout"}'
herdr-app do mod.clone '{"name":"files","as":"my-files"}'
```

A clone records `cloned_from`, and a cloned layout keeps pointing at the original mod names until you retarget `content.mod`. Editing a shipped file in place gets moved to `<name>-edited` on the next start.

`herdsidian-status` is not a Herdr-shipped mod. It already is this repo's clone of `workspace-status` 0.1.10 (`mod.json` lines 3–5). Herdr does not push later `workspace-status` fixes into it (RECIPE.md lines 592–595). A Herdr upgrade does not wipe `~/.config/herdr-app/mods/herdsidian-status` when that folder came from this layout.

**This repo** (`github.com/anderssonq/herdsidian`) is the layout upstream. Re-copying `mods/` from a new clone of this repo does overwrite a patch that lived only in `~/.config/herdr-app`.

Recommendation: **land the reader in this repository**, on `mods/herdsidian-status`, and leave `layouts/herdsidian.json` pointing at `herdsidian-status`. People who install or update the layout then get Kiro usage from the same copy as the other three providers. A personal `mod.clone` of `herdsidian-status` plus a retargeted layout would survive a later re-copy only if the layout JSON were patched too, and that clone would miss every later Usage fix. Use a personal clone only as a scratch copy on the owner's Mac before this spec is approved:

```sh
herdr-app do mod.clone '{"name":"herdsidian-status","as":"herdsidian-status-kiro"}'
```

Then point a throwaway layout's status block at `herdsidian-status-kiro`. Do not do that in `layouts/herdsidian.json` of this repo.

A later manual resync of `herdsidian-status` with a newer Herdr `workspace-status` must re-apply `usage.js`, `usage-status.js` and `usage-view.js`. That is already true for Claude, Codex and opencode.

## 7. Tests

Harness today:

- `package.json`: `"test": "node --test tests/*.test.js"`, `"lint": "node scripts/lint.js"`. No extra dependencies.
- Usage logic is pure and imported from the mod (`tests/usage.test.js` lines 1–11). The view tests render `main.js` against `tests/support/mod-stubs.js`.
- `.test-lock` is a `sha256sum`-style list of hashes for the files in `tests/`. Nothing in `scripts/` or `tests/` reads it. `npm test` does not check it. Update it only if the owner says something outside this repo checks it; the command is `sha256sum tests/*.test.js`.
- `scripts/lint.js` syntax-checks every `.js`, rejects hex colors in `mods/**/*.js`, and checks that shared `lib/` copies match. A new string in `usage.js` does not need a `lib/` copy. `usage.js` is not one of the shared files.
- The Codex script's live test is `skip: process.platform !== "darwin"` (`tests/usage.test.js` line 253). Follow that for any real `stat -f` script.

Add or extend:

| File | What |
|---|---|
| `tests/usage.test.js` | `providersFrom` keeps an installed `kiro` after opencode and drops `installed: false`. Parser accepts the owner's confirmed fixture and returns the limits object. Parser rejects the V3 model-prose failure, empty output, a missing total, and a non-finite used count, all as `unavailable` or `null`. The script, if there is one, has no writes and no URLs. `fetchProvider("kiro")` on a rejecting exec is `unavailable` and does not throw. Extend the loop at lines 304–309 rather than only adding a fourth call. Cache tests that hover `["claude", "codex", "opencode"]` stay valid; add one hover that includes `kiro`. |
| `tests/usage-status.test.js` | `primaryKey(["claude", "codex", "opencode", "kiro"], "kiro")` is `kiro`. An uninstalled `kiro` does not become primary. `orderedProviders` puts `kiro` first only when it is the focused key, otherwise last. `reading("kiro", limits window "30 d")` uses that window, not a 5 h window. A non-ok entry is still `–`. |
| `tests/usage-view.test.js` | With Kiro installed, the card text includes `Kiro` after `opencode`, the plan string when `data.plan` is set, and the reset text. With no supported provider, the text is the updated `EMPTY_NONE`. An error entry shows the Kiro note and does not remove the Claude section. The status control shows `icons/kiro.svg` compact, and in full (percent, 40×4 bar, `30 d`) when `kiro` is focused. Before the first hover the number is `–` and `exec` is not called. |

Do not add a test that runs `kiro-cli`, opens `~/.kiro` in the real home, or contacts AWS. Fixtures are strings in the test file, the same way `CODEX_LINE` is (`tests/usage.test.js` line 120).

`npm test` and `npm run lint` are the checks that can run without Herdr.

## Acceptance criteria

1. `PROVIDER_KEYS` is `["claude", "codex", "opencode", "kiro"]`. Order elsewhere comes from that array.
2. An installed `knownAgents()` entry with `key: "kiro"` appears in the control. An entry with `installed: false` does not. No other program key starts appearing.
3. The focused pane's `program.key === "kiro"` makes Kiro the full primary and tags it "focused pane" only when that pane itself is Kiro (`main.js` lines 81–82 already does this).
4. A confirmed reading draws one window through `windowView`: integer percent, 40×4 bar in the status control, label `30 d`, reset text from `resetsAt`, plan beside the name. At 90% and above the percent and the fill use `blocked`.
5. Missing CLI, failed `knownAgents()`, not signed in, empty store, bad text, timeout, and a thrown exec all leave the card on screen. Kiro's section shows a note. Other providers still show. The status number is `–` whenever Kiro's state is not `ok`.
6. With Usage off in settings, nothing runs (`main.js` lines 40 and 58–59).
7. The reader does not write, does not log a token, and does not request a host other than the one already disclosed, unless the owner has approved the API in section 3 in a later change.
8. `EMPTY_NONE` names Kiro. README lines 302–313 and RECIPE.md lines 596–605 list whatever new program or path the reader actually uses, and no host that it does not use.
9. `npm test` and `npm run lint` pass. New parser fixtures are the owner's confirmed text, or they are marked as third-party captures and tested only for "does not throw, does not invent a percent".

## Implementation plan

Do this only after the owner answers the open questions and approves the source. No step runs `kiro-cli chat` or an AWS call.

0. **Backup, before the first edit.** From a clean worktree:

   ```sh
   mkdir -p "$HOME/herdsidian-backup"
   cp -a mods/herdsidian-status tests/usage.test.js tests/usage-status.test.js tests/usage-view.test.js \
     README.md RECIPE.md "$HOME/herdsidian-backup/kiro-usage-$(date +%Y%m%d)"
   ```

   The branch is the other copy. Do not edit `main`.

1. **`mods/herdsidian-status/usage.js`**
   - Append `"kiro"` to `PROVIDER_KEYS`.
   - Extend `EMPTY_NONE` so it names Kiro.
   - Add an error sentence for not signed in, parallel to `signedOut`.
   - Add `parseKiro` for the confirmed fixture only. Unknown text returns `{ error: "unavailable" }`.
   - Add the fetch branch in `fetchProvider`. Read-only file script, or no process at all until a file source is confirmed. No `kiro-cli chat`. No `curl`.
   - Update the file header comment (line 1–3) that says the mod runs only the Claude pipeline, the Codex script and `opencode`.

2. **`mods/herdsidian-status/usage-status.js`**
   - Pass `zeroPast` for `kiro` only if the approved source can be older than the reset. Otherwise leave line 36 as `key === "codex"`.
   - `reading()` needs no label special case when the only window is `30 d`.

3. **`mods/herdsidian-status/usage-view.js`**
   - Show `data.plan` for Codex and Kiro (line 46).
   - Show `formatAge` for Kiro when `at` is set (line 35).

4. **`mods/herdsidian-status/main.js`**
   - No logic change. Hover already follows `providersFrom`.

5. **`layouts/herdsidian.json`, `programs.json`, icons, `lib/`**
   - No change. The status block already names `herdsidian-status`. The program key and icon already come from Herdr.

6. **`README.md` and `RECIPE.md`**
   - Extend the Usage disclosure (README lines 302–313, RECIPE.md lines 128–142 and 596–605) with the new program or path, and with a statement that no new host is contacted. Keep the "token is never stored" rule.

7. **Tests**, as in section 7. Then `npm test` and `npm run lint`.

### Risks

- A chat probe under V3 spends credits and writes sessions. That is why it is not the default.
- `/usage` has at least two published shapes (one-line "Estimated Usage", box drawing) plus model prose that must not become 0%.
- Combined add-on credits can make `used/total` not equal the plan gauge the CLI prints.
- Integer rounding will not match a one-decimal CLI percent.
- A `30 d` label is a stand-in for a calendar month. February and 31-day months will not match a true cycle length; the reset timestamp is what `formatReset` uses.
- `KIRO_HOME` and owner-only permissions on `~/.kiro` (Kiro changelog notes since 2.27.0, via the session-management page) mean a script that assumes `$HOME/.kiro` can see an empty directory.
- Organization accounts, in the CodexBar notes, omit the overage section. Parsing must not treat a missing overage line as a failed plan gauge.
- Disclosure drift: the README also says "Not online. Nothing reaches the network." (lines 267–271) while the Usage section says the opposite for Anthropic. A Kiro host would widen that gap. The recommended reader does not.

### How to verify

On a machine that has this layout installed and Herdr running:

```sh
npm test
npm run lint
herdr-app check mods/herdsidian-status
```

`herdr-app check` loads the mod once and checks the first description. It does not lay the view out and it does not run the hover (`defaults/AGENTS.md`, "Changing things safely"). A passing check is not a Usage test.

Then switch to the layout, hover the status control, and:

```sh
herdr-app shot
```

`herdr-app shot` writes the last rendered frame (`herdr-shot.png` by default) and needs a running Herdr that has already drawn a frame. Inspect the PNG: Kiro's icon, the dash before hover, the note when signed out, and the other providers still present.

Also watch `herdr-app status` for a mod error after the hover.

### What a cloud VM cannot verify

- Anything that needs the owner's Mac, a signed-in `kiro-cli`, or the real `~/.kiro` tree.
- The real `/usage` text, `whoami` text when logged out, and whether `whoami` stays offline.
- Whether a local file already holds used, total, reset and plan.
- `herdr-app check` and `herdr-app shot`. This VM does not have the owner's Herdr window.
- The macOS Keychain prompt. The recommended reader must not cause one.
- That `knownAgents()` on that Mac returns `key: "kiro"` with `installed: true`. The program table says it should when `kiro-cli` is on the login-shell PATH. Confirm with a hover, not from here.

Parser tests with pasted fixtures can run in CI. They do not prove the fixture is what the owner's CLI prints.

## Open questions / to confirm on the owner's machine

1. Run `kiro-cli whoami` while signed in, and again while signed out. Paste the text. Does the signed-out run open a browser or only print an error?
2. Is `KIRO_HOME` set? If yes, to what absolute path?
3. Is there already a file under that home (not the session transcripts) that contains the monthly credits used, the monthly total, the reset date and the plan? If yes, paste one redacted sample. That file is the reader.
4. If no such file exists, paste one redacted `/usage` transcript from a session you already have open. Do not start a new `kiro-cli chat --no-interactive "/usage"` for this spec; under V3 that is a billed model turn.
5. In that transcript, are add-on or overage credits on their own line, or already folded into the plan total?
6. Does the reset include a time and a zone, or only a date?
7. With Kiro focused, does the pane's `program.key` come back as `kiro`? (Expected from Herdr's `programs.json` line 17, not yet seen in this app.)
8. Should a personal `herdsidian-status-kiro` clone be used to try the reader before it merges, or is landing it in this repo enough?

## Sources

- This repo: `mods/herdsidian-status/usage.js`, `usage-status.js`, `usage-view.js`, `main.js`, `mod.json`; `layouts/herdsidian.json`; `tests/usage.test.js`, `tests/usage-status.test.js`, `tests/usage-view.test.js`; `package.json`; `.test-lock`; `README.md`; `RECIPE.md`; `scripts/lint.js`.
- Herdr program table: [defaults/programs.json](https://github.com/herdrdev/herdr-app/blob/master/defaults/programs.json) line 17, blob `a1b17af918880f52589528e9ff68298fbb0859d1`. Icon: `defaults/icons/kiro.svg` in the same repo.
- Herdr agent guide: [defaults/AGENTS.md](https://github.com/herdrdev/herdr-app/blob/master/defaults/AGENTS.md) ("Changing things safely", "Seeing the window", "Programs: `programs.json`").
- Kiro: [Slash commands](https://kiro.dev/docs/reference/slash-commands/), [CLI commands](https://kiro.dev/docs/reference/cli-commands/), [Terminal UI](https://kiro.dev/docs/cli/terminal-ui/), [Session management](https://kiro.dev/docs/cli/chat/session-management/), [Configuration](https://kiro.dev/docs/configuration/), [Authentication](https://kiro.dev/docs/getting-started/authentication/), [FAQ](https://kiro.dev/faq/), [Add-on credits](https://kiro.dev/docs/billing/add-on-credits/).
- Third-party, labeled as such above: [CodexBar `docs/kiro.md`](https://github.com/steipete/CodexBar/blob/main/docs/kiro.md), [CodexBar#4853](https://github.com/steipete/CodexBar/issues/4853), [CodexBar#4746](https://github.com/steipete/CodexBar/issues/4746), [RimZ kiro reference](https://github.com/rimio-ai/rimz/blob/main/docs/externals/agent-adapter/kiro-reference.md), [Kiro#7752](https://github.com/kirodotdev/Kiro/issues/7752), [Kiro#8477](https://github.com/kirodotdev/Kiro/issues/8477).

No Kiro or AWS API was called for this spec. No `kiro-cli` was run.

Implementation waits for the owner's approval.
