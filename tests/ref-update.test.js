import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { resultMessage } from "../mods/herdsidian/actions.js";

// ref-update.js imports the herdr runtime, which does not exist under node: resolve it to an empty stub.
const hooks = `
export const resolve = (spec, ctx, next) => spec === "herdr"
  ? { url: "data:text/javascript,export const exec=0,readTextFile=0,writeTextFile=0", shortCircuit: true }
  : next(spec, ctx);`;
register(`data:text/javascript,${encodeURIComponent(hooks)}`);
const { updateReferences } = await import("../mods/herdsidian/ref-update.js");

const VAULT = "/v";
const abs = (rel) => `${VAULT}/${rel}`;
const tick = () => new Promise((done) => setImmediate(done));

// An in-memory disk that acts as Herdr does: the write is a compare-and-swap, and a read-only file is
// still replaced by it, because an atomic replace needs only folder permission. So only the runner's guard
// can protect a read-only note. Disk keys are absolute. `on` holds per-call hooks, and every call is logged.
function fakeDisk(initial, on = {}) {
  const disk = new Map(Object.entries(initial).map(([rel, text]) => [abs(rel), text]));
  const readOnly = new Set();
  const log = { reads: [], writes: [], guards: [] };
  return {
    disk,
    readOnly,
    log,
    readTextFile: async (path) => {
      log.reads.push(path);
      if (on.read) await on.read(path);
      return disk.has(path) ? disk.get(path) : null;
    },
    writeTextFile: async (path, text, expected) => {
      log.writes.push({ path, text, expected });
      if (on.write) await on.write(path);
      if (expected === null ? disk.has(path) : disk.get(path) !== expected) throw new Error("The file changed outside Herdr");
      disk.set(path, text);
    },
    // Runs the script's two parts, so a script with no `test -w` part does not refuse a read-only file.
    exec: async (cmd, args) => {
      const path = args[3];
      log.guards.push(path);
      if (on.guard) {
        const reply = await on.guard(path);
        if (reply) return reply;
      }
      assert.equal(cmd, "sh");
      assert.equal(args[0], "-c");
      if (args[1].includes("test -w") && readOnly.has(path)) return { code: 1, stdout: "", stderr: "" };
      if (!args[1].includes("stat -f %z")) return { code: 0, stdout: "", stderr: "" };
      return { code: 0, stdout: `${Buffer.byteLength(disk.get(path) ?? "")}\n`, stderr: "" };
    },
  };
}

// The job for renaming Old.md, unless the options say otherwise. `notes` are the paths before the rename. A
// renamed note is always listed, as in the app, because a link only changes if it resolved to a listed note.
function jobFor(notes, options = {}) {
  const { from = "Old.md", isDir = false } = options;
  const listed = isDir || notes.includes(from) ? notes : [from, ...notes];
  return {
    vault: VAULT,
    from,
    to: "New.md",
    isDir,
    list: { notes: listed, total: listed.length, truncated: false },
    files: null,
    isDirty: () => false,
    ...options,
  };
}

// A note that links to Old.md, for tests where only the fate of the write matters.
const LINKS = "see [[Old]]\n";
const LINKED = "see [[New]]\n";
const RESULT = { updated: [], notUpdated: [], captured: 0, checked: 0, total: 0, attachmentsChecked: true };

test("all listed notes are read, at new paths, and a note with a link is written", async () => {
  const d = fakeDisk({ "New.md": "x", "a.md": LINKS, "b.md": "no links" });
  const r = await updateReferences(jobFor(["Old.md", "a.md", "b.md"]), d);
  assert.deepEqual([...d.log.reads].sort(), [abs("New.md"), abs("a.md"), abs("b.md")]);
  assert.deepEqual(r, { ...RESULT, updated: ["a.md"], checked: 3, total: 3 });
  assert.equal(d.disk.get(abs("a.md")), LINKED);
});

