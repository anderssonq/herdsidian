#!/bin/zsh
# Opens a second Herdr window with the Herdsidian layout, a demo vault and demo agents,
# isolated from your own Herdr: its own HOME, app home, state folder and herdr-core
# session (checked by the core's environment before any agent starts), so it doesn't
# touch your spaces, terminals, settings, vault or context links. The README images are taken from it.
#
#   scripts/demo.sh            start the demo (DEMO_SIZE=1440x900 sets the window size)
#   scripts/demo.sh stop       quit it and stop its core (--clean also deletes its folder)
#   scripts/demo.sh env        print the variables that point herdr-app/hc at the demo
#
# DEMO_DIR picks where it lives (default: $TMPDIR/hsd). Its last part must start with
# "hsd". Keep it short: Herdr and herdr-core talk over unix sockets inside it.
set -euo pipefail

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
  HOME="$home" HERDR_APP_HOME="$dir/app" XDG_CONFIG_HOME="$dir/cfg" XDG_STATE_HOME="$dir/st"
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
  (( ${${(s: :)env_words}[(Ie)HERDR_APP_HOME=$dir/app]} ))
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
  print "Demo window quit: $quit. Demo core stopped: $core."
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
# usage: agent.sh <state> <app> <title> <transcript file>
agent=$dir/agent.sh
cat > "$agent" <<'EOF'
#!/bin/zsh
printf '\e]2;%s\a' "$3"
[[ -f ${4:-} ]] && cat "$4"
report() { while kill -0 $$ 2>/dev/null; do printf '\e]7501;state=%s:app=%s\a' "$1" "$2"; sleep 5; done; }
report "$1" "$2" &
trap 'kill $! 2>/dev/null' EXIT HUP TERM
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

json_argv() { print -r -- "[\"$agent\",\"$1\",\"$2\",\"$3\",\"$dir/talk/$4.txt\"]"; }
in_demo herdr-app do space.new "{\"name\":\"acme-web\",\"folder\":\"$work/acme-web\",\"argv\":$(json_argv idle codex 'Dashboard quota' web)}" >/dev/null
in_demo herdr-app do space.new "{\"name\":\"acme-api\",\"folder\":\"$work/acme-api\",\"argv\":$(json_argv working claude-code 'Rate limit per key' api)}" >/dev/null
in_demo herdr-app do tab.new "{\"folder\":\"$work/acme-api\",\"argv\":$(json_argv blocked codex 'Migration review' review)}" >/dev/null
in_demo herdr-app do tab.select '{"index":1}' >/dev/null
in_demo herdr-app do layout.show '{"id":"herdsidian"}' >/dev/null || true

started=yes
print "Demo running from $dir. Drive it with: eval \"\$(scripts/demo.sh env)\"; stop it with: scripts/demo.sh stop"
