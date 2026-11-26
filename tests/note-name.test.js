// The Notes name prompt (AC31, AC33, AC36, AC37 and the unit half of AC32, AC34, AC35): the inline row, what
// each way of opening, submitting and closing does, through the real Notes view over an in-memory disk.
// The real disk is in note-name-fs.test.js.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  state,
  fakeCx,
  findById,
  walk,
  settle,
  submitName,
  handler,
  STORE,
} from "./support/sidebar-kit.js";
import { during } from "./support/live-cx.js";

const { default: Notes } = await import("../mods/herdsidian/main.js");
const { ACTION_KEY } = await import("../mods/herdsidian/actions.js");

const VAULT = "/vault";
const NEXT = "/next";
const realWrite = state.writeTextFile;
const realRead = async (path) =>
  path in state.files ? state.files[path] : null;

// The in-memory disk behind exec: folders here, file text in state.files. `gate` holds the first listing or
// existence check, like a slow disk, so a test can change something while Notes still waits.
let disk, writes;
const ok = (stdout = "") => ({ stdout, stderr: "", code: 0 });
const no = (code, stderr = "") => ({ stdout: "", stderr, code });
const inPath = (p, dir) => p === dir || p.startsWith(`${dir}/`);
const paths = () => [...disk.dirs, ...Object.keys(state.files)];
const children = (dir) =>
  paths().filter(
    (p) => p.startsWith(`${dir}/`) && !p.slice(dir.length + 1).includes("/"),
  );

function answer(cmd, args) {
  if (cmd === "awk" || cmd === "git") return ok();
  if (cmd === "sh") {
    const script = args[1];
    if (script.includes("printf %s")) return ok("/state");
    if (script.includes("for p in")) {
      if (!disk.dirs.has(args[3])) return no(1, "no folder");
      return ok(
        children(args[3])
          .map((p) => {
            const name = p.slice(args[3].length + 1);
            return disk.dirs.has(p)
              ? `d\0${name}\0`
              : /\.md$/i.test(name)
                ? `f\0${name}\0`
                : "";
          })
          .join(""),
      );
    }
    return paths().includes(args[3]) ? ok() : no(1);
  }
  if (cmd === "find") {
    if (args[0] === "-H" && args[2] === "-mindepth")
      return disk.dirs.has(args[1])
        ? ok(
            children(args[1])
              .map((p) => `${p}\0`)
              .join(""),
          )
        : no(1, "no folder");
    if (args[0] === "-H")
      return ok(
        Object.keys(state.files)
          .filter((p) => inPath(p, args[1]))
          .map((p) => `${p}\0`)
          .join(""),
      );
    return ok(
      Object.keys(state.files)
        .filter((p) => inPath(p, args[0]) && /\.md$/i.test(p))
        .map((p) => `${p}\n`)
        .join(""),
    );
  }
  return ok();
}

beforeEach(() => {
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
    layout: { id: "root", children: [{ id: "herdsidian", size: { px: 380 } }] },
    readTextFile: realRead,
  });
  writes = [];
  state.writeTextFile = async (path, text, expected) => {
    writes.push(path);
    return realWrite(path, text, expected);
  };
  disk = { dirs: new Set([VAULT]), gate: null };
  state.exec = async (cmd, args = []) => {
    const result = answer(cmd, args);
    const held =
      cmd === "sh" && !args[1].includes("printf %s") ? disk.gate?.() : null;
    if (held) await held;
    return result;
  };
  localStorage.removeItem(`recent:${VAULT}`);
  localStorage.setItem("vault", VAULT);
});

// Puts notes and folders on the disk: { "Docs/a.md": "text", "Docs/Sub": null }. A file's folders appear too.
function seed(tree) {
  for (const [rel, text] of Object.entries(tree)) {
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i++)
      disk.dirs.add(`${VAULT}/${parts.slice(0, i).join("/")}`);
    if (text === null) disk.dirs.add(`${VAULT}/${rel}`);
    else state.files[`${VAULT}/${rel}`] = text;
  }
}

