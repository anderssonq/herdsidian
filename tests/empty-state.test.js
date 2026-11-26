// The centered empty state of the Changes and Git tabs (E2, AC40 to AC43): the shared helper, the three states that
// use it in each tab, and the guarantee that drawing it runs no command. Written from the spec, through the real tabs.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reset, mountGit, fakeRepo, deferred, state, findById, walk, settle } from "./support/git-kit.js";
import { mount, fakeGit, world } from "./support/changes-kit.js";
import { tokens } from "../mods/herdsidian/tokens.js";

// Dynamic: the stubs are registered when the kits above run, which is after static imports are resolved.
const { emptyState } = await import("../mods/herdsidian/empty-state-view.js");

beforeEach(reset);

const ICON = "mods/herdsidian/git-branch.svg";
const NO_REPO = "Not a git repository";
const NO_REPO_HINT = "Run git init in a terminal here to see changes and history.";
const NO_FOLDER_HINT = "Focus a terminal pane that has a working folder.";

// A theme with a different "#rrggbb" per key, so a wrong key shows in a value compare.
const COLORS = new Map();
const THEME = new Proxy({}, {
  get: (_t, key) => {
    if (typeof key !== "string" || key === "then") return undefined;
    if (!COLORS.has(key)) COLORS.set(key, `#${((COLORS.size * 0x1f3b5 + 0x102030) % 0xffffff).toString(16).padStart(6, "0")}`);
    return COLORS.get(key);
  },
});

