#!/bin/zsh
# Opens a second Herdr window with the Herdsidian layout, a demo vault and demo agents,
# isolated from your own Herdr: its own HOME, app home, state folder and herdr-core
# session (checked by the core's environment before any agent starts), so it doesn't
# touch your spaces, terminals, settings, vault or context links. The README images are taken from it.
# It also seeds fake Codex, opencode, Kiro and Grok usage and context data (and Claude's context ring) inside
# its own HOME, so Usage, the context rings and the agent toast cards show; Claude usage stays "–".
#
#   scripts/demo.sh            start the demo (DEMO_SIZE=1440x900 sets the window size)
#   scripts/demo.sh stop       quit it and stop its core (--clean also deletes its folder)
#   scripts/demo.sh env        print the variables that point herdr-app/hc at the demo
#
# DEMO_DIR picks where it lives (default: $TMPDIR/hsd). Its last part must start with
# "hsd". Keep it short: Herdr and herdr-core talk over unix sockets inside it.
set -euo pipefail
zmodload zsh/datetime

repo=${0:A:h:h}
dir=${DEMO_DIR:-${TMPDIR:-/tmp}/hsd}
dir=${dir%/}
dir=${dir//\/\//\/}
if [[ -z $dir || $dir == / || ${dir:t} != hsd* || $dir == *[[:space:]]* ]]; then
  print -u2 "DEMO_DIR must be a folder without spaces whose name starts with hsd (got: '$dir')."
  exit 2
fi
mkdir -p "${dir:h}"
dir=${dir:h:A}/${dir:t}  # the real path, so HOME matches the folders Herdr shows
marker=$dir/.hsd-demo
home=$dir/home
demo_env=(
  HOME="$home" PATH="$dir/bin:$PATH" HERDR_APP_HOME="$dir/app" XDG_CONFIG_HOME="$dir/cfg" XDG_STATE_HOME="$dir/st"
  XDG_RUNTIME_DIR="$dir/rt" HC_SESSION=hsd
  # No update downloads or telemetry from a throwaway window.
  HERDR_RELEASES_URL=http://127.0.0.1:9 HERDR_TELEMETRY=0 DO_NOT_TRACK=1
)
# A Herdr terminal exports the variables that point hc at your own core: drop them.
in_demo() { env -u HC_TERMINAL_SOCKET -u HC_TERMINAL_ID -u HC_RUNTIME -u HC_SCOPE "${demo_env[@]}" "$@"; }
answers() { in_demo herdr-app status 2>/dev/null | grep -q '"layout"'; }
# Is this pid a process of this demo? (its environment names the demo's app home)
is_demo_pid() {
  [[ -n ${1:-} ]] || return 1
  local env_words; env_words=$(ps eww -p "$1" 2>/dev/null || true)
  (( ${${(s: :)env_words}[(Ie)HERDR_APP_HOME=$dir/app]} )) && return 0
  # herdr-core 0.1.18 starts through launchd, so its environment is not ours: it is the
  # demo's when it holds files (its socket, log and lock) inside the demo folder.
  lsof -p "$1" -Fn 2>/dev/null | grep -qF "n$dir/"
}
# Ends a demo process and waits until it is gone. Prints yes or no.
end_pid() {
  local pid=${1:-}
  is_demo_pid "$pid" || { print no; return; }
  kill "$pid" 2>/dev/null || true
  for _ in {1..20}; do kill -0 "$pid" 2>/dev/null || { print yes; return; }; sleep 0.25; done
  print no
}

# Quits the window and ends the core recorded at start. Never asks hc for its status,
# since that starts a core.
stop_demo() {
  local quit=no core=no
  if answers; then in_demo herdr-app do app.quit >/dev/null 2>&1 && quit=yes; fi
  [[ -f $dir/app.pid ]] && [[ $(end_pid "$(<$dir/app.pid)") == yes ]] && quit=yes
  [[ -f $dir/core.pid ]] && core=$(end_pid "$(<$dir/core.pid)")
  rm -f "$dir/app.pid" "$dir/core.pid"
  local left; left=$(end_leftovers)
  print "Demo window quit: $quit. Demo core stopped: $core.${left:+ Ended $left leftover processes.}"
}

# Stand-in agents and core helpers can outlive the window and its core. Ends only the
# processes running this demo's agent.sh or holding a socket in its rt folder, then prints
# how many. The folder goes to awk through the environment, so awk never matches itself.
end_leftovers() {
  local pids=() p
  for p in ${(f)"$(ps -axo pid=,command= | HSD_DIR="$dir/" awk 'index($0, ENVIRON["HSD_DIR"] "agent.sh") || index($0, "--socket " ENVIRON["HSD_DIR"] "rt/") { print $1 }')"}; do
    [[ -n $p && $p != $$ ]] && pids+=($p)
  done
  (( ${#pids} )) || return 0
  kill ${pids[@]} 2>/dev/null || true
  sleep 0.5
  kill -9 ${pids[@]} 2>/dev/null || true
  print ${#pids}
}

case ${1:-start} in
  stop)
    stop_demo
    if [[ ${2:-} == --clean && -f $marker ]]; then rm -rf "$dir" && print "Deleted $dir."; fi
    exit 0 ;;
  env)
    for kv in "${demo_env[@]}"; do print -r -- "export ${(q)kv}"; done
    print -r -- "unset HC_TERMINAL_SOCKET HC_TERMINAL_ID HC_RUNTIME HC_SCOPE"
    exit 0 ;;
  start)
    if [[ ${HERDR_APP_HOME:-} == "$dir/app" ]]; then
      print -u2 "This shell already points at the demo (HERDR_APP_HOME). Start it from a shell without 'eval \"\$(scripts/demo.sh env)\"'."
      exit 2
    fi ;;
  *) print -u2 "usage: scripts/demo.sh [start|stop [--clean]|env]"; exit 2 ;;
esac

if answers; then
  print -u2 "The demo is already running in $dir. Use: scripts/demo.sh stop"
  exit 1
fi

# Every start is fresh: no spaces or links left from an earlier run. A core left from
# that run is ended first, and only a folder this script made (it has the marker) is wiped.
if [[ -e $dir ]]; then
  if [[ ! -f $marker ]]; then
    print -u2 "$dir exists and is not a demo folder (no .hsd-demo); not touching it."
    exit 2
  fi
  stop_demo >/dev/null
  rm -rf "$dir"
fi
mkdir -p "$dir" && : > "$marker"
vault=$home/Vault
work=$home/code

# The layout, themes, mods and keys, installed into the demo's home.
mkdir -p "$dir"/{app/layouts,app/themes,app/mods,app/data/herdsidian,cfg,rt} "$dir/st/herdsidian" "$work"
chmod 700 "$dir/rt"
cp "$repo"/layouts/herdsidian.{json,svg} "$dir/app/layouts/"
cp "$repo"/themes/hs_*.json "$dir/app/themes/"
for m in "$repo"/mods/*(/); do rm -rf "$dir/app/mods/${m:t}" && cp -R "$m" "$dir/app/mods/${m:t}"; done
cp "$repo/keys.json" "$dir/app/keys.json"
print '{"layout":"herdsidian","frame.welcomed":"finished"}' > "$dir/app/shared.json"
print "{\"last_run\":\"$(herdr-app --version | awk '{print $NF}')\",\"presented\":[]}" > "$dir/app/update-notes.json"
size=${DEMO_SIZE:-1440x900}
print "{\"state\":\"windowed\",\"bounds\":[80.0,80.0,${size%x*}.0,${size#*x}.0]}" > "$dir/app/window.json"
# The Notes sidebar opens on the demo vault, with a few recent notes.
cat > "$dir/app/data/herdsidian/store.json" <<EOF
{
  "vault": "$vault",
  "width": "420",
  "graph.hops": "1",
  "recent:$vault": "[\\"Projects/Acme API.md\\",\\"Knowledge/Rate limiting.md\\",\\"Daily/2026-10-31-agents.md\\"]"
}
EOF

# Two project folders for the agents' spaces.
for p in acme-api acme-web; do
  mkdir -p "$work/$p"
  [[ -d $work/$p/.git ]] || git -C "$work/$p" init -q
done

# acme-api gets a few files and uncommitted edits (written by this script), so Files and
# Changes have something to show. A demo-only identity; no hooks, no signing.
api=$work/acme-api
dgit() { git -C "$api" -c user.name=demo -c user.email=demo@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null "$@"; }
if [[ -z $(dgit rev-parse --verify -q HEAD 2>/dev/null) ]]; then
  mkdir -p "$api/src/routes" "$api/src/middleware" "$api/test"
  print -r -- '{ "name": "acme-api", "private": true, "type": "module", "scripts": { "test": "node --test" } }' > "$api/package.json"
  print -r -- '# acme-api

Orders and billing API for Acme.' > "$api/README.md"
  print -r -- 'import { orders } from "./orders.ts";

export const routes = [
  { method: "GET", path: "/orders", handler: orders.list },
  { method: "POST", path: "/orders", handler: orders.create },
];' > "$api/src/routes/index.ts"
  print -r -- 'export const orders = {
  list: async (req) => req.db.query("select * from orders where customer_id = $1", [req.user.id]),
  create: async (req) => req.db.insert("orders", req.body),
};' > "$api/src/routes/orders.ts"
  dgit add -A && dgit commit -qm "Orders API"
  print -r -- 'import { orders } from "./orders.ts";
import { rateLimit } from "../middleware/rate-limit.ts";

const limited = rateLimit({ perMinute: 100 });

export const routes = [
  { method: "GET", path: "/orders", handler: limited(orders.list) },
  { method: "POST", path: "/orders", handler: limited(orders.create) },
];' > "$api/src/routes/index.ts"
  print -r -- '// Token bucket per API key: 100 requests a minute, then 429 with Retry-After.
const buckets = new Map();

export function rateLimit({ perMinute }) {
  const refill = perMinute / 60_000;
  return (handler) => async (req, res) => {
    const key = req.headers["x-api-key"] ?? "anonymous";
    const now = Date.now();
    const b = buckets.get(key) ?? { tokens: perMinute, at: now };
    b.tokens = Math.min(perMinute, b.tokens + (now - b.at) * refill);
    b.at = now;
    if (b.tokens < 1) {
      res.setHeader("Retry-After", Math.ceil((1 - b.tokens) / refill / 1000));
      return res.status(429).json({ error: "rate_limited" });
    }
    b.tokens -= 1;
    buckets.set(key, b);
    return handler(req, res);
  };
}' > "$api/src/middleware/rate-limit.ts"
  print -r -- 'import { test } from "node:test";
import assert from "node:assert/strict";
import { rateLimit } from "../src/middleware/rate-limit.ts";

test("the 101st request in a minute gets a 429", async () => {
  const ok = rateLimit({ perMinute: 100 })(async () => 200);
  assert.ok(ok);
});' > "$api/test/rate-limit.test.ts"
fi

# Context links for acme-api, in the demo's own state folder. The space id is not live,
# so Herdsidian adopts the entry by folder and vault.
cat > "$dir/st/herdsidian/context.json" <<EOF
{
  "version": 1,
  "spaces": [
    {
      "space": "demo",
      "name": "acme-api",
      "folder": "$work/acme-api",
      "vault": "$vault",
      "notes": ["Knowledge/Rate limiting.md", "Standards/Testing.md"],
      "excluded": [],
      "agents": {}
    }
  ]
}
EOF

# A demo vault laid out like an agent setup: agent briefs, standards, projects,
# knowledge and daily notes, all linked with [[wikilinks]].
rm -rf "$vault" && mkdir -p "$vault"/{Agents,Standards,Projects,Knowledge,Daily}
note() { print -r -- "$2" > "$vault/$1"; }

note Home.md '# Home

The map of this vault. Agents read it first.

- [[Orchestrator]] plans the work and hands it out.
- [[Implementer]] and [[Reviewer]] do it.
- Rules: [[Code Style]], [[Git Workflow]], [[Testing]].
- Projects: [[Acme API]], [[Acme Web]].
- Today: [[2026-10-31]], and the agents log [[2026-10-31-agents]].'

note Agents/Orchestrator.md '---
tags: [agent]
model: opus
---
# Orchestrator

Plans a change, splits it into tasks and checks every result.

## Before work
1. Read the project note (for example [[Acme API]]).
2. Read [[Code Style]] and [[Testing]].
3. Read today'"'"'s [[2026-10-31-agents]] log.

## Hands work to
- [[Implementer]] for clear tasks.
- [[Reviewer]] for every non-trivial change.

## After work
Add a line to the project'"'"'s **Log** and a block to [[2026-10-31-agents]].'

note Agents/Implementer.md '---
tags: [agent]
model: sonnet
---
# Implementer

Writes the change the [[Orchestrator]] specified. Follows [[Code Style]],
runs the checks in [[Testing]], never commits. See [[Git Workflow]].'

note Agents/Reviewer.md '---
tags: [agent]
model: opus
---
# Reviewer

Reviews a diff for correctness, security and [[Code Style]].
Reports findings with file:line and a failure scenario.'

note "Standards/Code Style.md" '# Code Style

- Small functions, one job each.
- Names say what, comments say why.
- Errors are values at the edge: see [[Rate limiting]] for the API.

Used by [[Implementer]] and [[Reviewer]].'

note "Standards/Git Workflow.md" '# Git Workflow

- One branch per task, conventional commits.
- A human approves every commit and PR.

See [[Implementer]].'

note Standards/Testing.md '# Testing

- A failing test is a finding, never something to weaken.
- Unit tests next to the code, one integration test per endpoint.

Checks for [[Acme API]]: `npm test`, `npm run lint`.'

note "Projects/Acme API.md" '---
herdsidian: ~/code/acme-api
tags: [project]
---
# Acme API

The public REST API. Node, Postgres.

## Context for agents
- Rules: [[Code Style]], [[Testing]], [[Git Workflow]].
- Known traps: [[Postgres indexes]], [[Rate limiting]].
- Agents: [[Orchestrator]] plans, [[Implementer]] builds.

## Log
- 2026-10-31: rate limit per API key, behind a flag.
- 2026-10-30: slow /orders query fixed with a partial index.'

note "Projects/Acme Web.md" '---
herdsidian: ~/code/acme-web
tags: [project]
---
# Acme Web

The customer dashboard. Talks to [[Acme API]].

## Context for agents
- Rules: [[Code Style]], [[Testing]].'

note "Knowledge/Postgres indexes.md" '# Postgres indexes

A partial index on `orders (customer_id) WHERE status = '"'"'open'"'"'` took
/orders from 900 ms to 12 ms. Found while working on [[Acme API]].'

note "Knowledge/Rate limiting.md" '# Rate limiting

Token bucket per API key, 100 requests a minute, 429 with `Retry-After`.
Decided for [[Acme API]]. Style notes in [[Code Style]].'

note Daily/2026-10-31.md '# 2026-10-31

- Ship the rate limit for [[Acme API]].
- Idea: show quota left in [[Acme Web]].'

note Daily/2026-10-31-agents.md '# Agents, 2026-10-31

## Orchestrator
- Task: rate limit per API key on [[Acme API]].
- Used: [[Rate limiting]], [[Testing]].
- Result: behind a flag. [[Reviewer]] found one missing test.'

# Stand-in agents: each reports a status to Herdr (OSC 7501), prints a short scripted
# session and shows a prompt, so a Send to agent paste is visible. It ends with its pane.
# usage: agent.sh <state> <app> <title> <transcript file> [<next state> <delay s>]
# With the last two arguments it switches to <next state> after <delay s> seconds.
agent=$dir/agent.sh
cat > "$agent" <<'EOF'
#!/bin/zsh
printf '\e]2;%s\a' "$3"
[[ -f ${4:-} ]] && cat "$4"
report() {
  local state=$1 start=$SECONDS
  while kill -0 $$ 2>/dev/null; do
    [[ -n ${4:-} ]] && (( SECONDS - start >= ${5:-0} )) && state=$4
    printf '\e]7501;state=%s:app=%s\a' "$state" "$2"; sleep 5
  done
}
report "$1" "$2" "$3" "${5:-}" "${6:-}" &
trap 'kill $! 2>/dev/null' EXIT
trap 'exit 0' HUP TERM  # a closed pane or demo.sh stop ends it, not just its reporter
while true; do print -n '\n> '; read -r line || exit 0; done
EOF
chmod +x "$agent"
mkdir -p "$dir/talk"
cat > "$dir/talk/api.txt" <<'EOF'
> Add a rate limit per API key to acme-api.

● Reading the context notes: Acme API, Rate limiting, Testing
● Plan: token bucket per key, 100 requests a minute, 429 with Retry-After
● Edited src/middleware/rate-limit.ts (+48)
● Edited src/routes/index.ts (+3)
● Running npm test … 42 passed
● Writing the result to Daily/2026-10-31-agents.md
EOF
cat > "$dir/talk/web.txt" <<'EOF'
> Show the quota left on the dashboard.

● Waiting for the API's Retry-After header (see Acme API).
EOF
cat > "$dir/talk/review.txt" <<'EOF'
> Review the migration for the orders index.

● The partial index needs CONCURRENTLY on production. Run it now? (y/n)
EOF
cat > "$dir/talk/grok.txt" <<'EOF'
> Add usage charts to the dashboard.

● Reading the Acme Web note and the charts folder
● Edited src/components/UsageChart.tsx (+64)
● Running npm run lint … clean
EOF
cat > "$dir/talk/kiro.txt" <<'EOF'
> Explain the orders index migration.

● The migration adds a partial index on orders (customer_id) WHERE status = 'open'.
● It speeds up /orders and needs CONCURRENTLY on production.
EOF

# Fake agent CLIs on PATH, so Herdr lists them as installed (Usage needs that). The opencode
# stub also prints the three rows Usage reads from `opencode stats` (it shadows a real one).
mkdir -p "$dir/bin"
for c in claude codex kiro-cli grok; do print '#!/bin/sh\nexit 0' > "$dir/bin/$c"; chmod +x "$dir/bin/$c"; done
print '#!/bin/sh\n[ "$1" = stats ] && printf "Total Cost  \\$1.87\\nInput  612.4K\\nOutput  48.1K\\n"\nexit 0' > "$dir/bin/opencode"
chmod +x "$dir/bin/opencode"
# Herdr starts agents through the user's shell: keep the stubs first there too.
mkdir -p "$home"
print -r -- "export PATH=\"$dir/bin:\$PATH\"" > "$home/.zshenv"

# Fake usage and context data, written where each agent CLI keeps its files, inside the
# demo's own HOME and state folder. Times are computed now, so it works in any month.
now=$EPOCHSECONDS
now_iso=$(date -u -r "$now" +%Y-%m-%dT%H:%M:%SZ)
# Codex: usage windows and the context ring, one session file per folder.
codex_dir=$home/.codex/sessions/$(date +%Y/%m/%d)
mkdir -p "$codex_dir"
for p in acme-web acme-api; do
  f=$codex_dir/rollout-demo-$p.jsonl
  print -r -- "{\"type\":\"session_meta\",\"payload\":{\"cwd\":\"$work/$p\"}}" > "$f"
  print -r -- "{\"timestamp\":\"$now_iso\",\"payload\":{\"type\":\"token_count\",\"info\":{\"model_context_window\":258400,\"last_token_usage\":{\"total_tokens\":98000}},\"rate_limits\":{\"plan_type\":\"pro\",\"primary\":{\"used_percent\":34,\"window_minutes\":300,\"resets_at\":$((now + 10800))},\"secondary\":{\"used_percent\":12,\"window_minutes\":10080,\"resets_at\":$((now + 345600))}}}}" >> "$f"
done
# Kiro: month credits (messages.jsonl) and the context ring (older session JSON).
kiro_sess=$home/.kiro/sessions/_global/sess_demo
mkdir -p "$kiro_sess" "$home/.kiro/sessions/cli"
for c in 1.25 3.4 1.75; do
  print -r -- "{\"timestamp\":\"$now_iso\",\"payload\":{\"type\":\"usage_summary\",\"promptTurnSummaries\":[{\"unit\":\"credit\",\"usage\":$c}]}}" >> "$kiro_sess/messages.jsonl"
done
print -r -- "{\"session_id\":\"demo\",\"cwd\":\"$work/acme-api\",\"updated_at\":\"$now_iso\",\"session_state\":{\"rts_model_state\":{\"context_usage_percentage\":42,\"model_info\":{\"context_window_tokens\":200000}}}}" > "$home/.kiro/sessions/cli/demo.json"
# Grok: month cost and the context ring, as the status line hook writes them.
mkdir -p "$dir/st/herdsidian/grok" && chmod 700 "$dir/st/herdsidian/grok"
print -r -- "{\"v\":1,\"session_id\":\"g1\",\"cwd\":\"$work/acme-web\",\"model\":\"grok-4.5\",\"updated_at\":$((now * 1000)),\"cost_usd\":3.42,\"context_window_size\":256000,\"context_tokens\":31000,\"used_percentage\":12,\"session_input_tokens\":420000,\"session_output_tokens\":52000}" > "$dir/st/herdsidian/grok/g1.json"
chmod 600 "$dir/st/herdsidian/grok/g1.json"
# Claude: only the context ring (its usage needs a login, so it stays "–").
claude_dir=$home/.claude/projects/${work//[^A-Za-z0-9]/-}-acme-api
mkdir -p "$claude_dir"
print -r -- '{"type":"assistant","entrypoint":"cli","requestedModel":"claude-opus-5-5","message":{"model":"claude-opus-5-5","usage":{"input_tokens":2000,"cache_read_input_tokens":60000,"cache_creation_input_tokens":8000,"output_tokens":300}}}' > "$claude_dir/demo.jsonl"

# Until the start succeeds, a failure ends the demo instead of leaving a stale window.
started=no
cleanup() { [[ $started == yes ]] || { print -u2 "The demo did not start; ending what it opened."; stop_demo >/dev/null 2>&1 || true; }; }
trap cleanup EXIT

mkdir -p "$home"
in_demo nohup herdr-app >"$dir/app.log" 2>&1 &
print $! > "$dir/app.pid"
for _ in {1..40}; do answers && break; sleep 0.5; done
if ! answers; then print -u2 "The demo window did not answer within 20 s (log: $dir/app.log)."; exit 1; fi

# The demo's core, checked by its environment: never your own.
theirs=$(in_demo hc server status --json 2>/dev/null | sed -n 's/.*"pid": *\([0-9]*\).*/\1/p' | tail -1)
if ! is_demo_pid "$theirs"; then
  print -u2 "The demo's herdr-core isn't separate from yours; not adding agents."
  exit 1
fi
print "$theirs" > "$dir/core.pid"

# usage: json_argv <state> <app> <title> <talk> [<next state> <delay s>]
json_argv() {
  local next=""
  [[ -n ${5:-} ]] && next=",\"$5\",\"$6\""
  print -r -- "[\"$agent\",\"$1\",\"$2\",\"$3\",\"$dir/talk/$4.txt\"$next]"
}
in_demo herdr-app do space.new "{\"name\":\"acme-web\",\"folder\":\"$work/acme-web\",\"argv\":$(json_argv idle codex 'Dashboard quota' web)}" >/dev/null
# A new tab joins the space shown last, so the Grok tab goes in acme-web before acme-api exists.
in_demo herdr-app do tab.new "{\"folder\":\"$work/acme-web\",\"argv\":$(json_argv working grok-build 'Dashboard charts' grok done 25)}" >/dev/null
in_demo herdr-app do space.new "{\"name\":\"acme-api\",\"folder\":\"$work/acme-api\",\"argv\":$(json_argv working claude-code 'Rate limit per key' api)}" >/dev/null
in_demo herdr-app do tab.new "{\"folder\":\"$work/acme-api\",\"argv\":$(json_argv working codex 'Migration review' review blocked 20)}" >/dev/null
in_demo herdr-app do tab.new "{\"folder\":\"$work/acme-api\",\"argv\":$(json_argv idle kiro-cli 'Explain the index' kiro)}" >/dev/null
in_demo herdr-app do tab.select '{"index":1}' >/dev/null
in_demo herdr-app do layout.show '{"id":"herdsidian"}' >/dev/null || true

started=yes
print "Demo running from $dir. Drive it with: eval \"\$(scripts/demo.sh env)\"; stop it with: scripts/demo.sh stop"