async function mount(tree = {}, { rail = false } = {}) {
  seed(tree);
  if (rail)
    state.layout = {
      id: "root",
      children: [{ id: "herdsidian", size: { px: 44 } }],
    };
  const view = new Notes(),
    cx = fakeCx();
  cx.sleep = async () => {};
  view.init({}, cx);
  view.load(cx);
  await settle();
  return { view, cx, tree: () => during(cx, (live) => view.render(live)) };
}

let requests = 0;
// The tree menu's New note, as the menu surface posts it, then Notes renders it and does the work.
async function menuNewNote(s, path, kind) {
  state.shared[ACTION_KEY] = {
    id: `r${++requests}`,
    at: Date.now(),
    vault: VAULT,
    op: "new-note",
    path,
    kind,
  };
  s.tree();
  await settle();
}

async function press(s, id) {
  const button = findById(s.tree(), id);
  during(s.cx, (live) => button.onClick(null, live));
  await settle();
}

const row = (s) => findById(s.tree(), "notes-new-name");
const textsOf = (node) =>
  walk(node).flatMap((n) => n.kids.filter((k) => typeof k === "string"));
const message = (s) =>
  textsOf(findById(s.tree(), "notes-new-name-message")).join("");
const recents = () =>
  JSON.parse(localStorage.getItem(`recent:${VAULT}`) ?? "[]");
const hold = () => {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let used = false;
  disk.gate = () => (used ? null : ((used = true), held));
  return release;
};

// ---- AC31: the row opens, nothing is written ----

test("AC31 the header New note shows the row at the root, focused, and writes nothing", async () => {
  const s = await mount({ "Docs/a.md": "" });
  assert.equal(row(s), null, "no row before");
  await press(s, "notes-new");
  assert.equal(s.view.actions.naming.dir, "");
  assert.ok(row(s), "the row is drawn");
  assert.ok(textsOf(row(s)).includes("in the vault root"));
  assert.ok(
    s.view.actions.nameInput.calls.some(([name]) => name === "focus"),
    "the input is focused",
  );
  assert.ok(findById(s.tree(), "notes-new-name-close"), "the X is there");
  const order = walk(s.tree()).map((n) => n.nodeId);
  assert.ok(
    order.indexOf("notes-new-name") < order.indexOf("notes-tree"),
    "the row is above the tree",
  );
  assert.deepEqual(writes, []);
  assert.deepEqual(Object.keys(state.files), [`${VAULT}/Docs/a.md`]);
});

test("AC31 the rail New note opens the prompt at the root and writes nothing", async () => {
  const s = await mount({ "Docs/a.md": "" }, { rail: true });
  await press(s, "notes-new-rail");
  assert.equal(s.view.actions.naming.dir, "");
  assert.deepEqual(writes, []);
});

test("AC31 the tree menu on a folder shows the row for that folder", async () => {
  const s = await mount({ "Docs/a.md": "" });
  await menuNewNote(s, "Docs", "dir");
  assert.equal(s.view.actions.naming.dir, "Docs");
  assert.ok(textsOf(row(s)).includes("in Docs"));
  assert.deepEqual(writes, []);
});

test("AC31 the tree menu on the root shows the row for the vault root", async () => {
  const s = await mount({ "Docs/a.md": "" });
  await menuNewNote(s, "", "root");
  assert.equal(s.view.actions.naming.dir, "");
  assert.ok(textsOf(row(s)).includes("in the vault root"));
  assert.deepEqual(writes, []);
});

test("AC31 a second New note moves the row to the new folder and keeps the typed text", async () => {
  const s = await mount({ "Docs/a.md": "" });
  await press(s, "notes-new");
  const first = s.view.actions.naming;
  s.view.actions.nameInput.set_value("Plan");
  await menuNewNote(s, "Docs", "dir");
  assert.equal(s.view.actions.naming.dir, "Docs");
  assert.notEqual(s.view.actions.naming, first, "a new object");
  assert.equal(s.view.actions.nameInput.value(), "Plan");
  assert.ok(textsOf(row(s)).includes("in Docs"));
  assert.deepEqual(writes, []);
});

