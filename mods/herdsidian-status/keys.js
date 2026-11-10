// Key hints read from keys(), and the defaults of the `settings` store (settings.js) that can
// hide them. Canonical copy: lib/keys.js. Pure (no Herdr or GPUI imports), so Node tests import it.

// keyHints: "modifier" | "always" | "off". A mod cannot see modifiers while a terminal is focused
// (probe Q2), so "modifier" falls back to showing the keys on row hover.
// usageInStatus: show the Usage line in the status bar.
export const SETTING_DEFAULTS = { keyHints: "modifier", usageInStatus: true };
export const KEY_HINT_VALUES = ["modifier", "always", "off"];
export const SIDEBAR_TABS = ["notes", "files", "changes"];

export const nextKeyHints = (v) => KEY_HINT_VALUES[(KEY_HINT_VALUES.indexOf(v) + 1) % KEY_HINT_VALUES.length];
export const keyHintLabel = (v) => ({ modifier: "On hover", always: "Always", off: "Off" })[v];

// A stored value -> every setting, defaults filled in; unknown or mistyped values are ignored.
// Old boolean keyHints migrate: true -> "always", false -> "off".
export function readSettings(raw) {
  const out = { ...SETTING_DEFAULTS };
  if (raw && typeof raw === "object") {
    if (KEY_HINT_VALUES.includes(raw.keyHints)) out.keyHints = raw.keyHints;
    else if (raw.keyHints === true) out.keyHints = "always";
    else if (raw.keyHints === false) out.keyHints = "off";
    if (typeof raw.usageInStatus === "boolean") out.usageInStatus = raw.usageInStatus;
  }
  return out;
}

// Whether row `id` shows its key: every row for "always", the hovered one for "modifier".
export const showKeyHint = (hints, hoveredId, id) => hints === "always" || (hints === "modifier" && hoveredId === id);

const cap = (s) => s[0].toUpperCase() + s.slice(1);

// The Settings rows of the palette's Settings tab: [{ title, rows }].
export function settingSections({ settings, sidebarHidden, sidebarRail, sidebarTab }) {
  const tab = SIDEBAR_TABS.includes(sidebarTab) ? sidebarTab : "notes";
  const nextTab = SIDEBAR_TABS[(SIDEBAR_TABS.indexOf(tab) + 1) % SIDEBAR_TABS.length];
  const general = [{
    id: "key-hints", label: "Key hints", detail: keyHintLabel(settings.keyHints),
    action: { type: "setting", name: "keyHints", value: nextKeyHints(settings.keyHints) },
  }];
  const layout = [{
    id: "right-sidebar", label: "Right sidebar", detail: sidebarHidden ? "Hidden" : "Shown",
    keycap: null, // ⌘⇧O selects Notes; it does not toggle the sidebar
    action: { type: "run", name: "layout.toggle", args: { id: "herdsidian" } },
  }, {
    id: "sidebar-tab", label: "Right sidebar tab", detail: cap(tab),
    action: { type: "run", name: `herdsidian-tabs.${nextTab}`, args: {} },
  }];
  if (!sidebarHidden) {
    layout.push({
      id: "sidebar-width", label: "Sidebar width", detail: sidebarRail ? "Rail" : "Expanded",
      action: { type: "run", name: sidebarRail ? "herdsidian.expand" : "herdsidian.rail", args: {} },
    });
  }
  layout.push({
    id: "usage-in-status", label: "Usage in the status bar", detail: settings.usageInStatus ? "On" : "Off",
    action: { type: "setting", name: "usageInStatus", value: !settings.usageInStatus },
  });
  return [{ title: "General", rows: general }, { title: "Layout", rows: layout }];
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
