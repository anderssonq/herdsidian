// The pure rules of the tree's right-click actions: menu rows and place, name checks, path mapping,
// the request check, delete counts and the result message. No Herdr or GPUI imports, so node tests it.

import { HIDDEN, normKey } from "./notes.js";
import { isFreshRequest, under } from "./context.js";

export { under } from "./context.js";

export const MENU = { width: 180, row: 30, pad: 10, margin: 8 };
export const ACTION_KEY = "herdsidian.vault-action";

const ROWS = {
  "new-note": "New note",
  "new-folder": "New folder",
  rename: "Rename",
  delete: "Delete",
};
const IDS = {
  dir: ["new-note", "new-folder", "rename", "delete"],
  note: ["rename", "delete"],
  root: ["new-note", "new-folder"], // the vault root is never renamed or deleted (AC63)
};

export function menuItems(kind) {
  return (IDS[kind] ?? []).map((id) => ({ id, label: ROWS[id] }));
}

const num = (n) => typeof n === "number" && Number.isFinite(n);
const menuHeight = (itemCount) => itemCount * MENU.row + MENU.pad;

export const menuSize = (kind) => ({ width: MENU.width, height: menuHeight(menuItems(kind).length) });

// Where the popup opens. `at` is in window pixels at every zoom, but the surface grows with zoom,
// so only the size is scaled. Returns the unscaled width and height, as openOverlay takes them.
export function placeMenu(pointer, itemCount, viewport, zoom = 1) {
  const width = MENU.width, height = menuHeight(itemCount);
  const vw = viewport?.width, vh = viewport?.height;
  if (!num(pointer?.x) || !num(pointer?.y) || !num(vw) || !num(vh)) return { at: "pointer", width, height };
  const z = num(zoom) && zoom > 0 ? zoom : 1;
  const place = (p, size, view) => Math.max(MENU.margin, Math.min(p, view - size - MENU.margin));
  return { at: { x: place(pointer.x, width * z, vw), y: place(pointer.y, height * z, vh) }, width, height };
}

// Trim, then refuse what AC13 lists. Anything else is allowed: the name goes to the disk as typed.
export function validateName(typed) {
  const name = typeof typed === "string" ? typed.trim() : "";
  const refuse = (reason) => ({ ok: false, reason });
  if (!name) return refuse("The name is empty");
  if (name.includes("/")) return refuse('The name cannot contain "/"');
  if (name === "." || name === "..") return refuse('The name cannot be "." or ".."');
  if (name.startsWith(".")) return refuse('The name cannot start with "."');
  if (name === "node_modules") return refuse('"node_modules" is reserved');
  if (/[\u0000-\u001f\u007f]/.test(name)) return refuse("The name cannot contain control characters");
  return { ok: true, name };
}

// The file name for a typed note name: the file keeps the extension it had, a typed .md is not doubled.
export function noteFileName(leaf, typed) {
  if (/\.md$/i.test(typed)) return typed;
  return typed + (leaf.match(/\.md$/i)?.[0] ?? ".md");
}

export const isSameItem = (a, b) => a !== b && normKey(a) === normKey(b);

// `names` are the entries on disk in the target folder, so a file the tree hides counts too.
export const takenName = (names, name, ownLeaf = null) => names.some((n) => n !== ownLeaf && normKey(n) === normKey(name));

export function nextUntitled(names) {
  let name = "Untitled.md";
  for (let i = 2; takenName(names, name); i++) name = `Untitled ${i}.md`;
  return name;
}

// A vault-relative path that stays inside the vault. "" is the root and passes only with allowRoot.
export function safeRel(rel, { allowRoot = false } = {}) {
  if (typeof rel !== "string") return { ok: false, reason: "The path is not valid" };
  if (rel === "") return allowRoot ? { ok: true, rel } : { ok: false, reason: "The path is empty" };
  if (rel.startsWith("/") || rel.includes("\0")) return { ok: false, reason: "The path is not inside the vault" };
  if (rel.split("/").some((part) => part === "" || part === "." || part === "..")) return { ok: false, reason: "The path is not inside the vault" };
  return { ok: true, rel };
}