test("AC31 a bad folder path from the menu shows today's error and no row", async () => {
  const s = await mount({ "a.md": "text" });
  await menuNewNote(s, "a/../..", "dir");
  assert.equal(s.view.actions.naming ?? null, null);
  assert.equal(row(s), null);
  assert.equal(state.toasts.length, 1);
  assert.equal(state.toasts[0].level, "error");
  assert.deepEqual(writes, []);
  await menuNewNote(s, "", "root");
  assert.ok(row(s), "a good path right after still opens the prompt");
});

test("AC31 the row is not drawn in the rail", async () => {
  const s = await mount({}, { rail: true });
  await press(s, "notes-new-rail");
  assert.ok(s.view.actions.naming, "the prompt is open");
  assert.equal(findById(s.tree(), "notes-new-name"), null);
});

// ---- AC32 (unit half): a blank name is today's Untitled ----

test("AC32 submit with an empty name makes the next free Untitled in that folder and opens it in edit mode", async () => {
  const s = await mount({ "Docs/Untitled.md": "" });
  await menuNewNote(s, "Docs", "dir");
  await submitName(s.view, "", s.cx);
  await settle();
  assert.equal(state.files[`${VAULT}/Docs/Untitled 2.md`], "");
  assert.deepEqual([s.view.note, s.view.mode], ["Docs/Untitled 2.md", "edit"]);
  assert.equal(s.view.actions.naming, null);
});

test("AC32 submit with only white space does the same, case-insensitively", async () => {
  const s = await mount({ "UNTITLED.md": "" });
  await press(s, "notes-new");
  await submitName(s.view, "  \t ", s.cx);
  await settle();
  assert.equal(state.files[`${VAULT}/Untitled 2.md`], "");
  assert.deepEqual([s.view.note, s.view.mode], ["Untitled 2.md", "edit"]);
});

// ---- AC33: a typed name ----

test("AC33 a typed name is trimmed and gets .md", async () => {
  const s = await mount({ "Docs/a.md": "" });
  await menuNewNote(s, "Docs", "dir");
  await submitName(s.view, "  Plan  ", s.cx);
  await settle();
  assert.equal(state.files[`${VAULT}/Docs/Plan.md`], "");
  assert.deepEqual([s.view.note, s.view.mode], ["Docs/Plan.md", "edit"]);
});

test("AC33 a name that ends in .md in any case keeps it", async () => {
  const s = await mount();
  await press(s, "notes-new");
  await submitName(s.view, "Plan.MD", s.cx);
  await settle();
  assert.deepEqual(writes, [`${VAULT}/Plan.MD`]);
});

test("AC33 a.txt becomes a.txt.md", async () => {
  const s = await mount();
  await press(s, "notes-new");
  await submitName(s.view, "a.txt", s.cx);
  await settle();
  assert.deepEqual(writes, [`${VAULT}/a.txt.md`]);
});

test("AC33 a name validateName refuses shows the reason, writes nothing and keeps the prompt and the text", async () => {
  const s = await mount();
  await press(s, "notes-new");
  await submitName(s.view, "a/b", s.cx);
  await settle();
  assert.match(message(s), /"\/"/);
  assert.equal(s.view.actions.nameInput.value(), "a/b");
  assert.ok(s.view.actions.naming);
  assert.deepEqual(writes, []);
  assert.equal(s.view.actions.nameBusy, false);
});

test("AC33 a name with a colon shows the reason, writes nothing and keeps the prompt", async () => {
  const s = await mount();
  await press(s, "notes-new");
  await submitName(s.view, "x:y", s.cx);
  await settle();
  assert.equal(message(s), 'The name cannot contain ":"');
  assert.equal(s.view.actions.nameInput.value(), "x:y");
  assert.ok(s.view.actions.naming);
  assert.deepEqual(writes, []);
});

test("AC33 a change of the input clears the reason", async () => {
  const s = await mount();
  await press(s, "notes-new");
  await submitName(s.view, "a/b", s.cx);
  await settle();
  assert.ok(message(s).length > 0);
  s.view.actions.nameInput.set_value("ab");
  s.view.actions.nameInput.fire("change", null, s.cx);
  assert.equal(s.view.actions.nameMessage, null);
  assert.ok(row(s), "the prompt stays");
  assert.doesNotMatch(textsOf(row(s)).join(""), /"\/"/);
});