test("at most 8 notes are in progress at a time, through the whole of each note's steps", async () => {
  const notes = Array.from({ length: 30 }, (_, i) => `n${String(i).padStart(2, "0")}.md`);
  const open = new Set();
  let peak = 0;
  const d = fakeDisk(Object.fromEntries(notes.map((n) => [n, LINKS])), {
    read: async (path) => {
      if (path === abs("New.md")) return; // the renamed note is not on this disk, so it never reaches a write
      open.add(path);
      peak = Math.max(peak, open.size);
      await tick();
    },
    guard: async () => { await tick(); },
    write: async (path) => {
      await tick();
      open.delete(path);
    },
  });
  const r = await updateReferences(jobFor(notes), d);
  assert.equal(peak, 8);
  assert.equal(d.log.reads.length, 31);
  assert.equal(r.updated.length, 30);
});

test("the result does not depend on which note finishes first", async () => {
  const notes = ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md"];
  const initial = { "a.md": LINKS, "b.md": LINKS, "c.md": LINKS, "d.md": LINKS, "e.md": LINKS, "f.md": LINKS };
  const run = async (ticksFor) => {
    const d = fakeDisk(initial, {
      read: async (path) => {
        if (path === abs("b.md") || path === abs("e.md")) throw new Error("cannot read");
        for (let i = ticksFor(path); i > 0; i--) await tick();
      },
    });
    return updateReferences(jobFor(notes), d);
  };
  const leaf = (path) => path.charCodeAt(path.length - 4) - 96;
  const first = await run((path) => leaf(path));
  const last = await run((path) => 10 - leaf(path));
  assert.deepEqual(first, { ...RESULT, updated: ["a.md", "c.md", "d.md", "f.md"], notUpdated: ["b.md", "e.md"], checked: 7, total: 7 });
  assert.deepEqual(last, first);
});

test("notUpdated and updated are sorted by the new path, not the old list's order", async () => {
  const d = fakeDisk({ "a/1.md": "[[z/2]]", "a/2.md": "x", "a/3.md": "[[z/2]]", "b.md": "[[z/2]]", "c.md": "[[z/2]]" }, {
    read: async (path) => { if (path === abs("a/3.md") || path === abs("c.md")) throw new Error("cannot read"); },
  });
  const r = await updateReferences(jobFor(["b.md", "c.md", "z/1.md", "z/2.md", "z/3.md"], { from: "z", to: "a", isDir: true, files: [] }), d);
  assert.deepEqual(r.updated, ["a/1.md", "b.md"]);
  assert.deepEqual(r.notUpdated, ["a/3.md", "c.md"]);
});

test("AC26: a note with no change is not written and goes through no guard", async () => {
  const d = fakeDisk({ "a.md": "no links, [[Other]]\r\n" });
  let dirtyCalls = 0;
  const r = await updateReferences(jobFor(["Old.md", "a.md", "Other.md"], { isDirty: () => { dirtyCalls++; return false; } }), d);
  assert.deepEqual(d.log.writes, []);
  assert.deepEqual(d.log.guards, []);
  assert.equal(dirtyCalls, 0);
  assert.deepEqual(r.updated, []);
  assert.deepEqual(r.notUpdated, []);
});

test("the write holds the old text as expected, once, and every other byte stays", async () => {
  const old = "---\r\nup: [[Old]]\r\n---\r\ncañón 😀 [[Old#h|alias]] and `[[Old]]`\r\n\r\n[t](Old.md \"T\")\n";
  const d = fakeDisk({ "a.md": old });
  const r = await updateReferences(jobFor(["Old.md", "a.md"]), d);
  const text = "---\r\nup: [[Old]]\r\n---\r\ncañón 😀 [[New#h|alias]] and `[[Old]]`\r\n\r\n[t](New.md \"T\")\n";
  assert.deepEqual(d.log.writes, [{ path: abs("a.md"), text, expected: old }]);
  assert.equal(d.disk.get(abs("a.md")), text);
  assert.deepEqual(r.updated, ["a.md"]);
});