const styleOf = (node, name) => node?.calls.findLast(([n]) => n === name)?.[1][0];
const called = (node, name) => Boolean(node?.calls.some(([n]) => n === name));
const textsOf = (node) => walk(node).flatMap((n) => n.kids.filter((k) => typeof k === "string"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, what) {
  for (let i = 0; i < 100; i++) {
    const value = await check();
    if (value) return value;
    await sleep(15);
  }
  assert.fail(`timed out waiting for ${what}`);
}

// ---- AC40: the helper ----

test("AC40 the block is centered on both axes of the tab body", () => {
  const block = emptyState(THEME, tokens(THEME), { icon: ICON, title: "Title" });
  assert.equal(block.nodeId, "empty-state");
  for (const name of ["flex_1", "items_center", "justify_center"]) assert.ok(called(block, name), name);
  assert.equal(styleOf(block, "min_h"), 0);
  assert.ok(called(block, "text_center"), "its text is centered");
});

test("AC40 the tile is 40 px, rounded, with the pill fill and the theme border", () => {
  const t = THEME, k = tokens(t);
  const tile = walk(emptyState(t, k, { icon: ICON, title: "Title" })).find((n) => styleOf(n, "bg") === k.pill);
  assert.ok(tile, "a node has the pill fill");
  assert.notEqual(k.pill, t.border, "the stub tells the two apart");
  assert.equal(styleOf(tile, "border_color"), t.border);
  assert.ok(styleOf(tile, "border") >= 1 || called(tile, "border_1"), "a border is drawn");
  assert.ok(called(tile, "rounded"), "rounded");
  assert.equal(styleOf(tile, "size") ?? styleOf(tile, "w"), 40);
});

test("AC40 the icon is the given one-color svg, 18 px, in t.muted", () => {
  const t = THEME;
  const icons = walk(emptyState(t, tokens(t), { icon: ICON, title: "Title" })).filter((n) => n.kind === "svg");
  assert.equal(icons.length, 1);
  assert.equal(icons[0].arg, ICON);
  assert.equal(styleOf(icons[0], "size"), 18);
  assert.equal(styleOf(icons[0], "text_color"), t.muted);
});

test("AC40 the title is 13 px, weight 500, in t.foreground", () => {
  const t = THEME;
  const title = findById(emptyState(t, tokens(t), { icon: ICON, title: "Not here" }), "empty-state-title");
  assert.deepEqual(textsOf(title), ["Not here"]);
  assert.equal(styleOf(title, "text_size"), 13);
  assert.equal(styleOf(title, "font_weight"), 500);
  assert.equal(styleOf(title, "text_color"), t.foreground);
});

test("AC40 the detail is monospace 11.5 px in t.muted and the hint 12 px in t.muted", () => {
  const t = THEME;
  const tree = emptyState(t, tokens(t), { icon: ICON, title: "T", detail: "/work/plain", hint: "Do this." });
  const detail = findById(tree, "empty-state-detail"), hint = findById(tree, "empty-state-hint");
  assert.deepEqual(textsOf(detail), ["/work/plain"]);
  assert.equal(styleOf(detail, "text_size"), 11.5);
  assert.equal(styleOf(detail, "text_color"), t.muted);
  assert.equal(styleOf(detail, "font_family"), "Menlo");
  assert.deepEqual(textsOf(hint), ["Do this."]);
  assert.equal(styleOf(hint, "text_size"), 12);
  assert.equal(styleOf(hint, "text_color"), t.muted);
});

test("AC40 the detail and the hint are drawn only when given", () => {
  const t = THEME, k = tokens(t);
  const bare = emptyState(t, k, { icon: ICON, title: "Only a title" });
  assert.equal(findById(bare, "empty-state-detail"), null);
  assert.equal(findById(bare, "empty-state-hint"), null);
  const detailOnly = emptyState(t, k, { icon: ICON, title: "T", detail: "/x" });
  assert.ok(findById(detailOnly, "empty-state-detail"));
  assert.equal(findById(detailOnly, "empty-state-hint"), null);
  const hintOnly = emptyState(t, k, { icon: ICON, title: "T", hint: "h" });
  assert.equal(findById(hintOnly, "empty-state-detail"), null);
  assert.ok(findById(hintOnly, "empty-state-hint"));
});

test("AC40 every color is a theme value or a token: no hex and no t.dim in the block", () => {
  const t = THEME, k = tokens(t);
  const tree = emptyState(t, k, { icon: ICON, title: "T", detail: "/x", hint: "h" });
  const allowed = new Set([...Object.values(k), ...COLORS.values()]); // COLORS holds every theme key the block read
  const colors = walk(tree).flatMap((n) => n.calls.filter(([name]) => /color$|^bg$/.test(name)).map(([name, args]) => [name, args[0]]));
  assert.ok(colors.length >= 5, "the block sets colors");
  for (const [name, value] of colors) assert.ok(allowed.has(value), `${name} ${value} comes from the theme or tokens`);
  assert.ok(!colors.some(([name, value]) => name === "text_color" && value === t.dim), "no t.dim text");
});

// ---- AC43: the icon file ----

test("AC43 git-branch.svg is a one-color icon that svg() can draw", () => {
  const text = readFileSync(new URL("../mods/herdsidian/git-branch.svg", import.meta.url), "utf8");
  assert.match(text, /<svg[^>]*stroke="currentColor"/);
  assert.match(text, /<path /);
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(text), false, "no color literal");
  assert.equal(/fill="(?!none)/.test(text), false, "no fill color");
});

// ---- AC41: Changes ----

// A scene for Changes: a space whose folder is `folder` (none: no folder), the fake git, the tab mounted and read.
async function changes({ folder = "/work/plain", git = {}, hold = false } = {}) {
  Object.assign(world, { spaces: folder ? [{ id: "s1", active: true, folder }] : [], panes: [], focused: null });
  state.shared["herdsidian.sidebar"] = { tab: "changes" };
  const fake = fakeGit(git);
  if (git.reject) state.exec = async () => { throw new Error("git did not run"); };
  if (hold) state.exec = () => new Promise(() => {});
  const m = mount();
  m.render();
  await settle();
  await settle();
  return { m, fake, tree: m.render() };
}

test("AC41 Changes: a folder that is not a repo shows the empty state with the folder and the hint", async () => {
  const { tree } = await changes({ git: { fail: "top" } });
  assert.ok(findById(tree, "empty-state"));
  assert.deepEqual(textsOf(findById(tree, "empty-state-title")), [NO_REPO]);
  assert.deepEqual(textsOf(findById(tree, "empty-state-detail")), ["/work/plain"]);
  assert.deepEqual(textsOf(findById(tree, "empty-state-hint")), [NO_REPO_HINT]);
  assert.equal(findById(tree, "changes-summary"), null, "no summary row");
  assert.ok(walk(tree).some((n) => n.kind === "svg" && n.arg === ICON), "the branch icon");
});

test("AC41 Changes: no folder shows the title and its hint, and no detail", async () => {
  const { tree } = await changes({ folder: null });
  assert.deepEqual(textsOf(findById(tree, "empty-state-title")), ["No folder"]);
  assert.deepEqual(textsOf(findById(tree, "empty-state-hint")), [NO_FOLDER_HINT]);
  assert.equal(findById(tree, "empty-state-detail"), null, "no folder is known");
  assert.equal(findById(tree, "changes-summary"), null);
});

test("AC41 Changes: a git folder that cannot be read shows its title and no summary row", async () => {
  const { tree } = await changes({ git: { reject: true } });
  assert.deepEqual(textsOf(findById(tree, "empty-state-title")), ["Cannot read the git folder"]);
  assert.deepEqual(textsOf(findById(tree, "empty-state-detail")), ["/work/plain"]);
  assert.equal(findById(tree, "changes-summary"), null);
});

test("AC41 Changes: the ready state, the loading text and an error keep today's look", async () => {
  const ready = await changes({ folder: "/work/repo", git: { status: "## main\0 M a.txt\0", numstat: "1\t0\ta.txt\0" } });
  assert.equal(findById(ready.tree, "empty-state"), null, "ready");
  assert.ok(findById(ready.tree, "changes-summary"));
  assert.ok(findById(ready.tree, "change-a.txt"));

  const loading = await changes({ folder: "/work/repo", hold: true });
  assert.equal(findById(loading.tree, "empty-state"), null, "loading");
  assert.ok(textsOf(findById(loading.tree, "changes-summary")).includes("Loading changes…"));

  const failed = await changes({ folder: "/work/repo", git: { fail: "status" } });
  assert.equal(findById(failed.tree, "empty-state"), null, "error");
  assert.ok(textsOf(findById(failed.tree, "changes-summary")).some((s) => s.includes("fake status failure")));
});

test("AC41 Changes: a repo with no changes shows the empty state with the branch title, the folder and the hint", async () => {
  const { tree } = await changes({ folder: "/work/repo", git: { status: "## main\0", numstat: "" } });
  assert.ok(findById(tree, "empty-state"));
  assert.deepEqual(textsOf(findById(tree, "empty-state-title")), ["No changes on main"]);
  assert.deepEqual(textsOf(findById(tree, "empty-state-detail")), ["/work/repo"]);
  assert.deepEqual(textsOf(findById(tree, "empty-state-hint")), ["Edits in this repo show up here."]);
  assert.equal(findById(tree, "changes-summary"), null, "no summary row");
  assert.ok(walk(tree).some((n) => n.kind === "svg" && n.arg === ICON), "the branch icon");
});

test("AC41 Changes: a pane folder inside the repo names the repo root, since git status covers the whole repo", async () => {
  const { tree } = await changes({ folder: "/work/repo/sub", git: { top: "/work/repo", status: "## main\0", numstat: "" } });
  assert.deepEqual(textsOf(findById(tree, "empty-state-title")), ["No changes on main"]);
  assert.deepEqual(textsOf(findById(tree, "empty-state-detail")), ["/work/repo"]);
});

test("AC41 Changes: a repo with one changed file keeps the summary row and shows no empty state", async () => {
  const { tree } = await changes({ folder: "/work/repo", git: { status: "## main\0 M a.txt\0", numstat: "1\t0\ta.txt\0" } });
  assert.ok(findById(tree, "changes-summary"));
  assert.equal(findById(tree, "empty-state"), null);
});

test("AC41 Changes: a pane switch between two non-repo folders shows the folder of the answer applied, never a stale one", async () => {
  const at = (folder) => Object.assign(world, { spaces: [{ id: "s1", active: true, folder }] });
  at("/work/z");
  state.shared["herdsidian.sidebar"] = { tab: "changes" };
  fakeGit({ fail: "top" });
  const m = mount();
  m.render();
  await settle();
  assert.deepEqual(textsOf(findById(m.render(), "empty-state-detail")), ["/work/z"]);
  // The reads of A and B wait: A is superseded by B while it runs, so its answer is stale.
  const inner = state.exec, gates = { "/work/a": deferred(), "/work/b": deferred() };
  state.exec = async (cmd, args, opts) => {
    const gate = Object.entries(gates).find(([dir]) => args.includes(dir));
    if (gate) await gate[1].promise;
    return inner(cmd, args, opts);
  };
  at("/work/a");
  m.render();
  at("/work/b");
  m.render();
  gates["/work/a"].resolve();
  await settle();
  await settle();
  assert.deepEqual(textsOf(findById(m.render(), "empty-state-detail")), ["/work/z"], "the stale answer of A names no folder");
  gates["/work/b"].resolve();
  await settle();
  await settle();
  assert.deepEqual(textsOf(findById(m.render(), "empty-state-detail")), ["/work/b"]);
});

// ---- AC42: Git ----

async function git(spec, { focus } = {}) {
  const repo = fakeRepo({ commits: [], root: "/work/plain", ...spec, ...(focus === undefined ? {} : { focus }) });
  const m = mountGit();
  return { repo, m, tree: await until(() => { const t = m.render(); return findById(t, "empty-state") && t; }, "the empty state") };
}

test("AC42 Git: a folder that is not a repo shows the same block and texts as Changes", async () => {
  const { tree } = await git({ fail: ["top"] });
  assert.deepEqual(textsOf(findById(tree, "empty-state-title")), [NO_REPO]);
  assert.deepEqual(textsOf(findById(tree, "empty-state-detail")), ["/work/plain"]);
  assert.deepEqual(textsOf(findById(tree, "empty-state-hint")), [NO_REPO_HINT]);
  for (const id of ["git-header", "git-actions", "git-graph"]) assert.equal(findById(tree, id), null, id);
});

test("AC42 Git: no folder shows the title and its hint, and no detail", async () => {
  const { tree } = await git({}, { focus: false });
  assert.deepEqual(textsOf(findById(tree, "empty-state-title")), ["No folder"]);
  assert.deepEqual(textsOf(findById(tree, "empty-state-hint")), [NO_FOLDER_HINT]);
  assert.equal(findById(tree, "empty-state-detail"), null);
});

test("AC42 Git: a git folder that cannot be read shows its title, from the watch and from the git dir read", async () => {
  const unknown = await git({ reject: ["top"] });
  assert.deepEqual(textsOf(findById(unknown.tree, "empty-state-title")), ["Cannot read the git folder"]);
  assert.deepEqual(textsOf(findById(unknown.tree, "empty-state-detail")), ["/work/plain"]);
  reset();
  const dirs = await git({ fail: ["dirs"] });
  assert.deepEqual(textsOf(findById(dirs.tree, "empty-state-title")), ["Cannot read the git folder"]);
  assert.deepEqual(textsOf(findById(dirs.tree, "empty-state-detail")), ["/work/plain"]);
});

test("AC42 Git: a snapshot that says Not a git repository shows the norepo title, folder and hint", async () => {
  const { tree } = await git({ gitDir: "" }); // the git dir read answers a root and no git dir: parseDirs gives null
  assert.deepEqual(textsOf(findById(tree, "empty-state-title")), [NO_REPO]);
  assert.deepEqual(textsOf(findById(tree, "empty-state-detail")), ["/work/plain"]);
  assert.deepEqual(textsOf(findById(tree, "empty-state-hint")), [NO_REPO_HINT]);
});

test("AC42 Git: loading and a history error keep gitMessage, with no empty state", async () => {
  fakeRepo({ commits: [] });
  const loading = mountGit().render();
  assert.ok(textsOf(findById(loading, "git-message")).includes("Loading history…"));
  assert.equal(findById(loading, "empty-state"), null);

  reset();
  fakeRepo({ commits: [{ hash: "a".repeat(40), parents: [], subject: "one" }], fail: ["log"] });
  const m = mountGit();
  const tree = await until(() => { const t = m.render(); return textsOf(findById(t, "git-message")).some((s) => s.includes("fake log failure")) && t; }, "the log error");
  assert.equal(findById(tree, "empty-state"), null);
});

// ---- AC43: no command ----

test("AC43 drawing the empty state runs no command: Changes", async () => {
  const { m, fake } = await changes({ git: { fail: "top" } });
  const before = fake.calls.length;
  m.render();
  m.render();
  await settle();
  assert.equal(fake.calls.length, before, "a re-render starts no exec");
  assert.ok(fake.calls.every(([cmd, args]) => cmd === "git" && args.includes("rev-parse")), "only the read that found the state ran");
});

test("AC43 drawing the empty state runs no command: Git, and never a write", async () => {
  const { repo, m } = await git({ fail: ["top"] });
  await settle();
  const before = repo.calls.length;
  m.render();
  m.render();
  await settle();
  assert.equal(repo.calls.length, before, "a re-render starts no exec");
  assert.deepEqual(repo.log.writes(), [], "no write");
  assert.ok(repo.calls.every(([cmd, args]) => cmd === "git" && args.includes("rev-parse")), "only the read that found the state ran");
});
