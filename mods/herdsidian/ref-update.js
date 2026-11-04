// Writes a rename's link changes to the listed notes, after the move. A note that fails stays as it was and
// the others go on (AC35); nothing is rolled back. deps is for tests.

import { exec, readTextFile, writeTextFile } from "herdr";
import { buildRewrite, rewriteNote, utf8Length } from "./refs.js";

const real = { exec, readTextFile, writeTextFile };

const AT_ONCE = 8;
// readTextFile rejects above this, so a note written larger could no longer be opened in the app.
const MAX_BYTES = 1048576;
// The full path, because exec uses the person's PATH and a coreutils stat may come first there.
const GUARD_SCRIPT = 'test -w "$1" && /usr/bin/stat -f %z "$1"';

// An atomic replace needs only folder permission, so a read-only note must be refused here. A read that does
// not match the bytes on disk lost something, so writing it back would lose text. Anything unclear is a no.
async function passesGuard(abs, text, deps) {
  const r = await deps.exec("sh", ["-c", GUARD_SCRIPT, "herdsidian", abs]);
  return r.code === 0 && /^\d+\n?$/.test(r.stdout) && Number(r.stdout) === utf8Length(text);
}

// The six steps for one note (plan, Decision 3). It never rejects, so one note cannot stop the others.
async function updateNote(job, ctx, vault, note, deps) {
  const path = ctx.map(note);
  const abs = `${vault}/${path}`;
  const out = { path, wrote: false, missed: false, captured: 0 };
  try {
    const text = await deps.readTextFile(abs);
    if (text === null) return out;
    const next = rewriteNote(ctx, note, text);
    out.captured = next.captured;
    out.missed = next.failed > 0;
    if (next.text === text) return out;
    if (utf8Length(next.text) > MAX_BYTES) {
      out.missed = true;
      return out;
    }
    // The second check is on the same tick as the write call, so no typing can fall between them (AC33).
    if (job.isDirty(path) || !(await passesGuard(abs, text, deps)) || job.isDirty(path)) {
      out.missed = true;
      return out;
    }
    await deps.writeTextFile(abs, next.text, text);
    out.wrote = true;
  } catch {
    out.missed = true;
  }
  return out;
}

// job: { vault, from, to, isDir, list: { notes, total, truncated }, files, isDirty(newRelPath) }
// -> { updated, notUpdated, captured, checked, total, attachmentsChecked }, with new paths, sorted.
export async function updateReferences(job, deps = real) {
  const { vault, from, to, isDir, list, files } = job; // read once: the view can change vault during the run (AC39)
  const ctx = buildRewrite({ from, to, isDir, notes: list.notes, files });
  const results = new Array(list.notes.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < list.notes.length) {
      const at = cursor++;
      results[at] = await updateNote(job, ctx, vault, list.notes[at], deps);
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, list.notes.length) }, worker));
  const paths = (keep) => results.filter(keep).map((r) => r.path).sort();
  return {
    updated: paths((r) => r.wrote),
    notUpdated: paths((r) => r.missed),
    captured: results.reduce((sum, r) => sum + r.captured, 0),
    // All listed notes, also the gone ones: resultMessage() reads checked < total as "over the cap".
    checked: list.notes.length,
    total: list.total,
    // A note rename takes no snapshot and has no attachment link to check (AC45).
    attachmentsChecked: !isDir || Boolean(files),
  };
}