test("AC35: a rejected read is not updated, has no other effect, and the others continue", async () => {
  const d = fakeDisk({ "big.md": LINKS, "ok.md": LINKS }, {
    read: async (path) => { if (path === abs("big.md")) throw new Error("Text file exceeds 1 MiB"); },
  });
  const r = await updateReferences(jobFor(["big.md", "ok.md"]), d);
  assert.deepEqual(r.notUpdated, ["big.md"]);
  assert.deepEqual(r.updated, ["ok.md"]);
  assert.equal(d.disk.get(abs("big.md")), LINKS);
  assert.deepEqual(d.log.writes.map((w) => w.path), [abs("ok.md")]);
});

test("AC35: a rejected write is not updated, is not retried, and the others continue", async () => {
  const d = fakeDisk({ "bad.md": LINKS, "ok.md": LINKS }, {
    write: async (path) => { if (path === abs("bad.md")) throw new Error("write failed"); },
  });
  const r = await updateReferences(jobFor(["bad.md", "ok.md"]), d);
  assert.deepEqual(r.notUpdated, ["bad.md"]);
  assert.deepEqual(r.updated, ["ok.md"]);
  assert.equal(d.disk.get(abs("bad.md")), LINKS);
  assert.equal(d.log.writes.filter((w) => w.path === abs("bad.md")).length, 1);
  assert.equal(d.log.reads.filter((p) => p === abs("bad.md")).length, 1);
});

test("AC35: a note changed after the read keeps the newer text, with no retry", async () => {
  const newer = "typed elsewhere [[Old]]\n";
  const d = fakeDisk({ "a.md": LINKS, "ok.md": LINKS }, {
    guard: async (path) => {
      if (path !== abs("a.md")) return null;
      d.disk.set(path, newer);
      return { code: 0, stdout: `${Buffer.byteLength(LINKS)}\n`, stderr: "" };
    },
  });
  const r = await updateReferences(jobFor(["a.md", "ok.md"]), d);
  assert.deepEqual(r.notUpdated, ["a.md"]);
  assert.deepEqual(r.updated, ["ok.md"]);
  assert.equal(d.disk.get(abs("a.md")), newer);
  assert.equal(d.log.writes.filter((w) => w.path === abs("a.md")).length, 1);
});

test("AC35: a read-only note with a link is not written, and the others continue", async () => {
  const d = fakeDisk({ "ro.md": LINKS, "ok.md": LINKS });
  d.readOnly.add(abs("ro.md"));
  const r = await updateReferences(jobFor(["ro.md", "ok.md"]), d);
  assert.deepEqual(r.notUpdated, ["ro.md"]);
  assert.deepEqual(r.updated, ["ok.md"]);
  assert.equal(d.disk.get(abs("ro.md")), LINKS);
  assert.deepEqual(d.log.writes.map((w) => w.path), [abs("ok.md")]);
});

test("a read-only note with no link is not reported", async () => {
  const d = fakeDisk({ "ro.md": "plain" });
  d.readOnly.add(abs("ro.md"));
  const r = await updateReferences(jobFor(["ro.md"]), d);
  assert.deepEqual(r, { ...RESULT, checked: 2, total: 2 });
  assert.deepEqual(d.log.guards, []);
});

test("AC35: a byte count that differs from the read text stops the write", async () => {
  const size = Buffer.byteLength(LINKS);
  for (const stdout of [`${size + 1}\n`, `${size - 1}\n`, "0\n"]) {
    const d = fakeDisk({ "lossy.md": LINKS, "ok.md": LINKS }, {
      guard: async (path) => (path === abs("lossy.md") ? { code: 0, stdout, stderr: "" } : null),
    });
    const r = await updateReferences(jobFor(["lossy.md", "ok.md"]), d);
    assert.deepEqual(r.notUpdated, ["lossy.md"], stdout);
    assert.deepEqual(r.updated, ["ok.md"], stdout);
    assert.equal(d.disk.get(abs("lossy.md")), LINKS);
  }
});

test("the byte count is in bytes: a note with accents and an emoji is written", async () => {
  const d = fakeDisk({ "a.md": "ñandú 😀 €\n[[Old]]\n" });
  const r = await updateReferences(jobFor(["a.md"]), d);
  assert.deepEqual(r.updated, ["a.md"]);
  assert.equal(d.disk.get(abs("a.md")), "ñandú 😀 €\n[[New]]\n");
});