// ---- AC34 (unit half): a taken name ----

test("AC34 a taken name (any case) shows the inline text, writes nothing and keeps the prompt", async () => {
  const s = await mount({ "Docs/plan.md": "mine" });
  await menuNewNote(s, "Docs", "dir");
  await submitName(s.view, "Plan", s.cx);
  await settle();
  assert.equal(message(s), '"Plan.md" already exists in this folder');
  assert.deepEqual(writes, []);
  assert.equal(state.files[`${VAULT}/Docs/plan.md`], "mine");
  assert.deepEqual(
    Object.keys(state.files),
    [`${VAULT}/Docs/plan.md`],
    "no suffixed copy",
  );
  assert.ok(s.view.actions.naming);
  assert.equal(s.view.actions.nameInput.value(), "Plan");
  assert.equal(s.view.actions.nameBusy, false);
  assert.equal(state.toasts.length, 0);
});

test("AC34 a name taken by a folder is refused the same way", async () => {
  const s = await mount({ "Ideas.md": null });
  await press(s, "notes-new");
  await submitName(s.view, "ideas", s.cx);
  await settle();
  assert.equal(message(s), '"ideas.md" already exists in this folder');
  assert.deepEqual(writes, []);
});

test("AC34 the file appears between the check and the write: the write fails, the file is kept and an error notice is shown", async () => {
  const s = await mount();
  await press(s, "notes-new");
  state.writeTextFile = async (path, text, expected) => {
    writes.push(path);
    state.files[path] = "theirs";
    return realWrite(path, text, expected);
  };
  await submitName(s.view, "Plan", s.cx);
  await settle();
  assert.equal(state.files[`${VAULT}/Plan.md`], "theirs");
  assert.deepEqual(writes, [`${VAULT}/Plan.md`], "one try, no second write");
  assert.deepEqual(Object.keys(state.files), [`${VAULT}/Plan.md`]);
  assert.equal(state.toasts.length, 1);
  assert.match(state.toasts[0].title, /Plan\.md/);
  assert.ok(s.view.actions.naming, "the prompt stays");
});

// ---- AC35 (unit half): one file, and the guards ----

test("AC35 two submits in a row create one file", async () => {
  const s = await mount();
  await press(s, "notes-new");
  s.view.actions.nameInput.set_value("Plan");
  s.view.actions.nameInput.fire("submit", null, s.cx);
  s.view.actions.nameInput.fire("submit", null, s.cx);
  await settle();
  assert.deepEqual(writes, [`${VAULT}/Plan.md`]);
  assert.equal(state.toasts.length, 0);
});

test("AC35 two blank submits in a row create one file", async () => {
  const s = await mount();
  await press(s, "notes-new");
  s.view.actions.nameInput.fire("submit", null, s.cx);
  s.view.actions.nameInput.fire("submit", null, s.cx);
  await settle();
  assert.deepEqual(writes, [`${VAULT}/Untitled.md`]);
});

test("AC35 a vault switch before the write creates nothing and shows today's message", async () => {
  const s = await mount();
  disk.dirs.add(NEXT);
  await press(s, "notes-new");
  const release = hold();
  s.view.actions.nameInput.set_value("Plan");
  s.view.actions.nameInput.fire("submit", null, s.cx);
  s.view.setVault(NEXT, s.cx);
  release();
  await settle();
  assert.deepEqual(writes, []);
  assert.equal(state.toasts.length, 1);
  assert.equal(state.toasts[0].level, "warning");
});

test("AC35 a target folder gone before the write creates nothing and says so", async () => {
  const s = await mount({ "Docs/a.md": "" });
  await menuNewNote(s, "Docs", "dir");
  disk.dirs.delete(`${VAULT}/Docs`);
  delete state.files[`${VAULT}/Docs/a.md`];
  await submitName(s.view, "Plan", s.cx);
  await settle();
  assert.deepEqual(writes, []);
  assert.deepEqual(
    state.toasts.map((t) => t.title),
    ["Docs no longer exists"],
  );
  assert.equal(s.view.actions.naming ?? null, null);
});

