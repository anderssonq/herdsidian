// The New note name prompt on a real temp vault (AC32 to AC35, critical: data). A typed name never overwrites,
// renames or loses a file: the bytes on disk and every write the mod asks for are checked after each submit.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { state, fakeCx, settle, submitName } from "./support/sidebar-kit.js";
import { during } from "./support/live-cx.js";
import { realHost } from "./support/real-host.js";

const { default: Notes } = await import("../mods/herdsidian/main.js");
const io = await import("../mods/herdsidian/vault-io.js");
// The pure name rules are a new file: when it is missing, each test says so instead of the whole file crashing.
const names = await import("../mods/herdsidian/note-name.js").catch(() => ({}));

const stateHome = process.env.XDG_STATE_HOME;
let root, vault, next, host, writes;

const PNG = Object.freeze([
  0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x0d, 0x0a,
]);
const NFC = "Café",
  NFD = "Café";
const RACER = "written by someone else\n";

function checkNoteName(typed) {
  assert.equal(
    typeof names.checkNoteName,
    "function",
    "note-name.js exports checkNoteName",
  );
  return names.checkNoteName(typed);
}

function makeNamedNote(...args) {
  assert.equal(
    typeof io.makeNamedNote,
    "function",
    "vault-io.js exports makeNamedNote",
  );
  return io.makeNamedNote(...args);
}

const takenText = (name) => `"${name}" already exists in this folder`;

function useHost() {
  host = realHost({ root });
  state.exec = (...args) => host.exec(...args);
  state.readTextFile = (path) => host.readTextFile(path);
  state.writeTextFile = (path, text, previous) => {
    writes.push([path, text, previous]);
    return host.writeTextFile(path, text, previous);
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "herdsidian-name-"));
  vault = `${root}/vault`;
  next = `${root}/next`;
  mkdirSync(vault);
  writes = [];
  // The state folder is under the temp root too, so the real context file is never read or written.
  process.env.XDG_STATE_HOME = `${root}/state`;
  Object.assign(state, {
    shared: {},
    runs: [],
    toasts: [],
    overlays: [],
    closed: [],
    props: {},
    files: {},
    commands: [],
    viewport: null,
    layout: { id: "root", children: [] },
  });
  localStorage.setItem("vault", vault);
  localStorage.removeItem(`recent:${vault}`);
  localStorage.removeItem(`recent:${next}`);
  useHost();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (stateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = stateHome;
});