test("a guard that fails or gives an unclear answer stops the write (fail-closed)", async () => {
  const size = Buffer.byteLength(LINKS);
  const replies = [
    { code: 1, stdout: `${size}\n`, stderr: "" },
    { code: 0, stdout: "", stderr: "" },
    { code: 0, stdout: `${size} extra\n`, stderr: "" },
    { code: 0, stdout: `${size}\n${size}\n`, stderr: "" },
    { code: 0, stdout: "not a number", stderr: "" },
    // These read as the right number to Number(), but stat never prints them.
    { code: 0, stdout: `0x${size.toString(16)}\n`, stderr: "" },
    { code: 0, stdout: `  ${size}\n`, stderr: "" },
  ];
  for (const reply of replies) {
    const d = fakeDisk({ "a.md": LINKS, "ok.md": LINKS }, {
      guard: async (path) => (path === abs("a.md") ? reply : null),
    });
    const r = await updateReferences(jobFor(["a.md", "ok.md"]), d);
    assert.deepEqual(r.notUpdated, ["a.md"], JSON.stringify(reply));
    assert.deepEqual(r.updated, ["ok.md"], JSON.stringify(reply));
    assert.equal(d.disk.get(abs("a.md")), LINKS);
  }
});

test("a rejected guard stops the write, and the others continue", async () => {
  const d = fakeDisk({ "a.md": LINKS, "ok.md": LINKS }, {
    guard: async (path) => { if (path === abs("a.md")) throw new Error("spawn failed"); },
  });
  const r = await updateReferences(jobFor(["a.md", "ok.md"]), d);
  assert.deepEqual(r.notUpdated, ["a.md"]);
  assert.deepEqual(r.updated, ["ok.md"]);
  assert.equal(d.disk.get(abs("a.md")), LINKS);
});

// A note of exactly `bytes` bytes that ends in [[Old]], padded with `unit` and then plain `a` for the rest.
function noteOfBytes(bytes, unit) {
  const room = bytes - Buffer.byteLength("[[Old]]");
  const count = Math.floor(room / Buffer.byteLength(unit));
  return `${unit.repeat(count)}${"a".repeat(room - count * Buffer.byteLength(unit))}[[Old]]`;
}

const MAX_BYTES = 1048576;
const GROWS_TO = "Newer.md"; // [[Old]] becomes [[Newer]], 2 bytes more
const PADDINGS = ["a", "é", "€", "😀"];

test("the rewritten text at exactly 1048576 bytes is written", async () => {
  for (const unit of PADDINGS) {
    const d = fakeDisk({ "a.md": noteOfBytes(MAX_BYTES - 2, unit) });
    const r = await updateReferences(jobFor(["a.md"], { to: GROWS_TO }), d);
    const written = d.disk.get(abs("a.md"));
    assert.deepEqual(r.updated, ["a.md"], unit);
    assert.deepEqual(r.notUpdated, [], unit);
    assert.equal(Buffer.byteLength(written), MAX_BYTES, unit);
    assert.equal(written.endsWith("[[Newer]]"), true, unit);
  }
});

test("the rewritten text at 1048577 bytes is not written, the note stays, and the others continue", async () => {
  for (const unit of PADDINGS) {
    const old = noteOfBytes(MAX_BYTES - 1, unit);
    const d = fakeDisk({ "big.md": old, "ok.md": LINKS });
    const r = await updateReferences(jobFor(["big.md", "ok.md"], { to: GROWS_TO }), d);
    assert.deepEqual(r.notUpdated, ["big.md"], unit);
    assert.deepEqual(r.updated, ["ok.md"], unit);
    assert.equal(d.disk.get(abs("big.md")) === old, true, unit);
    assert.deepEqual(d.log.writes.map((w) => w.path), [abs("ok.md")], unit);
  }
});

