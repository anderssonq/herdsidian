// The pure rules of the New note name prompt: what a typed name becomes, and the two texts the row shows.
// No Herdr or GPUI imports, so node tests it. The write itself is makeNamedNote in vault-io.js.

import { validateName, noteFileName } from "./actions.js";

// -> { kind: "untitled" } (nothing typed) | { kind: "named", name } | { kind: "refused", reason }
export function checkNoteName(typed) {
  if (typeof typed !== "string" || !typed.trim()) return { kind: "untitled" };
  const checked = validateName(typed);
  if (!checked.ok) return { kind: "refused", reason: checked.reason };
  return { kind: "named", name: noteFileName("", checked.name) };
}

export const folderLabel = (dir) => (dir ? `in ${dir}` : "in the vault root");

export const takenText = (name) => `"${name}" already exists in this folder`;
