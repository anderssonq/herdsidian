// The shell and file side of the graph and the agent context: the state folder, the
// context file (read, then saved with a stale-snapshot retry), the chunked awk index
// and the git top folder. All parsing and merging lives in graph.js and context.js.

import { exec, readTextFile, writeTextFile } from "herdr";
import { HIDDEN } from "./notes.js";
import { INDEX_AWK, chunks, parseIndexOutput } from "./graph.js";
import { parseContext, serializeContext, applyChange } from "./context.js";

const FILE = "context.json";
const TRIES = 3;

// The last notes opened in the reader of one vault (suggestion source b).
export const recentOf = (vault) => {
  try { const list = JSON.parse(localStorage.getItem(`recent:${vault}`) ?? "[]"); return Array.isArray(list) ? list : []; } catch { return []; }
};

// The one writer of a vault's recent notes.
export const storeRecent = (vault, list) => localStorage.setItem(`recent:${vault}`, JSON.stringify(list));

// Where the context file lives: ${XDG_STATE_HOME:-$HOME/.local/state}/herdsidian.
export async function stateDir() {
  const r = await exec("sh", ["-c", 'printf %s "${XDG_STATE_HOME:-$HOME/.local/state}"']);
  if (r.code !== 0 || !r.stdout) throw new Error(r.stderr || "Cannot find the state folder");
  return `${r.stdout}/herdsidian`;
}

// Reads the context file. Never writes and never moves an invalid file.
export async function loadContext(dir) {
  const text = await readTextFile(`${dir}/${FILE}`).catch(() => null);
  return { ...parseContext(text), text };
}

const ERR = "Cannot save the agent context";
const real = { exec, readTextFile, writeTextFile };

// Applies one change under a compare-and-swap write: re-read, apply, write against what was read.
// A stale snapshot starts over, up to 3 tries. Returns the written doc. deps is for tests.
// Only a link may move an invalid file aside; an unsupported (newer) file is never touched.
export async function saveContext(dir, change, where, liveSpaceIds, deps = real) {
  const { exec: run, readTextFile: read, writeTextFile: write } = deps;
  const file = `${dir}/${FILE}`;
  let last = null;
  for (let i = 0; i < TRIES; i++) {
    const text = await read(file).catch(() => null);
    let parsed = parseContext(text);
    let previous = text;
    if (parsed.status === "unsupported") throw new Error(`${ERR}: the context file is from a newer Herdsidian`);
    if (parsed.status === "invalid") {
      if (change.type !== "link") throw new Error(`${ERR}: the context file is invalid; link a note to start a new one`);
      const moved = await run("mv", [file, `${file}.invalid-${Date.now()}`]);
      if (moved.code !== 0) {
        // Another window may have moved it already: read again and continue.
        const again = parseContext(await read(file).catch(() => null));
        if (again.status !== "invalid") continue;
        throw new Error(`${ERR}: ${moved.stderr || "cannot move the invalid file"}`);
      }
      parsed = parseContext(null);
      previous = null;
    }
    const paths = change.type === "rename-paths" || change.type === "remove-paths";
    // A path change has nothing to fix in a missing file: no folder and no write.
    if (paths && previous === null) return parsed.doc;
    if (previous === null) {
      const made = await run("mkdir", ["-p", dir]);
      if (made.code !== 0) throw new Error(`${ERR}: ${made.stderr || "cannot create the folder"}`);
    }
    const doc = applyChange(parsed.doc, change, where, liveSpaceIds);
    if (paths && doc === parsed.doc) return doc;
    try {
      await write(file, serializeContext(doc), previous);
      return doc;
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`${ERR}: ${last ? last.message ?? last : "the context file kept changing"}`);
}

// Links of every note: one awk call per chunk of files, merged into one Map.
export async function indexNotes(vault, files) {
  const raw = new Map();
  for (const chunk of chunks(files)) {
    const r = await exec("awk", [INDEX_AWK, ...chunk], { cwd: vault });
    if (r.code !== 0 && !r.stdout) throw new Error(r.stderr || "Cannot index links");
    for (const [path, entry] of parseIndexOutput(r.stdout)) raw.set(path, entry);
  }
  return raw;
}

export const MAX_NOTES = 5000;

// The -name args of the pruned folders, shared with the file operations that must skip them.
export const PRUNE = [...HIDDEN].flatMap((n, i) => [...(i ? ["-o"] : []), "-name", n]);

// Every note in the vault, as paths relative to it, capped at MAX_NOTES: { notes, total, truncated }.
// total counts all the notes found, so the cap can be shown. deps is for tests.
export async function listNotes(vault, deps = { exec }) {
  const r = await deps.exec("find", [vault, "(", ...PRUNE, ")", "-prune", "-o", "-type", "f", "-iname", "*.md", "-print"]);
  // find exits 1 on an unreadable subfolder yet still lists the rest: only no output at all is an error.
  if (r.code !== 0 && !r.stdout.trim()) throw new Error(r.stderr || "Cannot list the vault");
  const found = r.stdout.split("\n").filter(Boolean).map((p) => p.slice(vault.length + 1)).sort();
  return { notes: found.slice(0, MAX_NOTES), total: found.length, truncated: found.length > MAX_NOTES };
}

// The notes only, for callers that do not show the cap.
export async function allNotes(vault, deps = { exec }) {
  return (await listNotes(vault, deps)).notes;
}

// The one-line notice for a capped list, or null when every note was indexed.
export const capNotice = ({ notes, total, truncated }) => (truncated ? `Indexed the first ${notes.length} of ${total} notes` : null);

// The wait before the next watch retry: 1 s after the first failure, doubling, at most 30 s.
export const backoffMs = (failures) => Math.min(30_000, 1000 * 2 ** Math.max(0, failures - 1));

// Whether a watcher batch (absolute paths) may have changed the note. An empty or unknown list says
// nothing, so it counts; a reported folder counts for the notes inside it (a rename reports the folder).
export function touches(changed, vault, note) {
  if (!changed || changed.length === 0) return true;
  // A symlinked vault may be reported by its real path: then nothing can be matched, so re-read.
  if (!underVault(changed, vault)) return true;
  const abs = `${vault}/${note}`;
  return changed.some((p) => {
    const dir = p.replace(/\/+$/, "");
    return dir === abs || dir === vault || abs.startsWith(`${dir}/`);
  });
}

// What the first successful watch after `failures` failed ones must do: changes made during the
// outage were never reported, so reload everything and drop the watch error.
export const afterOutage = (failures) => failures > 0;

// Whether some reported path is the vault or inside it. False for the real paths of a symlinked vault.
export const underVault = (changed, vault) => changed.some((p) => p === vault || p.startsWith(`${vault}/`));

// When a note was last changed, in ms since the epoch; null when it cannot be read.
// BSD/macOS `stat -f %m` first; on GNU/Linux that is a filesystem query, so fall back to `stat -c %Y`.
export async function noteTime(abs, deps = { exec }) {
  for (const args of [["-f", "%m", abs], ["-c", "%Y", abs]]) {
    try {
      const r = await deps.exec("stat", args);
      const out = r.stdout.trim();
      const secs = Number(out);
      if (r.code === 0 && /^\d+$/.test(out) && Number.isFinite(secs)) return secs * 1000;
    } catch {
      // Try the next form.
    }
  }
  return null;
}

// The repository folder of a cwd, or null when it is not in one (or git is missing).
export async function gitTop(cwd) {
  if (!cwd) return null;
  try {
    const r = await exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
    return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}
