// Checks the package before a release: JavaScript syntax, valid JSON, theme files
// in Herdr's format, keys pointing at mods that exist, and no personal paths.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const errors = [];
const files = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  if ([".git", "node_modules"].includes(n)) return [];
  return statSync(p).isDirectory() ? files(p) : [p];
});
const all = files(root).filter((p) => !p.endsWith("jsconfig.json"));
const fail = (p, msg) => errors.push(`${relative(root, p)}: ${msg}`);

for (const p of all.filter((p) => p.endsWith(".js"))) {
  try { execFileSync(process.execPath, ["--check", p], { stdio: "pipe" }); }
  catch (e) { fail(p, String(e.stderr).trim()); }
}

const json = {};
for (const p of all.filter((p) => p.endsWith(".json"))) {
  try { json[relative(root, p)] = JSON.parse(readFileSync(p, "utf8")); }
  catch (e) { fail(p, `invalid JSON: ${e.message}`); }
}

// Theme files: #rrggbb only (Herdr refuses alpha there) and 16 ANSI colors.
const hex = /^#[0-9a-f]{6}$/i;
for (const [p, t] of Object.entries(json).filter(([p]) => p.startsWith("themes/"))) {
  for (const k of ["background", "foreground", "selection"]) if (!hex.test(t[k] ?? "")) fail(p, `${k} must be #rrggbb`);
  if (!Array.isArray(t.ansi) || t.ansi.length !== 16 || !t.ansi.every((c) => hex.test(c))) fail(p, "ansi must be 16 #rrggbb colors");
  for (const [k, c] of Object.entries(t.colors ?? {})) if (!hex.test(c)) fail(p, `colors.${k} must be #rrggbb`);
}

// Mods named by the layout and the keys exist here or ship with Herdr.
const shipped = ["workspace-chrome", "tabs", "pane", "files", "changes", "workspace-status"];
const ours = readdirSync(join(root, "mods"));
const mods = new Set();
const walk = (n) => { if (n?.content?.mod) mods.add(n.content.mod); (n?.children ?? []).forEach(walk); };
for (const [p, l] of Object.entries(json).filter(([p]) => p.startsWith("layouts/"))) {
  walk(l);
  if (l.theme && !json[`themes/${l.theme}.json`]) fail(p, `theme ${l.theme} has no themes/${l.theme}.json`);
}
for (const actions of Object.values(json["keys.json"] ?? {})) for (const a of Object.values(actions)) {
  const m = /^([a-z0-9-]+)\.[a-z0-9-]+$/.exec(a);
  if (m && !["space", "agent", "tab", "pane", "layout", "app", "terminal", "window"].includes(m[1])) mods.add(m[1]);
}
for (const m of mods) if (!ours.includes(m) && !shipped.includes(m)) errors.push(`mod ${m} is used but not in mods/ nor shipped by Herdr`);

// Nothing personal in what gets shared.
for (const p of all.filter((p) => /\.(js|json|md)$/.test(p))) {
  if (/\/Users\/|\/home\/[a-z]/.test(readFileSync(p, "utf8"))) fail(p, "contains an absolute home path");
}

if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`lint ok: ${all.length} files`);
