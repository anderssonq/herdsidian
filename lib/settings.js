// Herdsidian's visual settings: one global store in shared("herdsidian.settings"), so every mod
// reads the same values and a change re-renders them all. Canonical copy: lib/settings.js.
// Imports herdr, so Node tests do not import it; the defaults live in keys.js (pure).
import { shared, setShared } from "herdr";
import { readSettings } from "./keys.js";

const SETTINGS_KEY = "herdsidian.settings";

export const settings = () => readSettings(shared(SETTINGS_KEY));

// Only the changed key is added over the raw stored object: defaults are not written back.
export function setSetting(name, value) {
  const raw = shared(SETTINGS_KEY);
  const stored = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  setShared(SETTINGS_KEY, { ...stored, [name]: value });
}