test("the limit is in bytes: under it in characters and over it in bytes is not written", async () => {
  const old = noteOfBytes(MAX_BYTES - 1, "é");
  assert.equal(old.length + 2 < MAX_BYTES, true);
  const d = fakeDisk({ "a.md": old });
  const r = await updateReferences(jobFor(["a.md"], { to: GROWS_TO }), d);
  assert.deepEqual(r.notUpdated, ["a.md"]);
  assert.deepEqual(r.updated, []);
  assert.deepEqual(d.log.writes, []);
  assert.equal(d.disk.get(abs("a.md")) === old, true);
});

test("null on read: the note is gone, so it is not counted and nothing is created", async () => {
  const d = fakeDisk({ "ok.md": LINKS });
  const dirty = [];
  const r = await updateReferences(jobFor(["gone.md", "ok.md"], { isDirty: (p) => { dirty.push(p); return false; } }), d);
  assert.deepEqual(r, { ...RESULT, updated: ["ok.md"], checked: 3, total: 3 });
  assert.equal(d.disk.has(abs("gone.md")), false);
  assert.deepEqual(dirty, ["ok.md", "ok.md"]);
  assert.equal(resultMessage(r).level, "success");
});

// isDirty gives true only on the given call for the path, so a test sees one dirty check at a time.
function dirtyOnCall(path, call) {
  const seen = { count: 0 };
  return (asked) => {
    if (asked !== path) return false;
    seen.count += 1;
    return seen.count === call;
  };
}

test("AC33: dirty at step 3 (before the guard): no guard, no write, not updated", async () => {
  const d = fakeDisk({ "a.md": LINKS, "ok.md": LINKS });
  const r = await updateReferences(jobFor(["a.md", "ok.md"], { isDirty: dirtyOnCall("a.md", 1) }), d);
  assert.deepEqual(r.notUpdated, ["a.md"]);
  assert.deepEqual(r.updated, ["ok.md"]);
  assert.equal(d.disk.get(abs("a.md")), LINKS);
  assert.deepEqual(d.log.guards, [abs("ok.md")]);
  assert.deepEqual(d.log.writes.map((w) => w.path), [abs("ok.md")]);
});

test("AC33: dirty at step 5 (typing during the guard): no write, not updated", async () => {
  const d = fakeDisk({ "a.md": LINKS, "ok.md": LINKS });
  const r = await updateReferences(jobFor(["a.md", "ok.md"], { isDirty: dirtyOnCall("a.md", 2) }), d);
  assert.deepEqual(r.notUpdated, ["a.md"]);
  assert.deepEqual(r.updated, ["ok.md"]);
  assert.equal(d.disk.get(abs("a.md")), LINKS);
  assert.deepEqual(d.log.guards.filter((p) => p === abs("a.md")), [abs("a.md")]);
  assert.deepEqual(d.log.writes.map((w) => w.path), [abs("ok.md")]);
});

test("AC33: the renamed note itself, when dirty, is not written", async () => {
  const d = fakeDisk({ "New.md": "self [[Old]]\n" });
  const r = await updateReferences(jobFor(["Old.md"], { isDirty: (p) => p === "New.md" }), d);
  assert.deepEqual(r.notUpdated, ["New.md"]);
  assert.deepEqual(r.updated, []);
  assert.deepEqual(d.log.writes, []);
});

test("AC33: a dirty note with no link to change is not reported", async () => {
  const d = fakeDisk({ "a.md": "plain" });
  const r = await updateReferences(jobFor(["a.md"], { isDirty: () => true }), d);
  assert.deepEqual(r, { ...RESULT, checked: 2, total: 2 });
});

test("a throwing isDirty counts as dirty: no write, not updated, the others continue", async () => {
  const d = fakeDisk({ "a.md": LINKS, "ok.md": LINKS });
  const isDirty = (p) => {
    if (p === "a.md") throw new Error("no editor");
    return false;
  };
  const r = await updateReferences(jobFor(["a.md", "ok.md"], { isDirty }), d);
  assert.deepEqual(r.notUpdated, ["a.md"]);
  assert.deepEqual(r.updated, ["ok.md"]);
  assert.equal(d.disk.get(abs("a.md")), LINKS);
});

