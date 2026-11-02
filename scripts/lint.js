// Checks the package before a release: JavaScript syntax, valid JSON, theme files
// in Herdr's format, keys pointing at mods that exist, and no personal paths.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const errors = [];
const files = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  if ([".git", "node_modules", ".kit-backup", ".spec"].includes(n)) return [];
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
const shipped = ["workspace-chrome", "files", "changes", "picker"];
const ours = readdirSync(join(root, "mods"));
const mods = new Set();
const walk = (n) => {
  if (n?.content?.mod) mods.add(n.content.mod);
  if (n?.content?.pane?.header?.content?.mod) mods.add(n.content.pane.header.content.mod);
  (n?.children ?? []).forEach(walk);
};
for (const [p, l] of Object.entries(json).filter(([p]) => p.startsWith("layouts/"))) {
  walk(l);
  if (l.theme && !json[`themes/${l.theme}.json`]) fail(p, `theme ${l.theme} has no themes/${l.theme}.json`);
}
for (const actions of Object.values(json["keys.json"] ?? {})) for (const a of Object.values(actions)) {
  const m = /^([a-z0-9-]+)\.[a-z0-9-]+$/.exec(a);
  if (m && !["space", "agent", "tab", "pane", "layout", "app", "terminal", "window"].includes(m[1])) mods.add(m[1]);
}
// `mod.open:<name>` opens a mod overlay: the mod must exist here or ship with Herdr.
for (const [section, actions] of Object.entries(json["keys.json"] ?? {})) for (const [key, a] of Object.entries(actions)) {
  const m = /^mod\.open:(.+)$/.exec(a);
  if (m && !ours.includes(m[1]) && !shipped.includes(m[1])) errors.push(`keys.json: ${section} ${key}: mod.open:${m[1]} names a mod that is not in mods/ nor shipped by Herdr`);
}
for (const m of mods) if (!ours.includes(m) && !shipped.includes(m)) errors.push(`mod ${m} is used but not in mods/ nor shipped by Herdr`);

// Shared copies (ADR-0001): every mods/*/<name>.js equals lib/<name>.js, and a mod that
// imports ./<name>.js has the file. .kit-backup/ and .spec/ are skipped.
const modFiles = all.filter((p) => relative(root, p).startsWith("mods/"));
for (const name of ["tokens", "ui", "layout", "keys", "settings"]) {
  const canonicalPath = join(root, `lib/${name}.js`);
  let canonical = null;
  try { canonical = readFileSync(canonicalPath, "utf8"); }
  catch { fail(canonicalPath, "missing (the canonical copy)"); }
  for (const p of modFiles.filter((p) => p.endsWith(`/${name}.js`))) {
    if (canonical !== null && readFileSync(p, "utf8") !== canonical) fail(p, `differs from lib/${name}.js (copy it with cp)`);
  }
  const imports = new RegExp(`from\\s+["']\\./${name}\\.js["']`);
  for (const p of modFiles.filter((p) => p.endsWith(".js"))) {
    if (imports.test(readFileSync(p, "utf8")) && !modFiles.includes(join(p, "..", `${name}.js`))) {
      fail(p, `imports ./${name}.js but the mod has no ${name}.js`);
    }
  }
}

// Colors in mods come from the theme: no hex literal, no alpha glued to a color string.
// The one exception is the space avatar palette and the avatar letter, in guide-spaces/main.js.
const avatarHex = new Set([
  "#22a99a", "#e3814f", "#5b8def", "#8b7cf6", "#3fae6a", "#d9649a", // MARK
  "#000000bf", // AVATAR_LETTER
]);
// tokens.js holds the HIGHLIGHT literal; ui.js and layout.js copies are scanned like any mod file.
const shared = (p) => p.endsWith("/tokens.js");
for (const p of modFiles.filter((p) => p.endsWith(".js") && !shared(p))) {
  const allowed = relative(root, p) === "mods/guide-spaces/main.js" ? avatarHex : new Set();
  readFileSync(p, "utf8").split("\n").forEach((line, i) => {
    for (const lit of line.match(/#[0-9a-f]{6}(?:[0-9a-f]{2})?(?![0-9a-f])/gi) ?? []) {
      if (!allowed.has(lit.toLowerCase())) fail(p, `line ${i + 1}: hex literal ${lit} (derive it from theme() / tokens.js)`);
    }
    for (const lit of line.match(/#[0-9a-f]{3,4}(?![0-9a-f])/gi) ?? []) {
      fail(p, `line ${i + 1}: short hex literal ${lit} (derive it from theme() / tokens.js)`);
    }
    // `+ "26"`, `${c}26` anywhere in a template, and `.concat("26")`.
    if (/\+\s*["'][0-9a-f]{2}["']|\}[0-9a-f]{2}(?![0-9a-z_])|\.concat\(\s*["'][0-9a-f]{2}["']/i.test(line)) {
      fail(p, `line ${i + 1}: alpha glued to a color string (use alpha() from tokens.js)`);
    }
  });
}

// Guards on the mod sources. Both report file and line.
// 1. herdr's `window` import shadows the gpui global (F2): paint_path must go through globalThis.
// 2. Notes never submits to an agent: it pastes only (AC27), so no send/keys/Enter/task calls.
// 3. The pure files stay testable under node: no herdr, gpui-kit or gpui-base import.
// The no-submit rule (2) also covers palette-main.js, palette.js, palette-view.js and send.js.
const pure = new Set(["notes", "context", "graph", "palette", "send"].map((n) => `mods/herdsidian/${n}.js`));
const hostImport = /\bfrom\s*["'](herdr|gpui-kit|gpui-base)["']|\bimport\s*["'](herdr|gpui-kit|gpui-base)["']/;
const paintPath = /(?<!globalThis\.)\bwindow\.paint_path/;
const submitCall = /terminal\.(send|keys)\b|hc\(\s*\[\s*["'](send|keys)["']|["']enter["']|\btask\s*:/;
for (const p of modFiles.filter((p) => p.endsWith(".js"))) {
  const inNotes = /^mods\/herdsidian\/[^/]+\.js$/.test(relative(root, p));
  readFileSync(p, "utf8").split("\n").forEach((line, i) => {
    if (paintPath.test(line)) {
      fail(p, `line ${i + 1}: use globalThis.window.paint_path (herdr's window import shadows the gpui global, F2)`);
    }
    if (pure.has(relative(root, p)) && hostImport.test(line)) fail(p, `line ${i + 1}: pure file must not import herdr, gpui-kit or gpui-base`);
    if (inNotes && submitCall.test(line)) fail(p, `line ${i + 1}: Send to agent must paste, never submit (AC27)`);
  });
}

// Nothing personal in what gets shared.
for (const p of all.filter((p) => /\.(js|json|md)$/.test(p))) {
  if (/\/Users\/|\/home\/[a-z]/.test(readFileSync(p, "utf8"))) fail(p, "contains an absolute home path");
}

if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log(`lint ok: ${all.length} files`);
