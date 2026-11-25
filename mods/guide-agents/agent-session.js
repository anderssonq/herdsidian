// What the agent session scripts share (ADR-0008): the tail they may read, how old a session may
// be, Claude Code's project folder name, and which agents can be mapped to a session file.
// Pure: no host import.

// The tail a session script may look at.
export const TAIL_BYTES = 262144;
// A session older than this is not used.
export const FRESH_MINUTES = 1440;

// Claude Code's project folder name: every character outside [A-Za-z0-9] becomes "-".
export const claudeDir = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, "-");

// -> Map<address, { key, cwd }> of the agents that can have a session: local, a program of `keys`,
// a pane with a cwd, and no other such agent of the same program in the same folder.
export function sessionTargets(agents, panes, keys) {
  const cwdOf = new Map((panes ?? []).map((p) => [p?.pane, p?.cwd]));
  const listed = [];
  for (const a of agents ?? []) {
    const key = a?.program?.key, cwd = cwdOf.get(a?.pane);
    if (typeof a?.address !== "string" || a.address.includes("/") || !keys.includes(key)) continue;
    if (typeof cwd !== "string" || cwd === "") continue;
    listed.push([a.address, { key, cwd }]);
  }
  const count = new Map();
  for (const [, t] of listed) count.set(`${t.key}\u0000${t.cwd}`, (count.get(`${t.key}\u0000${t.cwd}`) ?? 0) + 1);
  return new Map(listed.filter(([, t]) => count.get(`${t.key}\u0000${t.cwd}`) === 1));
}