test("AC35 a submit then a cancel before the check ends writes nothing", async () => {
  const s = await mount();
  await press(s, "notes-new");
  const release = hold();
  s.view.actions.nameInput.set_value("Plan");
  s.view.actions.nameInput.fire("submit", null, s.cx);
  await press(s, "notes-new-name-close");
  release();
  await settle();
  assert.deepEqual(writes, []);
  assert.equal(s.view.actions.naming ?? null, null);
  assert.equal(state.toasts.length, 0);
  assert.equal(s.view.actions.nameBusy, false);
});

// ---- AC36: the prompt closes and writes nothing ----

test("AC36 Escape closes the prompt and writes nothing", async () => {
  const s = await mount();
  await press(s, "notes-new");
  s.view.actions.nameInput.set_value("Plan");
  const holder = walk(row(s)).find((n) => handler(n, "on_key_down"));
  assert.ok(holder, "a node in the row handles keys");
  during(s.cx, (live) =>
    handler(holder, "on_key_down")({ key: "escape" }, live),
  );
  await settle();
  assert.equal(s.view.actions.naming ?? null, null);
  assert.equal(row(s), null);
  assert.deepEqual(writes, []);
});

test("AC36 the X closes the prompt and writes nothing", async () => {
  const s = await mount();
  await press(s, "notes-new");
  s.view.actions.nameInput.set_value("Plan");
  await press(s, "notes-new-name-close");
  assert.equal(s.view.actions.naming ?? null, null);
  assert.equal(row(s), null);
  assert.deepEqual(writes, []);
});

test("AC36 switching tab closes the prompt, and coming back does not show it", async () => {
  const s = await mount();
  await press(s, "notes-new");
  state.shared[STORE] = { tab: "files" };
  s.tree();
  await settle();
  assert.equal(s.view.actions.naming ?? null, null);
  state.shared[STORE] = { tab: "notes" };
  s.tree();
  await settle();
  assert.equal(row(s), null);
  assert.equal(s.view.actions.naming ?? null, null);
  assert.deepEqual(writes, []);
});

test("AC36 opening a note closes the prompt and writes nothing", async () => {
  const s = await mount({ "a.md": "text" });
  await press(s, "notes-new");
  s.view.open("a.md", s.cx, "read");
  await settle();
  assert.equal(s.view.actions.naming ?? null, null);
  assert.equal(row(s), null);
  assert.deepEqual(writes, []);
});

test("AC36 choosing another vault closes the prompt and writes nothing", async () => {
  const s = await mount();
  disk.dirs.add(NEXT);
  await press(s, "notes-new");
  s.view.setVault(NEXT, s.cx);
  await settle();
  assert.equal(s.view.actions.naming ?? null, null);
  assert.equal(row(s), null);
  assert.deepEqual(writes, []);
});

// ---- AC37: after a create ----

test("AC37 after a create the tree shows the note, its folder opens, the note opens in edit mode and recents update", async () => {
  const s = await mount({ "Docs/a.md": "" });
  await menuNewNote(s, "Docs", "dir");
  s.view.actions.nameInput.set_value("Plan");
  await submitName(s.view, "Plan", s.cx);
  await settle();
  assert.equal(state.files[`${VAULT}/Docs/Plan.md`], "");
  assert.deepEqual(
    [s.view.note, s.view.selected, s.view.mode],
    ["Docs/Plan.md", "Docs/Plan.md", "edit"],
  );
  assert.ok(s.view.folders.has("Docs"));
  assert.ok(s.view.entries.get("Docs").some((e) => e.name === "Plan.md"));
  assert.ok(s.view.all.includes("Docs/Plan.md"));
  assert.ok(recents().includes("Docs/Plan.md"));
  assert.equal(s.view.actions.naming ?? null, null);
  assert.equal(s.view.actions.nameInput.value(), "");
  assert.equal(s.view.actions.nameBusy, false);
  assert.equal(row(s), null);
});
