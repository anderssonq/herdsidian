// The session reader of the Changes tab's last-prompt card (plan Decision 3, ADR-0007): the
// focused Claude Code pane's last typed prompt, its time, and the files that turn wrote.
// Pure: no host import; readTurn gets `exec` handed in. Claude Code only (scope cut 2026-11-25).
import { TAIL_BYTES, FRESH_MINUTES, claudeDir, sessionTargets } from "./agent-session.js";

const TURN_LIMIT_MS = 10000;

// Arg: the Claude project folder name. The file is chosen as CLAUDE_CONTEXT_SCRIPT chooses it
// (a parity test pins this). Prints "P <timestamp>", "T <text>" and one "F <file_path>" per
// Edit, Write or MultiEdit call after the prompt, all still JSON-escaped; nothing else.
// A typed prompt is a "type":"user" line with no meta, sidechain, compact or tool_result key,
// a human origin when it has one, and a text that is not a command wrapper or an interrupt.
// A bare "key": pattern cannot come from inside a JSON string, whose quotes are escaped.
// The script has no ">" but 2>/dev/null, so wrapper tags match by prefix and sizes use -gt.
export const CLAUDE_TURN_SCRIPT = `d=$1
case "$d" in ""|*/*|.|..) exit 0;; esac
find "$HOME/.claude/projects/$d" -maxdepth 1 -type f -name '*.jsonl' -mmin -${FRESH_MINUTES} -exec stat -f '%m %z %N' {} + 2>/dev/null | sort -rn | head -n 5 | while read -r m z f; do
  e=$(tail -c ${TAIL_BYTES} "$f" 2>/dev/null | grep -o -E '"entrypoint":"[^"]*"' | sort -u)
  case "$e" in ""|*'"entrypoint":"cli"'*) ;; *) continue;; esac
  c=0
  [ "$z" -gt ${TAIL_BYTES} ] 2>/dev/null && c=1
  tail -c ${TAIL_BYTES} "$f" 2>/dev/null | LC_ALL=C awk -v cut="$c" '
NR == 1 && cut == 1 { next }
/"type":"user"/ {
  if ($0 ~ /"isMeta":true|"isSidechain":true|"isCompactSummary":true|"type":"tool_result"/) next
  if ($0 ~ /"origin":[{]"kind":"/ && $0 !~ /"origin":[{]"kind":"human"/) next
  if (!match($0, /"message":[{]"role":"user","content":/)) next
  r = substr($0, RSTART + RLENGTH)
  if (substr(r, 1, 1) == "[") {
    if (!match(r, /[{]"type":"text","text":"/)) next
    r = substr(r, RSTART + RLENGTH - 1)
  }
  if (!match(r, /^"([^"\\\\]|\\\\.)*"/)) next
  s = substr(r, 1, RLENGTH)
  if (s == "\\"\\"") next
  if (s ~ /^"<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|bash-input|bash-stdout|bash-stderr|task-notification|system-reminder)/) next
  if (s ~ /^"[[]Request interrupted/) next
  text = s
  at = ""
  if (match($0, /"timestamp":"[^"\\\\]*"/)) at = substr($0, RSTART + 12, RLENGTH - 12)
  n = 0
  next
}
/"type":"assistant"/ && text != "" {
  r = $0
  while (match(r, /"name":"(Edit|Write|MultiEdit)","input":[{]/)) {
    r = substr(r, RSTART + RLENGTH)
    if (!match(r, /"file_path":"([^"\\\\]|\\\\.)*"/)) break
    files[++n] = substr(r, RSTART + 12, RLENGTH - 12)
    r = substr(r, RSTART + RLENGTH)
  }
}
END {
  if (text == "") exit 0
  if (at != "") printf "P %s\\n", at
  printf "T %s\\n", text
  for (i = 1; i <= n; i++) printf "F %s\\n", files[i]
}'
  break
done
exit 0`;

// The focused pane's Claude Code agent -> { key, cwd, address, name, paneName, status }, or null:
// ADR-0005's rule, plus no other Claude agent whose folder maps to the same session folder.
export function turnTarget(agents, panes, focus) {
  const id = focus?.pane;
  if (typeof id !== "string" || id === "") return null;
  const agent = (agents ?? []).find((a) => a?.pane === id);
  if (!agent) return null;
  const targets = sessionTargets(agents, panes, ["claude"]);
  const own = targets.get(agent.address);
  if (!own) return null;
  const dir = claudeDir(own.cwd);
  for (const [address, t] of targets) if (address !== agent.address && claudeDir(t.cwd) === dir) return null;
  return { key: own.key, cwd: own.cwd, address: agent.address, name: agent.program?.name ?? own.key, paneName: agent.pane_name || agent.title || null, status: agent.status ?? null };
}

// A JSON string, or undefined.
const jsonString = (text) => {
  try {
    const v = JSON.parse(text);
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
};

// CLAUDE_TURN_SCRIPT output -> { prompt, at: ms | null, paths }, or null with no usable T line.
// Lines that are not P, T or F are ignored.
export function parseTurn(stdout) {
  let prompt, at = null;
  const paths = [];
  for (const line of String(stdout ?? "").split("\n")) {
    const m = line.match(/^([PTF]) (.*)$/);
    if (!m) continue;
    const v = jsonString(m[2]);
    if (m[1] === "T") prompt = v;
    else if (v === undefined) continue;
    else if (m[1] === "P") {
      const ms = Date.parse(v);
      at = Number.isFinite(ms) ? ms : null;
    } else paths.push(v);
  }
  if (typeof prompt !== "string" || prompt.trim() === "") return null;
  return { prompt, at, paths };
}

// An absolute path with ".", ".." and empty parts resolved.
const normal = (path) => {
  const out = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
};

// The turn's paths -> the ones inside `root` (not root itself), relative to it, once each.
// A relative path is the pane's cwd's.
export function turnFiles(paths, cwd, root) {
  const base = normal(root);
  const prefix = base === "/" ? "/" : `${base}/`;
  const out = new Set();
  for (const p of paths ?? []) {
    if (typeof p !== "string" || p === "") continue;
    const full = normal(p.startsWith("/") ? p : `${cwd}/${p}`);
    if (full.startsWith(prefix) && full !== base) out.add(full.slice(prefix.length));
  }
  return [...out];
}

// One read-only local exec for a Claude target -> parseTurn's value, or null. Never throws.
export async function readTurn(exec, target) {
  if (target?.key !== "claude" || typeof target.cwd !== "string" || target.cwd === "") return null;
  try {
    const r = await exec("/bin/sh", ["-c", CLAUDE_TURN_SCRIPT, "sh", claudeDir(target.cwd)], { timeout: TURN_LIMIT_MS });
    if (!r || r.code !== 0 || typeof r.stdout !== "string") return null;
    return parseTurn(r.stdout);
  } catch {
    return null;
  }
}