test("isDirty gets the new path, also for a note in the renamed folder", async () => {
  const d = fakeDisk({ "G/x.md": "[[F/y]]", "G/y.md": "plain", "z.md": "[[F/y]]" });
  const asked = new Set();
  const job = jobFor(["F/x.md", "F/y.md", "z.md"], {
    from: "F", to: "G", isDir: true, files: [],
    isDirty: (p) => { asked.add(p); return false; },
  });
  const r = await updateReferences(job, d);
  assert.deepEqual([...asked].sort(), ["G/x.md", "z.md"]);
  assert.deepEqual(r.updated, ["G/x.md", "z.md"]);
  assert.equal(d.disk.get(abs("G/x.md")), "[[G/y]]");
});

test("AC39: reads, guards and writes use new paths only, under the vault the job started in", async () => {
  const job = jobFor(["F/x.md", "F/y.md", "z.md"], { from: "F", to: "G", isDir: true, files: [] });
  const d = fakeDisk({ "G/x.md": "[[F/y]]", "G/y.md": "plain", "z.md": "[[F/y]]" }, {
    read: async () => { job.vault = "/other"; },
  });
  const r = await updateReferences(job, d);
  const expected = [abs("G/x.md"), abs("G/y.md"), abs("z.md")];
  assert.deepEqual([...d.log.reads].sort(), expected);
  assert.deepEqual([...d.log.guards].sort(), [abs("G/x.md"), abs("z.md")]);
  assert.deepEqual(d.log.writes.map((w) => w.path).sort(), [abs("G/x.md"), abs("z.md")]);
  assert.deepEqual(r.updated, ["G/x.md", "z.md"]);
});

test("AC37: checked and total report the cap, and only listed notes are read and resolved", async () => {
  const d = fakeDisk({ "New.md": "", "a.md": "[[Old]] [[Unlisted]]", "b.md": "plain", "Unlisted.md": "[[Old]]" });
  const list = { notes: ["Old.md", "a.md", "b.md"], total: 7, truncated: true };
  const r = await updateReferences(jobFor([], { list }), d);
  assert.equal(r.checked, 3);
  assert.equal(r.total, 7);
  assert.deepEqual(r.updated, ["a.md"]);
  assert.equal(d.disk.get(abs("a.md")), "[[New]] [[Unlisted]]");
  assert.equal(d.disk.get(abs("Unlisted.md")), "[[Old]]");
  assert.equal(d.log.reads.includes(abs("Unlisted.md")), false);
  assert.match(resultMessage(r).body, /first 3 of 7 notes/);
});

test("AC46: a folder rename with files:null leaves attachment links and says they were not checked", async () => {
  const text = "![[att/shot.png]] [[att/x]]\n";
  const d = fakeDisk({ "a.md": text });
  const r = await updateReferences(jobFor(["a.md", "att/x.md"], { from: "att", to: "media", isDir: true, files: null }), d);
  assert.equal(r.attachmentsChecked, false);
  assert.equal(d.disk.get(abs("a.md")), "![[att/shot.png]] [[media/x]]\n");
  assert.deepEqual(r.updated, ["a.md"]);
  assert.match(resultMessage(r).body, /Attachment links were not checked/);
});

test("AC40: a folder rename with a file list changes attachment links and says they were checked", async () => {
  const d = fakeDisk({ "a.md": "![[att/shot.png]]\n" });
  const r = await updateReferences(jobFor(["a.md"], { from: "att", to: "media", isDir: true, files: ["a.md", "att/shot.png"] }), d);
  assert.equal(r.attachmentsChecked, true);
  assert.equal(d.disk.get(abs("a.md")), "![[media/shot.png]]\n");
});

test("an empty file list still counts as checked", async () => {
  const d = fakeDisk({ "a.md": "plain" });
  const r = await updateReferences(jobFor(["a.md"], { from: "att", to: "media", isDir: true, files: [] }), d);
  assert.equal(r.attachmentsChecked, true);
});

