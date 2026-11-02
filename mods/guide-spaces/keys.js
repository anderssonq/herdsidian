// Key hints read from keys(), and the defaults of the `settings` store (settings.js) that can
// hide them. Canonical copy: lib/keys.js. Pure (no Herdr or GPUI imports), so Node tests import it.

// keyHints: show the keys beside tabs, toolbar buttons and sidebar rows.
export const SETTING_DEFAULTS = { keyHints: true };

// A stored value -> every setting, defaults filled in; unknown or mistyped values are ignored.
export function readSettings(raw) {
  const out = { ...SETTING_DEFAULTS };
  if (raw && typeof raw === "object") {
    for (const [name, value] of Object.entries(SETTING_DEFAULTS)) if (typeof raw[name] === typeof value) out[name] = raw[name];
  }
  return out;
}

const MODS = [["ctrl", "⌃"], ["alt", "⌥"], ["shift", "⇧"], ["cmd", "⌘"]];
const KEY_NAMES = { tab: "⇥", escape: "⎋", space: "Space", up: "↑", down: "↓", left: "←", right: "→" };

// "cmd-alt-1" -> "⌥⌘1". Modifier order ⌃⌥⇧⌘. The key itself may be "-" or "[".
export function formatChord(keys) {
  const held = new Set();
  let rest = keys;
  for (;;) {
    const hit = MODS.find(([name]) => rest.startsWith(`${name}-`) && rest.length > name.length + 1);
    if (!hit) break;
    held.add(hit[0]);
    rest = rest.slice(hit[0].length + 1);
  }
  const key = KEY_NAMES[rest] ?? (rest.length === 1 ? rest.toUpperCase() : rest);
  return MODS.filter(([name]) => held.has(name)).map(([, glyph]) => glyph).join("") + key;
}

// keys() list -> "⌘L" | null. The `layout:<name>` section first, then `global`, nothing else.
export function keyHint(bindings, action, layoutName) {
  if (!Array.isArray(bindings)) return null;
  for (const section of [`layout:${layoutName}`, "global"]) {
    const found = bindings.find((b) => b.section === section && b.action === action);
    if (found) return formatChord(found.keys);
  }
  return null;
}