function put(base, rel, content) {
  const path = `${base}/${rel}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

// Every entry under dir, with its bytes or its link target, sorted: equal snapshots mean nothing on disk changed.
function entries(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name),
      stat = lstatSync(path);
    if (stat.isSymbolicLink()) return [`${name} -> ${readlinkSync(path)}`];
    if (stat.isDirectory())
      return [`${name}/`, ...entries(path).map((e) => `${name}/${e}`)];
    return [`${name}: ${readFileSync(path).toString("base64")}`];
  });
}
const snapshot = (dir) => (existsSync(dir) ? entries(dir).sort() : null);
const disk = () => ({ vault: snapshot(vault), next: snapshot(next) });
const vaultWrites = () =>
  writes.filter(
    ([path]) => path.startsWith(`${vault}/`) || path.startsWith(`${next}/`),
  );
const entry = (rel, bytes = "") =>
  `${rel}: ${Buffer.from(bytes).toString("base64")}`;

// Waits for something real-host does on the real disk. A view that never gets there fails the test.
async function until(done, what) {
  for (let i = 0; i < 250; i++) {
    if (done()) return;
    await settle();
  }
  assert.fail(`never happened: ${what}`);
}

async function mount(files = {}) {
  for (const [rel, content] of Object.entries(files)) put(vault, rel, content);
  const view = new Notes(),
    cx = fakeCx();
  cx.sleep = async () => {};
  view.init({}, cx);
  // The index load runs commands too: wait for it, so a later exec hook sees only the submit's commands.
  await until(
    () => view.entries.has("") && view.index && !view.indexing,
    "the first load and index",
  );
  return { view, cx };
}

// Opens the name prompt for a folder, as the header, the rail or the tree menu does.
function ask(s, dir) {
  assert.equal(
    typeof s.view.actions.askNoteName,
    "function",
    "VaultActions has askNoteName",
  );
  during(s.cx, (live) => s.view.actions.askNoteName(dir, live));
  assert.ok(s.view.actions.naming, "the prompt is open");
}

const submit = (s, text) =>
  during(s.cx, (live) => submitName(s.view, text, live));
const cancel = (s) =>
  during(s.cx, (live) => s.view.actions.cancelNoteName(live));

// The submit's task is over: the busy flag is down, and a few more turns let a stray write land.
async function finished(s) {
  await until(() => s.view.actions.nameBusy === false, "the submit to finish");
  await settle();
  await settle();
}

// Runs `change` once, right after the first command whose output names `marker`: the folder listing.
// Pass an absolute path: the listing prints absolute paths, the note index prints vault-relative ones.
function afterListing(marker, change) {
  let fired = false;
  state.exec = async (...args) => {
    const result = await host.exec(...args);
    if (!fired && String(result?.stdout ?? "").includes(marker)) {
      fired = true;
      change();
    }
    return result;
  };
}

// ---- AC33: the name rules

test("AC33 checkNoteName trims, adds .md once, keeps .MD", () => {
  const cases = Object.freeze([
    ["  Plan  ", "Plan.md"],
    ["Plan", "Plan.md"],
    ["Plan.md", "Plan.md"],
    ["Plan.MD", "Plan.MD"],
    ["My Plan.Md", "My Plan.Md"],
    ["a.txt", "a.txt.md"],
    [`\t${NFC} `, `${NFC}.md`],
  ]);
  for (const [typed, name] of cases)
    assert.deepEqual(
      checkNoteName(typed),
      { kind: "named", name },
      JSON.stringify(typed),
    );
  for (const blank of ["", "   ", "\t \t"])
    assert.deepEqual(
      checkNoteName(blank),
      { kind: "untitled" },
      JSON.stringify(blank),
    );
});

const REFUSED = Object.freeze([
  "a/b",
  "a:b",
  "Plan:",
  ".",
  "..",
  ".hidden",
  "  .hidden  ",
  "node_modules",
  "a\u0001b",
]);

test("AC33 checkNoteName refuses each bad name with its reason", () => {
  for (const bad of REFUSED) {
    const result = checkNoteName(bad);
    assert.equal(result.kind, "refused", JSON.stringify(bad));
    assert.equal(typeof result.reason, "string", JSON.stringify(bad));
    assert.ok(result.reason.length > 0, JSON.stringify(bad));
  }
  assert.match(checkNoteName("a/b").reason, /"\/"/);
  assert.equal(checkNoteName("a:b").reason, 'The name cannot contain ":"');
  assert.equal(checkNoteName("Plan:").reason, 'The name cannot contain ":"');
});

for (const bad of REFUSED) {
  test(`AC33 a refused name or a colon writes nothing: ${JSON.stringify(bad)}`, async () => {
    const s = await mount({ "Docs/a.md": "A\n" });
    ask(s, "Docs");
    const before = disk();
    submit(s, bad);
    await settle();
    await settle();
    assert.deepEqual(vaultWrites(), []);
    assert.deepEqual(disk(), before);
    assert.equal(s.view.actions.nameMessage, checkNoteName(bad).reason);
    assert.ok(s.view.actions.naming, "the prompt stays");
    assert.equal(s.view.actions.nameInput.value(), bad, "the text stays");
  });
}

// ---- AC32: a blank name is today's Untitled

for (const blank of ["", "   "]) {
  test(`AC32 an empty or blank name makes the next free Untitled: ${JSON.stringify(blank)}`, async () => {
    const s = await mount({
      "Docs/Untitled.md": "one\n",
      "Docs/UNTITLED 2.md": "two\n",
      "Docs/Untitled 3.md/inside.md": "in a folder\n",
      "Docs/.hidden": "h",
      "Untitled 4.md": "another folder's\n",
    });
    ask(s, "Docs");
    const before = disk();
    submit(s, blank);
    await until(
      () => existsSync(`${vault}/Docs/Untitled 4.md`),
      "the new note",
    );
    await finished(s);
    assert.deepEqual(vaultWrites(), [
      [`${vault}/Docs/Untitled 4.md`, "", null],
    ]);
    assert.equal(readFileSync(`${vault}/Docs/Untitled 4.md`, "utf8"), "");
    assert.deepEqual(
      disk().vault,
      [...before.vault, entry("Docs/Untitled 4.md")].sort(),
    );
    assert.equal(s.view.note, "Docs/Untitled 4.md");
  });
}

// ---- AC34: a taken name is refused, whatever holds it

const TAKEN = Object.freeze([
  {
    what: "a note",
    typed: "Plan",
    name: "Plan.md",
    setup: () => put(vault, "Docs/Plan.md", "# Plan\n"),
  },
  {
    what: "a file that is not a note",
    typed: "Plan",
    name: "Plan.md",
    setup: () => put(vault, "Docs/Plan.md", Buffer.from(PNG)),
  },
  {
    what: "a folder",
    typed: "Plan",
    name: "Plan.md",
    setup: () => put(vault, "Docs/Plan.md/inside.md", "in\n"),
  },
  {
    what: "a link to nowhere",
    typed: "Plan",
    name: "Plan.md",
    setup: () => symlinkSync(`${root}/nowhere`, `${vault}/Docs/Plan.md`),
  },
  {
    what: "an entry the tree does not show yet",
    typed: "Plan",
    name: "Plan.md",
    late: true,
    setup: () => put(vault, "Docs/Plan.md", "late\n"),
  },
  {
    what: "another case",
    typed: "plan.md",
    name: "plan.md",
    setup: () => put(vault, "Docs/PLAN.MD", "upper\n"),
  },
  {
    what: "an NFD twin of an NFC name",
    typed: NFC,
    name: `${NFC}.md`,
    setup: () => put(vault, `Docs/${NFD}.md`, "nfd\n"),
  },
  {
    what: "an NFC twin of an NFD name",
    typed: NFD,
    name: `${NFD}.md`,
    setup: () => put(vault, `Docs/${NFC}.md`, "nfc\n"),
  },
]);

for (const c of TAKEN) {
  test(`AC34 a taken name is refused for ${c.what}`, async () => {
    put(vault, "Docs/a.md", "A\n");
    if (!c.late) c.setup();
    const s = await mount();
    if (c.late) c.setup();
    ask(s, "Docs");
    const before = disk();
    submit(s, c.typed);
    await finished(s);
    assert.deepEqual(vaultWrites(), [], "no write is even tried");
    assert.deepEqual(disk(), before, "every byte and every entry is the same");
    assert.equal(s.view.actions.nameMessage, takenText(c.name));
    assert.ok(s.view.actions.naming, "the prompt stays");
    assert.equal(s.view.actions.nameInput.value(), c.typed, "the text stays");
    assert.deepEqual(state.toasts, []);
  });
}

test("AC34 no number suffix: a taken name submitted again and again makes nothing", async () => {
  const s = await mount({ "Docs/Plan.md": "# Plan\n" });
  ask(s, "Docs");
  const before = disk();
  for (let i = 0; i < 3; i++) {
    submit(s, "Plan");
    await finished(s);
  }
  assert.deepEqual(vaultWrites(), []);
  assert.deepEqual(disk(), before);
  assert.ok(!existsSync(`${vault}/Docs/Plan 2.md`));
  const direct = await makeNamedNote(`${vault}/Docs`, "plan.md", {
    deps: host,
  });
  assert.equal(direct.ok, false);
  assert.equal(direct.taken, true);
  assert.deepEqual(disk(), before, "makeNamedNote adds no suffix either");
});

// The race: the file appears after the folder was listed. The create-only write must fail and touch nothing.
function recording(deps) {
  const seen = [];
  return {
    seen,
    deps: {
      ...deps,
      writeTextFile: (path, text, previous) => {
        seen.push([path, text, previous]);
        return deps.writeTextFile(path, text, previous);
      },
    },
  };
}

test("AC34 a file that appears before the write stays byte-identical and no other file is made (still)", async () => {
  const dir = `${root}/vault/Docs`;
  put(vault, "Docs/a.md", "A\n");
  const before = snapshot(dir);
  const { seen, deps } = recording(host);
  const still = () => {
    writeFileSync(`${dir}/Plan.md`, RACER);
    return true;
  };
  const result = await makeNamedNote(dir, "Plan.md", { deps, still });
  assert.equal(result.ok, false);
  assert.equal(result.exists, true);
  assert.ok(!result.taken, "it was free when listed");
  assert.equal(readFileSync(`${dir}/Plan.md`, "utf8"), RACER);
  assert.deepEqual(snapshot(dir), [...before, entry("Plan.md", RACER)].sort());
  assert.deepEqual(
    seen,
    [[`${dir}/Plan.md`, "", null]],
    "one create-only write, never a second one",
  );
});

test("AC34 a file that appears before the write stays byte-identical and no other file is made (listing)", async () => {
  const dir = `${root}/vault/Docs`;
  put(vault, "Docs/keep-me.md", "A\n");
  const before = snapshot(dir);
  const { seen, deps } = recording(host);
  let raced = false;
  // The listing answers the old folder; the file lands right after it.
  deps.exec = async (...args) => {
    const result = await host.exec(...args);
    if (!raced && String(result?.stdout ?? "").includes(`${dir}/keep-me.md`)) {
      raced = true;
      writeFileSync(`${dir}/Plan.md`, RACER);
    }
    return result;
  };
  const result = await makeNamedNote(dir, "Plan.md", { deps });
  assert.ok(raced, "the folder was listed");
  assert.equal(result.ok, false);
  assert.equal(result.exists, true);
  assert.equal(readFileSync(`${dir}/Plan.md`, "utf8"), RACER);
  assert.deepEqual(snapshot(dir), [...before, entry("Plan.md", RACER)].sort());
  assert.ok(seen.length <= 1, "never a second write");
  for (const [, , previous] of seen) assert.equal(previous, null);
});

test("AC34 through the prompt, a file that appears before the write is kept, named, and the prompt stays", async () => {
  const s = await mount({ "Docs/a.md": "A\n" });
  ask(s, "Docs");
  const target = `${vault}/Docs/Plan.md`;
  state.writeTextFile = (path, text, previous) => {
    writes.push([path, text, previous]);
    if (path === target) writeFileSync(target, RACER);
    return host.writeTextFile(path, text, previous);
  };
  const before = disk();
  submit(s, "Plan");
  await finished(s);
  assert.equal(readFileSync(target, "utf8"), RACER);
  assert.deepEqual(
    disk().vault,
    [...before.vault, entry("Docs/Plan.md", RACER)].sort(),
  );
  assert.deepEqual(vaultWrites(), [[target, "", null]]);
  assert.equal(s.view.actions.nameMessage, takenText("Plan.md"));
  assert.ok(s.view.actions.naming, "the prompt stays");
  assert.ok(
    state.toasts.some((t) => t.title === takenText("Plan.md")),
    "a notice names the file",
  );
});

// ---- AC35: interleavings

test("AC35 two submits in one turn (named, then blank) make one file", async () => {
  const s = await mount({ "Docs/a.md": "A\n" });
  ask(s, "Docs");
  const before = disk();
  during(s.cx, (live) => {
    submitName(s.view, "Plan", live);
    submitName(s.view, "", live);
  });
  await until(() => existsSync(`${vault}/Docs/Plan.md`), "the note");
  await finished(s);
  assert.deepEqual(vaultWrites(), [[`${vault}/Docs/Plan.md`, "", null]]);
  assert.deepEqual(
    disk().vault,
    [...before.vault, entry("Docs/Plan.md")].sort(),
  );
});

function twoVaults() {
  put(next, "Docs/keep-me.md", "theirs\n");
  return mount({ "Docs/keep-me.md": "mine\n" });
}

function assertDropped(before) {
  assert.deepEqual(vaultWrites(), []);
  assert.deepEqual(disk(), before, "nothing in either vault");
  assert.equal(state.toasts.length, 1);
  assert.equal(state.toasts[0].level, "warning");
  assert.equal(
    state.toasts[0].title,
    "Nothing changed: the vault is no longer vault",
  );
}

test("AC35 a vault switch in the turn of the submit makes nothing", async () => {
  const s = await twoVaults();
  ask(s, "Docs");
  const before = disk();
  submit(s, "Plan");
  s.view.setVault(next, s.cx);
  await finished(s);
  assertDropped(before);
});

test("AC35 a vault switch after the folder was listed, right before the write, makes nothing", async () => {
  const s = await twoVaults();
  ask(s, "Docs");
  const before = disk();
  afterListing(`${vault}/Docs/keep-me.md`, () => s.view.setVault(next, s.cx));
  submit(s, "Plan");
  await finished(s);
  assertDropped(before);
});

test("AC35 a folder gone makes nothing, not even the folder", async () => {
  const s = await mount({ "Docs/a.md": "A\n" });
  ask(s, "Docs");
  rmSync(`${vault}/Docs`, { recursive: true });
  const before = disk();
  submit(s, "Plan");
  await until(() => state.toasts.length > 0, "the notice");
  await finished(s);
  assert.deepEqual(vaultWrites(), []);
  assert.deepEqual(disk(), before);
  assert.ok(!existsSync(`${vault}/Docs`));
  assert.deepEqual(
    state.toasts.map((t) => t.title),
    ["Docs no longer exists"],
  );
});

test("AC35 makeNamedNote in a folder gone writes nothing", async () => {
  put(vault, "keep.md", "K\n");
  const before = disk();
  const { seen, deps } = recording(host);
  const result = await makeNamedNote(`${vault}/Gone/Deeper`, "Plan.md", {
    deps,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(seen, []);
  assert.deepEqual(disk(), before);
});

test("AC35 Escape in the turn of the submit makes nothing", async () => {
  const s = await mount({ "Docs/a.md": "A\n" });
  ask(s, "Docs");
  const before = disk();
  submit(s, "Plan");
  cancel(s);
  await finished(s);
  assert.deepEqual(vaultWrites(), []);
  assert.deepEqual(disk(), before);
  assert.equal(s.view.actions.naming, null);
});

test("AC35 Escape after the folder was listed, right before the write, makes nothing", async () => {
  const s = await mount({ "Docs/keep-me.md": "A\n" });
  ask(s, "Docs");
  const before = disk();
  afterListing(`${vault}/Docs/keep-me.md`, () => cancel(s));
  submit(s, "Plan");
  await finished(s);
  assert.deepEqual(vaultWrites(), []);
  assert.deepEqual(disk(), before);
  assert.equal(s.view.actions.naming, null);
});

test("AC35 a taken name, then the fixed text, makes one file (the busy flag was released)", async () => {
  const s = await mount({ "Docs/Plan.md": "# Plan\n" });
  ask(s, "Docs");
  const before = disk();
  submit(s, "Plan");
  await finished(s);
  assert.equal(s.view.actions.nameMessage, takenText("Plan.md"));
  submit(s, "Plan B");
  await until(() => existsSync(`${vault}/Docs/Plan B.md`), "the fixed note");
  await finished(s);
  assert.deepEqual(vaultWrites(), [[`${vault}/Docs/Plan B.md`, "", null]]);
  assert.deepEqual(
    disk().vault,
    [...before.vault, entry("Docs/Plan B.md")].sort(),
  );
  assert.equal(readFileSync(`${vault}/Docs/Plan.md`, "utf8"), "# Plan\n");
});

test("AC35 a submit after the prompt closed makes nothing", async () => {
  const s = await mount({ "Docs/a.md": "A\n" });
  ask(s, "Docs");
  cancel(s);
  const before = disk();
  submit(s, "Plan");
  assert.equal(
    s.view.actions.nameBusy,
    false,
    "a closed prompt takes no submit",
  );
  await settle();
  await settle();
  assert.deepEqual(vaultWrites(), []);
  assert.deepEqual(disk(), before);
  assert.deepEqual(state.toasts, []);
});
