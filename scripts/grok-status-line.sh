#!/bin/sh
# Herdsidian status line for Grok (macOS). Grok pipes a JSON payload on stdin on every state change.
# This script keeps 11 numbers and ids per session in one owner-only file for the Usage card and the
# context bar, and prints one short line for Grok's status row. See Usage in the README.
#
# Reads only its stdin. Writes only inside ${XDG_STATE_HOME:-$HOME/.local/state}/herdsidian/grok
# (folder 0700, file 0600, never the prompt, the transcript path, the branch or the repo).
# Uses only /bin/sh and /usr/bin/plutil (plus mkdir, chmod, mv, date, cat by absolute path). It
# never deletes a file, never uses the network and always exits 0, so Grok never paints an error.
# Cost per run: 10 or 11 plutil reads (the cwd has a fallback key), then 3 plutil inserts (only the
# three strings, so plutil escapes them). The six numbers from the payload pass a strict JSON
# number check (else null) and are spliced into the JSON as text with updated_at, no process each.

umask 077
payload=$(/bin/cat 2>/dev/null)

# get KEYPATH: the raw value of a key, empty when missing or not a plain value.
get() { printf '%s' "$payload" | /usr/bin/plutil -extract "$1" raw -o - - 2>/dev/null; }

# num VALUE: VALUE when it is a JSON number, -?(0|[1-9][0-9]*)(.[0-9]+)?([eE][-+]?[0-9]+)?, else null.
num() {
  n=${1#-}
  m=${n%%[eE]*}
  i=${m%%.*}
  good=1
  case "$i" in ''|*[!0-9]*|0[0-9]*) good=0 ;; esac
  if [ "$i" != "$m" ]; then
    case "${m#*.}" in ''|*[!0-9]*) good=0 ;; esac
  fi
  if [ "$m" != "$n" ]; then
    e=${n#*[eE]}
    case "${e#[-+]}" in ''|*[!0-9]*) good=0 ;; esac
  fi
  # A number too large for a double (1e999) is null: the shell prints it as inf.
  if [ "$good" = 1 ] && [ "$m" != "$n" ]; then
    case $(printf '%g' "$1" 2>/dev/null) in *[iI][nN][fF]*|*[nN][aA][nN]*) good=0 ;; esac
  fi
  if [ "$good" = 1 ]; then printf '%s' "$1"; else printf null; fi
}

# ins_s KEY VALUE: add one string key to the JSON on stdin. The value goes in as an argument, so
# plutil does the escaping (quotes, backslashes, non-ASCII). An empty string is null.
ins_s() {
  if [ -n "$2" ]; then
    /usr/bin/plutil -insert "$1" -string "$2" -o - - 2>/dev/null
  else
    /usr/bin/plutil -insert "$1" -json null -o - - 2>/dev/null
  fi
}

sid=$(get session_id)
cwd=$(get workspace.current_dir)
[ -n "$cwd" ] || cwd=$(get cwd)
model=$(get model.id)
name=$(get model.display_name)
cost=$(num "$(get cost.total_cost_usd)")
size=$(num "$(get context_window.context_window_size)")
tokens=$(num "$(get context_window.context_tokens)")
pct=$(num "$(get context_window.used_percentage)")
tin=$(num "$(get context_window.session_input_tokens)")
tout=$(num "$(get context_window.session_output_tokens)")

# The one line for Grok. The percent shows only when it rounds to a whole number from 0 to 999.
[ -n "$name" ] || name=Grok
shown=
[ "$pct" = null ] || shown=$(printf '%.0f' "$pct" 2>/dev/null)
case "$shown" in
  [0-9]|[1-9][0-9]|[1-9][0-9][0-9]) printf '%s · %s%% ctx\n' "$name" "$shown" ;;
  *) printf '%s\n' "$name" ;;
esac

# The state file: only for a safe session id.
ok=1
case "$sid" in
  ''|.|..|*[!A-Za-z0-9._-]*) ok=0 ;;
esac
[ "${#sid}" -le 128 ] || ok=0

if [ "$ok" = 1 ]; then
  # A relative XDG_STATE_HOME is ignored (XDG spec), as the readers do.
  case "$XDG_STATE_HOME" in /*) ;; *) XDG_STATE_HOME= ;; esac
  dir="${XDG_STATE_HOME:-$HOME/.local/state}/herdsidian/grok"
  if /bin/mkdir -p "$dir" 2>/dev/null && /bin/chmod 700 "$dir" 2>/dev/null; then
    tmp="$dir/.$sid.$$.tmp"
    now="$(/bin/date +%s)000"
    json=$(printf '{"v":1}' \
      | ins_s session_id "$sid" \
      | ins_s cwd "$cwd" \
      | ins_s model "$model")
    # The numbers are spliced in here, not through plutil, which would refuse a value it cannot hold.
    if [ -n "$json" ]; then
      json="${json%\}},\"updated_at\":$now,\"cost_usd\":$cost,\"context_window_size\":$size,\"context_tokens\":$tokens,\"used_percentage\":$pct,\"session_input_tokens\":$tin,\"session_output_tokens\":$tout}"
      if printf '%s\n' "$json" > "$tmp" 2>/dev/null; then
        /bin/mv -f "$tmp" "$dir/$sid.json" 2>/dev/null
      fi
    fi
  fi
fi
exit 0
