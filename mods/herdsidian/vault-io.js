// The disk side of the tree's right-click actions: list, count, create, move and trash. Every call
// takes absolute paths as arguments (never in a shell string), so any name is safe (AC64). Nothing
// here deletes for good: a delete is the Trash through the host (AC49). deps is for tests.

import { exec, writeTextFile } from "herdr";
import { PRUNE } from "./io.js";
import { dirOf, leafOf } from "./notes.js";
import { nextUntitled, folderCounts, isSameItem } from "./actions.js";
import { utf8Length } from "./refs.js";

const real = { exec, writeTextFile };

// The exec limit is 8 MiB; a list at or over this is cut short, so it cannot be trusted (AC41, AC46).
const LIMIT = 8 * 1024 * 1024 - 1024;

const MOVE = 'sh';
const MOVE_SCRIPT = [
  '{ [ -e "$1" ] || [ -L "$1" ]; } || exit 3',
  '{ [ -e "$2" ] || [ -L "$2" ]; } && exit 4',
  '/bin/mv -n "$1" "$2" || exit 1',
  '{ [ ! -e "$1" ] && [ ! -L "$1" ]; } || exit 5',
  '{ [ -e "$2" ] || [ -L "$2" ]; } || exit 5',
].join("\n");
const EXISTS_SCRIPT = '[ -e "$1" ] || [ -L "$1" ]';

export const why = (e) => e?.message ?? String(e);
const absolute = (p) => typeof p === "string" && p.startsWith("/") && !p.includes("\0");
const trim = (p) => p.replace(/\/+$/, "");
const big = (s) => s.length * 3 >= LIMIT && utf8Length(s) >= LIMIT;

// A failed or throwing exec is a non-zero code, so every caller has one failure path.
async function run(deps, cmd, args) {
  try {
    const r = await deps.exec(cmd, args);
    return { code: r.code, stdout: typeof r.stdout === "string" ? r.stdout : "", stderr: typeof r.stderr === "string" ? r.stderr : "" };
  } catch (e) {
    return { code: -1, stdout: "", stderr: why(e) };
  }
}

// The paths of a find -print0 run, or null: a non-zero exit, a cut or an unterminated list.
function nulList(r) {
  if (r.code !== 0 || big(r.stdout)) return null;
  if (!r.stdout) return [];
  return r.stdout.endsWith("\0") ? r.stdout.slice(0, -1).split("\0") : null;
}

// The entry names in a folder, hidden ones too. Throws when the folder cannot be read.
export async function listNames(absDir, deps = real) {
  if (!absolute(absDir)) throw new Error("The folder path is not valid");
  const r = await run(deps, "find", ["-H", absDir, "-mindepth", "1", "-maxdepth", "1", "-print0"]);
  const list = nulList(r);
  if (!list) throw new Error(r.stderr.trim() || "Cannot list the folder");
  return list.map(leafOf);
}

// Whether the path is on disk, a broken link included. Throws when that cannot be told.
export async function exists(abs, deps = real) {
  if (!absolute(abs)) throw new Error("The path is not valid");
  const r = await run(deps, "sh", ["-c", EXISTS_SCRIPT, "herdsidian", abs]);
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  throw new Error(r.stderr.trim() || "Cannot check the path");
}

// Counts for the delete dialog, or null when find fails or is cut (AC48). No -H: a link to a folder
// is one entry, so the dialog never counts what the link points to.
export async function countFolder(abs, deps = real) {
  if (!absolute(abs) || !trim(abs)) return null;
  const path = trim(abs);
  const list = nulList(await run(deps, "find", [path, "!", "-type", "d", "-print0"]));
  if (!list) return null;
  const leaf = leafOf(path);
  return folderCounts(list.map((p) => leaf + p.slice(path.length)), leaf);
}

// Every file under the vault as relative paths, hidden folders skipped; null when it cannot be trusted (AC41, AC46).
export async function snapshotFiles(vault, deps = real) {
  if (!absolute(vault) || !trim(vault)) return null;
  const root = trim(vault);
  const list = nulList(await run(deps, "find", ["-H", root, "(", ...PRUNE, ")", "-prune", "-o", "!", "-type", "d", "-print0"]));
  return list ? list.map((p) => p.slice(root.length + 1)) : null;
}