export const movePath = (path, from, to) => (typeof path === "string" && under(path, from) ? to + path.slice(from.length) : path);

// What the Notes view holds after a rename. Open-folder keys follow; the entry lists stay until load().
export function movedState(state, from, to) {
  const map = (p) => movePath(p, from, to);
  return {
    note: map(state.note),
    selected: map(state.selected),
    folders: new Set([...state.folders].map(map)),
    entries: new Map([...state.entries].map(([k, v]) => [map(k), v])),
    all: state.all.map(map).sort(),
    recent: state.recent.map(map),
  };
}

// What it holds after a delete: the item and everything under it is gone.
export function removedState(state, item) {
  const gone = (p) => typeof p === "string" && under(p, item);
  return {
    note: gone(state.note) ? null : state.note,
    selected: gone(state.selected) ? null : state.selected,
    folders: new Set([...state.folders].filter((p) => !gone(p))),
    entries: new Map([...state.entries].filter(([k]) => !gone(k))),
    all: state.all.filter((p) => !gone(p)),
    recent: state.recent.filter((p) => !gone(p)),
  };
}

const OPS = ["new-note", "new-folder", "rename", "delete"];

// What to do with the request in shared(ACTION_KEY). An id runs once; a stale or odd request is ignored.
// -> { action: "run" | "other-vault" | "none", id }
export function pendingAction(request, handled, vault, now) {
  const id = request?.id ?? null;
  if (id === handled || !isFreshRequest(request, now)) return { action: "none", id };
  if (!OPS.includes(request.op) || typeof request.path !== "string") return { action: "none", id };
  return { action: request.vault === vault ? "run" : "other-vault", id };
}

// Counts for the delete dialog. `relPaths` are what `find` found below the folder, relative to the
// folder's parent, so they start with `leaf`. A symbolic link to a folder is one path equal to `leaf`.
export function folderCounts(relPaths, leaf) {
  if (relPaths.length === 1 && relPaths[0] === leaf) return { total: 0, unseen: 0, link: true };
  const unseen = relPaths.filter((p) => {
    const parts = p.slice(leaf.length + 1).split("/");
    return !/\.md$/i.test(parts[parts.length - 1]) || parts.some((part) => HIDDEN.has(part));
  }).length;
  return { total: relPaths.length, unseen, link: false };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The line under the delete dialog's title. counts null: the count failed, delete stays possible.
export function deleteDetail(name, kind, counts) {
  const trash = "It goes to the Trash.";
  if (kind !== "dir") return `"${name}" ${trash}`;
  if (!counts) return `"${name}" ${trash} The number of files inside is not known.`;
  if (counts.link) return `"${name}" is a link. Only the link goes to the Trash, not its target.`;
  if (!counts.total) return `"${name}" is empty. ${trash}`;
  const hidden = counts.unseen ? `, ${counts.unseen} not shown in the tree` : "";
  return `"${name}" has ${plural(counts.total, "file")}${hidden}. ${trash}`;
}

const SHOWN = 5;

// The one message after a rename. `result` is what updateReferences returns. Level is "warning"
// when something was left out: a note, a link, the notes past the cap, or the attachments.
export function resultMessage(result) {
  const { updated = [], notUpdated = [], captured = 0, checked = 0, total = 0, attachmentsChecked = true } = result;
  const lines = [];
  const capped = total > checked;
  if (notUpdated.length) {
    lines.push("Not updated:", ...notUpdated.slice(0, SHOWN));
    if (notUpdated.length > SHOWN) lines.push(`and ${notUpdated.length - SHOWN} more`);
  }
  if (captured) lines.push(`${plural(captured, "link")} left as written, now found at the new name.`);
  if (capped) lines.push(`Checked only the first ${checked} of ${total} notes.`);
  if (attachmentsChecked === false) lines.push("Attachment links were not checked.");
  const title = `${plural(updated.length, "note")} updated` + (notUpdated.length ? `, ${notUpdated.length} not updated` : "");
  return { title, ...(lines.length && { body: lines.join("\n") }), level: notUpdated.length || captured || capped || attachmentsChecked === false ? "warning" : "success" };
}