test("AC45: a note rename takes no snapshot, so it gives no attachment warning", async () => {
  const d = fakeDisk({ "a.md": LINKS });
  const r = await updateReferences(jobFor(["a.md"], { files: null }), d);
  assert.equal(r.attachmentsChecked, true);
  assert.equal(resultMessage(r).level, "success");
});

// `![[att/shot.png]]` from the root matches a file in two folders, so that link fails (AC41), and the note link changes.
const MIXED = {
  text: "![[att/shot.png]] [[a/att/x]]\n",
  next: "![[att/shot.png]] [[a/media/x]]\n",
  job: (options = {}) => jobFor(["n.md", "a/att/x.md"], {
    from: "a/att", to: "a/media", isDir: true, files: ["a/att/shot.png", "b/att/shot.png"], ...options,
  }),
};

test("a note with one change and one failure is written and is in both lists", async () => {
  const d = fakeDisk({ "n.md": MIXED.text });
  const r = await updateReferences(MIXED.job(), d);
  assert.deepEqual(r.updated, ["n.md"]);
  assert.deepEqual(r.notUpdated, ["n.md"]);
  assert.equal(d.disk.get(abs("n.md")), MIXED.next);
});

test("a note with one change and one failure that cannot be written is once in notUpdated only", async () => {
  const d = fakeDisk({ "n.md": MIXED.text });
  const r = await updateReferences(MIXED.job({ isDirty: () => true }), d);
  assert.deepEqual(r.updated, []);
  assert.deepEqual(r.notUpdated, ["n.md"]);
  assert.equal(d.disk.get(abs("n.md")), MIXED.text);
});

test("a note with only a failed link is not written and is in notUpdated", async () => {
  const text = "![[att/shot.png]]\n";
  const d = fakeDisk({ "n.md": text });
  const r = await updateReferences(MIXED.job(), d);
  assert.deepEqual(r.updated, []);
  assert.deepEqual(r.notUpdated, ["n.md"]);
  assert.deepEqual(d.log.writes, []);
  assert.equal(d.disk.get(abs("n.md")), text);
});

test("AC32: captured links add up across notes, also in a note that could not be written", async () => {
  const captures = "[[New]]\n";
  const dirty = "[[New]] [[Old]]\n";
  const d = fakeDisk({ "a/x.md": captures, "a/y.md": dirty, "a/New.md": "", "other/New.md": "" });
  const notes = ["a/Old.md", "a/x.md", "a/y.md", "other/New.md"];
  const r = await updateReferences(jobFor(notes, { from: "a/Old.md", to: "a/New.md", isDirty: (p) => p === "a/y.md" }), d);
  assert.equal(r.captured, 2);
  assert.deepEqual(r.notUpdated, ["a/y.md"]);
  assert.deepEqual(d.log.writes, []);
  assert.equal(d.disk.get(abs("a/x.md")), captures);
  assert.equal(d.disk.get(abs("a/y.md")), dirty);
});

test("AC38: a case-only rename writes no note", async () => {
  const d = fakeDisk({ "a.md": LINKS, "old.md": "x" });
  const r = await updateReferences(jobFor(["a.md", "Old.md"], { from: "Old.md", to: "old.md" }), d);
  assert.deepEqual(d.log.writes, []);
  assert.deepEqual(r.updated, []);
  assert.deepEqual(r.notUpdated, []);
});

test("a note whose only change is a link that stays is in notUpdated, and the message warns", async () => {
  const d = fakeDisk({ "a.md": "[t](Old)\n", "b.md": "[[https://a.com/Old]]\n" });
  const r = await updateReferences(jobFor(["a.md", "b.md"]), d);
  assert.deepEqual(r.notUpdated, ["a.md", "b.md"]);
  assert.deepEqual(d.log.writes, []);
  const message = resultMessage(r);
  assert.equal(message.level, "warning");
  assert.match(message.body, /Not updated:\na\.md\nb\.md/);
});

test("an empty list gives an empty result", async () => {
  const d = fakeDisk({});
  const r = await updateReferences(jobFor([], { from: "F", to: "G", isDir: true, files: [] }), d);
  assert.deepEqual(r, RESULT);
  assert.deepEqual(d.log.reads, []);
});