// mkdir with no -p: the parent must exist and the name must be free (AC12, AC60).
export async function makeFolder(abs, deps = real) {
  if (!absolute(abs) || !trim(abs)) return { ok: false, reason: "The path is not valid" };
  const r = await run(deps, "mkdir", [trim(abs)]);
  return r.code === 0 ? { ok: true, reason: null } : { ok: false, reason: r.stderr.trim() || "Cannot create the folder" };
}

// An empty note with the first free Untitled name. The folder is read first, so a missing parent fails
// there and nothing is created; writeTextFile with null previous never replaces a file (AC9, AC10, AC60).
export async function makeNote(absDir, deps = real) {
  try {
    const dir = trim(absDir);
    const name = nextUntitled(await listNames(dir, deps));
    await deps.writeTextFile(`${dir}/${name}`, "", null);
    return { ok: true, name, reason: null };
  } catch (e) {
    return { ok: false, name: null, reason: why(e) };
  }
}

const MOVE_REASONS = {
  3: "The item no longer exists",
  4: "An item with that name already exists",
  5: "The move could not be confirmed",
};

// Moves src to a free dst. Code 3: src is gone. Code 4: dst is taken. Never overwrites and never moves
// into an existing folder, because dst is checked before and mv -n runs only on a free name (AC17, AC18, AC60, AC61).
export async function moveItem(src, dst, deps = real) {
  if (!absolute(src) || !absolute(dst) || src === dst) return { ok: false, code: 1, reason: "The path is not valid" };
  const r = await run(deps, MOVE, ["-c", MOVE_SCRIPT, "herdsidian", src, dst]);
  if (r.code === 0) return { ok: true, code: 0, reason: null };
  return { ok: false, code: r.code, reason: MOVE_REASONS[r.code] ?? (r.stderr.trim() || "Cannot move the item") };
}

// A rename that changes only the case or the Unicode form, in the same folder (AC19). It needs a plain
// mv, which overwrites, so it first checks on the disk that nothing has the exact new name.
export async function moveSameItem(src, dst, deps = real) {
  const bad = (code, reason) => ({ ok: false, code, reason });
  if (!absolute(src) || !absolute(dst) || dirOf(src) !== dirOf(dst) || !isSameItem(leafOf(src), leafOf(dst))) {
    return bad(1, "The path is not valid");
  }
  const dir = dirOf(src), from = leafOf(src), to = leafOf(dst);
  try {
    const before = await listNames(dir, deps);
    if (!before.includes(from)) return bad(3, MOVE_REASONS[3]);
    if (before.includes(to)) return bad(4, MOVE_REASONS[4]);
    const r = await run(deps, "/bin/mv", [src, dst]);
    if (r.code !== 0) return bad(1, r.stderr.trim() || "Cannot move the item");
    const after = await listNames(dir, deps);
    return after.includes(to) && !after.includes(from) ? { ok: true, code: 0, reason: null } : bad(5, MOVE_REASONS[5]);
  } catch (e) {
    return bad(1, why(e));
  }
}

// To the Trash through the host. Exit 0 alone proves nothing, so the item must be gone (AC49, AC50).
// trash has no -- support: the path is absolute, so it cannot look like an option.
export async function trashItem(abs, deps = real) {
  const bad = (reason) => ({ ok: false, reason });
  if (!absolute(abs) || !trim(abs)) return bad("The path is not valid");
  const path = trim(abs);
  try {
    if (!(await exists(path, deps))) return bad("The item no longer exists");
    const r = await run(deps, "/usr/bin/trash", ["-s", path]);
    if (r.code !== 0) return bad(r.stderr.trim() || "Cannot move the item to the Trash");
    if (await exists(path, deps)) return bad("The item is still there after the Trash call");
    return { ok: true, reason: null };
  } catch (e) {
    return bad(why(e));
  }
}
