// The Files tab's pure helpers (V1), moved out of mods/herdsidian-files: listings, limits, language, git marks and paths.
// Pure (no herdr, gpui-kit or gpui-base import), so Node tests import it.

export const PER_FOLDER = 500, TOTAL = 5000;
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html", htm: "html",
  markdown: "md", mdx: "md", scss: "css", sass: "css", less: "css" };

// The folder Files and Changes look at: the focused pane's cwd, else the focused cwd, else the space folder.
// `on` is the machine of a remote space or terminal.
export function locate({ space, focus, panes }) {
  const pane = focus?.pane ? panes.find((p) => p.pane === focus.pane) : null;
  const on = focus?.pane === null ? (focus.terminal?.includes("/") ? focus.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || focus?.cwd || space?.folder, on, space: space?.id };
}

// "d\0name\0f\0name\0" as printed by the listing script.
export function parseListing(stdout) {
  const fields = stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

// One folder's entries, folders first, cut to the per-folder and total limits; `used` counts the entries of the other folders.
export function capEntries(entries, used) {
  const list = entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used)))
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  return { list, limited: entries.length > PER_FOLDER || used + entries.length > TOTAL };
}

// The editor language of a file name: its extension, a few mapped to a grammar the editor has.
export function languageOf(path) {
  const name = path.split("/").pop();
  const ext = name.includes(".") ? name.split(".").pop() : "txt";
  return LANG[ext] ?? ext;
}

// The letter drawn after a name for a git XY pair: A added or untracked, U conflict, D deleted, M other.
export const markOf = (xy) => (xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M");

// `git status --porcelain=v1 -z --no-renames` of the repo `top`, as { "<top>/<path>": mark }.
export function parseMarks(top, stdout, limit = TOTAL) {
  const marks = {};
  for (const entry of stdout.split("\0").filter(Boolean).slice(0, limit)) marks[`${top}/${entry.slice(3)}`] = markOf(entry.slice(0, 2));
  return marks;
}

// `abs` below `root`: its path from there ("" for the root itself); null when it lies elsewhere.
export function relativeTo(root, abs) {
  if (!root) return null;
  const path = abs.length > 1 ? abs.replace(/\/+$/, "") : abs;
  if (path === root) return "";
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : null;
}

// The folders above a path: "a/b/c.txt" gives ["a", "a/b"].
export const ancestors = (rel) => rel.split("/").slice(0, -1).map((_part, i, all) => all.slice(0, i + 1).join("/"));

// "~" for the home folder in a path shown to the person.
export function tildePath(path, home) {
  if (typeof home !== "string" || !home) return path;
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
