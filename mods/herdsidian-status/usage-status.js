// Usage in the status bar: which provider is primary and what each one shows. Pure: no herdr /
// gpui-kit imports, so Node tests import it.
import { PROVIDER_KEYS, windowView } from "./usage.js";
import { monthLabel, monthText } from "./usage-month.js";

export const NO_READING = "–"; // before the first hover, while loading, and after an error
export const HIGH_PERCENT = 90; // at or over this, the reading is a warning

// The focused pane's program key from panes() (opencode is not in agents(); probe Q4). A focus
// without a pane matches by terminal. undefined when nothing matches.
export function focusedProgramKey(focused, panes) {
  if (!focused || !Array.isArray(panes)) return undefined;
  const pane = panes.find((p) => p.pane === focused.pane || (focused.pane == null && p.terminal === focused.terminal));
  return pane?.program?.key;
}

// The focused pane's provider when it is installed, else the first installed in S1 order, else null.
export function primaryKey(installedKeys, programKey) {
  if (PROVIDER_KEYS.includes(programKey) && installedKeys.includes(programKey)) return programKey;
  return PROVIDER_KEYS.find((key) => installedKeys.includes(key)) ?? null;
}

// The providers with the primary first and the rest in S1 order.
export function orderedProviders(providers, programKey) {
  const sorted = PROVIDER_KEYS.map((key) => providers.find((p) => p.key === key)).filter(Boolean);
  const first = primaryKey(sorted.map((p) => p.key), programKey);
  return [...sorted.filter((p) => p.key === first), ...sorted.filter((p) => p.key !== first)];
}

// What the status bar shows for one provider's cache entry: the main number, its percent (null for
// a cost), the window label and whether it is high. The main window is the 5 h one, else the first.
export function reading(key, entry, now) {
  if (entry?.state !== "ok") return { text: NO_READING, percent: null, label: "", high: false };
  const d = entry.data;
  if (d.kind === "month") return { text: monthText(d), percent: null, label: monthLabel(d.month), high: false };
  if (d.kind === "stats") return { text: d.cost, percent: null, label: "7 d", high: false };
  const w = d.windows.find((x) => x.label === "5 h") ?? d.windows[0];
  const v = windowView(w, now, key === "codex");
  return { text: v.percentText, percent: v.percent, label: v.label, high: v.percent >= HIGH_PERCENT };
}
