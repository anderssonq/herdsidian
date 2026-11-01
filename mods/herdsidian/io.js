// The shell and file side of the graph and the agent context: the state folder, the
// context file (read, then saved with a stale-snapshot retry), the chunked awk index
// and the git top folder. All parsing and merging lives in graph.js and context.js.

import { exec, readTextFile, writeTextFile } from "herdr";
import { INDEX_AWK, chunks, parseIndexOutput } from "./graph.js";
import { parseContext, serializeContext, applyChange } from "./context.js";

const FILE = "context.json";
const TRIES = 3;

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
    if (previous === null) {
      const made = await run("mkdir", ["-p", dir]);
      if (made.code !== 0) throw new Error(`${ERR}: ${made.stderr || "cannot create the folder"}`);
    }
    const doc = applyChange(parsed.doc, change, where, liveSpaceIds);
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
