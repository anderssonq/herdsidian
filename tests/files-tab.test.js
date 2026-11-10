// The Files and Changes tabs of the right sidebar (V1): the real mod code against stubbed runtimes, a
// real git repo in a temp dir and real `sh` listings. Also the pure helpers behind the Files tab.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { state, fakeCx, findById, walk } from "./support/mod-stubs.js";
import { during } from "./support/live-cx.js";

const world = { cwd: null, home: "/nowhere" };
let watchers = [];
let execs = [];
const stubs = globalThis.__herdsidianStubs;
stubs.herdr.spaces = () => [{ id: "s1", active: true, folder: world.cwd }];
stubs.herdr.panes = () => (world.cwd ? [{ pane: "p1", cwd: world.cwd }] : []);
stubs.herdr.focused = () => ({ pane: "p1" });
stubs.herdr.home = () => world.home;
stubs.herdr.watchFolder = (root) => new Promise((resolve, reject) => { watchers.push({ root, resolve, reject }); });

const { FilesTab } = await import("../mods/herdsidian/files-view.js");
const { ChangesTab, ChangesWatch } = await import("../mods/herdsidian/changes-view.js");
const tree = await import("../mods/herdsidian/files-tree.js");
const { RADIUS } = await import("../mods/herdsidian/tokens.js");

// No inherited GIT_DIR, no user git config.
const env = { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined, GIT_INDEX_FILE: undefined,
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (dir, ...args) => execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-C", dir, ...args], { env, encoding: "utf8" });
const put = (dir, name, text) => { mkdirSync(join(dir, name, ".."), { recursive: true }); writeFileSync(join(dir, name), text); };
const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), "herdsidian-tab-")));

// Real commands, in the cwd the tab asks for.
let inflight = 0;
const realExec = (cmd, args, opts = {}) => new Promise((resolve) => {
  execs.push([cmd, args]);
  inflight++;
  execFile(cmd, args, { cwd: opts.cwd, env, encoding: "utf8", maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
    inflight--;
    resolve({ stdout, stderr, code: err ? (typeof err.code === "number" ? err.code : 1) : 0 });
  });
});

const T = { foreground: "#eeeeee", background: "#111111", chrome: "#222222", canvas: "#333333", raised: "#2a2a2a", accent: "#ff00aa",
  muted: "#999999", dim: "#555555", hover: "#444444", blocked: "#ffaa00", ansi1: "#ff0001", ansi2: "#00ff02" };

const dirs = [];
// A repo with one commit, then: a.txt +1 -0, sub/inner.txt +2 -1, fresh.txt untracked.
const fixture = () => {
  const dir = scratch();
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  put(dir, "a.txt", "one\n");
  put(dir, "sub/inner.txt", "x\ny\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  put(dir, "a.txt", "one\ntwo\n");
  put(dir, "sub/inner.txt", "x\nq\nr\n");
  put(dir, "fresh.txt", "new\n");
  return dir;
};

beforeEach(() => {
  state.shared = {}; state.files = {}; state.exec = realExec;
  watchers = []; execs = []; world.cwd = null;
});
// A test's tasks must not outlive it: they would write into the next test's shared state.
afterEach(async () => {
  for (let quiet = 0; quiet < 2;) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    quiet = inflight === 0 ? quiet + 1 : 0;
  }
});
process.on("exit", () => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, what) {
  for (let i = 0; i < 300; i++) {
    const value = await check();
    if (value) return value;
    await sleep(15);
  }
  assert.fail(`timed out waiting for ${what}`);
}
const texts = (node) => walk(node).flatMap((n) => n.kids.filter((k) => typeof k === "string"));
const call = (node, name) => node.calls.find(([n]) => n === name);
const has = (node, name, ...args) => node.calls.some(([n, a]) => n === name && JSON.stringify(a) === JSON.stringify(args));

// The tabs as main.js builds them: one host, the watch made once (during init's cx), the tabs lazily.
function mount() {
  const cx = fakeCx(), selected = [], timers = [];
  cx.timer.every = (ms, fn) => { timers.push([ms, fn]); };
  const holder = {};
  const host = { cx: null, selectTab: (tab) => { selected.push(tab); state.shared["herdsidian.sidebar"] = { tab }; },
    files: () => holder.files, vault: () => null, changes: () => holder.watch };
  // A short real quiet period, so the watch's debounce can end.
  cx.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, 100)));
  during(cx, (scoped) => { host.cx = scoped; holder.watch = new ChangesWatch(host); holder.files = new FilesTab(host); });
  holder.changes = new ChangesTab(host);
  const render = (tab) => during(cx, (c) => tab.render(T, c));
  const click = (node) => during(cx, (c) => node.onClick(null, c));
  return { cx, host, selected, timers, watch: holder.watch, files: holder.files, changes: holder.changes, render, click };
}
const published = () => state.shared["herdsidian.changes"];
// Only the count is published; the afterEach quiet period keeps an earlier test's late write out of this one.
const ready = (count) => published()?.count === count;

test("the tree helpers: listing, limits, language, marks and paths", () => {
  assert.deepEqual(tree.parseListing("d\0src\0f\0a.md\0"), [{ name: "src", dir: true }, { name: "a.md", dir: false }]);
  assert.deepEqual(tree.parseListing(""), []);
  assert.equal(tree.PER_FOLDER, 500);
  assert.equal(tree.TOTAL, 5000);
  const many = Array.from({ length: 600 }, (_v, i) => ({ name: `f${String(i).padStart(3, "0")}`, dir: false }));
  const capped = tree.capEntries(many, 0);
  assert.equal(capped.list.length, 500);
  assert.equal(capped.limited, true);
  assert.equal(tree.capEntries(many.slice(0, 10), 4995).list.length, 5);
  assert.equal(tree.capEntries(many.slice(0, 10), 4995).limited, true);
  assert.deepEqual(tree.capEntries([{ name: "b", dir: false }, { name: "z", dir: true }, { name: "a", dir: false }], 0),
    { list: [{ name: "z", dir: true }, { name: "a", dir: false }, { name: "b", dir: false }], limited: false });
  assert.equal(tree.languageOf("src/a.ts"), "js");
  assert.equal(tree.languageOf("x.toml"), "yaml");
  assert.equal(tree.languageOf("notes.md"), "md");
  assert.equal(tree.languageOf("Makefile"), "txt");
  assert.equal(tree.languageOf("a.b/Makefile"), "txt");
  assert.deepEqual(tree.markOf("??"), "A");
  assert.deepEqual([tree.markOf("A "), tree.markOf(" D"), tree.markOf("UU"), tree.markOf(" M")], ["A", "D", "U", "M"]);
  assert.deepEqual(tree.parseMarks("/r", "?? n.txt\0 M a.txt\0 D g.txt\0"), { "/r/n.txt": "A", "/r/a.txt": "M", "/r/g.txt": "D" });
  assert.equal(tree.relativeTo("/r", "/r/a/b.txt"), "a/b.txt");
  assert.equal(tree.relativeTo("/r", "/r"), "");
  assert.equal(tree.relativeTo("/r", "/rr/b.txt"), null);
  assert.equal(tree.relativeTo("/r", "/x/b.txt"), null);
  assert.deepEqual(tree.ancestors("a/b/c.txt"), ["a", "a/b"]);
  assert.deepEqual(tree.ancestors("c.txt"), []);
  assert.equal(tree.tildePath("/people/me/proj", "/people/me"), "~/proj");
  assert.equal(tree.tildePath("/people/me", "/people/me"), "~");
  assert.equal(tree.tildePath("/srv/x", "/people/me"), "/srv/x");
  assert.equal(tree.tildePath("/srv/x", undefined), "/srv/x");
});

test("locate picks the pane cwd, else the focused cwd, else the space folder", () => {
  const space = { id: "s1", folder: "/space", machine: null }, panes = [{ pane: "p1", cwd: "/pane" }];
  assert.deepEqual(tree.locate({ space, focus: { pane: "p1" }, panes }), { cwd: "/pane", on: null, space: "s1" });
  assert.equal(tree.locate({ space, focus: { pane: "p9", cwd: "/focus" }, panes }).cwd, "/focus");
  assert.equal(tree.locate({ space, focus: null, panes }).cwd, "/space");
  assert.equal(tree.locate({ space: { ...space, machine: "box" }, focus: { pane: "p1" }, panes }).on, "box");
  assert.equal(tree.locate({ space, focus: { pane: null, terminal: "dev/t1" }, panes }).on, "dev");
});

test("Files tab: a 30 px path line, no card frame or 42 px header, 28 px rows with the accent folder icon", async () => {
  world.cwd = fixture();
  state.shared["herdsidian.sidebar"] = { tab: "files" };
  const m = mount();
  const out = await until(() => { const t = m.render(m.files); return findById(t, "file-sub") && t; }, "the folder rows");
  const line = findById(out, "files-path");
  assert.ok(line, "the path line");
  assert.ok(has(line, "h", 30));
  assert.ok(has(line, "text_color", T.muted));
  assert.ok(texts(line).includes(world.cwd), "the folder path");
  assert.equal(walk(out).some((n) => has(n, "h", 42)), false, "no own header");
  assert.equal(walk(out).some((n) => n.calls.some(([name]) => name === "border_1")), false, "no card frame");
  assert.equal(findById(out, "files-back"), null);
  for (const id of ["file-sub", "file-a.txt", "file-fresh.txt"]) {
    const row = findById(out, id);
    assert.ok(row, id);
    assert.ok(has(row, "h", 28), `${id} is 28 px`);
    assert.ok(has(row, "rounded", RADIUS.control), `${id} uses RADIUS.control`);
  }
  const folder = walk(findById(out, "file-sub")).filter((n) => n.kind === "svg").at(-1);
  assert.equal(folder.arg, "mods/herdsidian/folder.svg");
  assert.ok(has(folder, "text_color", T.accent));
  // Folders come first, then files by name.
  const order = walk(out).map((n) => n.nodeId).filter((id) => /^file-/.test(id ?? ""));
  assert.deepEqual(order, ["file-sub", "file-a.txt", "file-fresh.txt"]);
  // The git marks of the changed files.
  const marked = await until(() => { const t = m.render(m.files); return texts(findById(t, "file-a.txt")).includes("M") && t; }, "the git marks");
  assert.ok(texts(findById(marked, "file-fresh.txt")).includes("A"));
});

test("Files tab: the path line shows ~ for the home folder", async () => {
  world.cwd = fixture();
  world.home = join(world.cwd, "..");
  try {
    state.shared["herdsidian.sidebar"] = { tab: "files" };
    const m = mount();
    const out = await until(() => { const t = m.render(m.files); return findById(t, "file-sub") && t; }, "the rows");
    assert.ok(texts(findById(out, "files-path")).some((s) => s.startsWith("~/")), texts(findById(out, "files-path")).join());
  } finally { world.home = "/nowhere"; }
});

test("Files tab: a folder row opens and closes the folder", async () => {
  world.cwd = fixture();
  state.shared["herdsidian.sidebar"] = { tab: "files" };
  const m = mount();
  const first = await until(() => { const t = m.render(m.files); return findById(t, "file-sub") && t; }, "the rows");
  m.click(findById(first, "file-sub"));
  const open = await until(() => { const t = m.render(m.files); return findById(t, "file-sub/inner.txt") && t; }, "the folder's rows");
  assert.ok(has(findById(open, "file-sub/inner.txt"), "h", 28));
  m.click(findById(open, "file-sub"));
  assert.equal(findById(m.render(m.files), "file-sub/inner.txt"), null);
});

test("Files tab: a file row shows a preview and the back arrow returns to the tree", async () => {
  world.cwd = fixture();
  state.files[`${world.cwd}/a.txt`] = "one\ntwo\n";
  state.shared["herdsidian.sidebar"] = { tab: "files" };
  const m = mount();
  const first = await until(() => { const t = m.render(m.files); return findById(t, "file-a.txt") && t; }, "the rows");
  m.click(findById(first, "file-a.txt"));
  const preview = await until(() => { const t = m.render(m.files); return walk(t).some((n) => n.kind === "editor") && t; }, "the preview");
  assert.ok(texts(findById(preview, "files-path")).includes("a.txt"));
  assert.equal(findById(preview, "file-a.txt"), null, "the tree is replaced by the preview");
  m.click(findById(preview, "files-back"));
  assert.ok(findById(m.render(m.files), "file-a.txt"));
});

test("Files tab: an unreadable file says so instead of a preview", async () => {
  world.cwd = fixture();
  state.shared["herdsidian.sidebar"] = { tab: "files" };
  const m = mount();
  const first = await until(() => { const t = m.render(m.files); return findById(t, "file-a.txt") && t; }, "the rows");
  m.click(findById(first, "file-a.txt"));
  const out = await until(() => { const t = m.render(m.files); return texts(t).some((s) => /Cannot preview/.test(s)) && t; }, "the message");
  assert.equal(walk(out).some((n) => n.kind === "editor"), false);
});

test("Changes badge: only the count is published once the repo is read", async () => {
  world.cwd = fixture();
  const m = mount();
  await until(() => ready(3), "the count");
  assert.deepEqual(published(), { count: 3 });
  assert.equal(m.watch.data.root, world.cwd, "the watch read the right repo");
});

test("Changes badge: published only when it changed", async () => {
  world.cwd = fixture();
  const writes = [];
  const m = mount();
  await until(() => ready(3), "the count");
  state.shared = new Proxy(state.shared, { set: (target, key, value) => { writes.push(key); target[key] = value; return true; } });
  const statuses = () => execs.filter(([, args]) => args.includes("status") && args.includes("-z") && args.includes("--branch")).length;
  const before = statuses();
  // A local watch works, so the 10 s timer reads nothing: a folder event causes the refresh.
  await fire(world.cwd, [world.cwd]);
  await until(() => statuses() > before, "a refresh");
  await sleep(150);
  assert.deepEqual(writes.filter((k) => k === "herdsidian.changes"), []);
});

test("Changes tab: a 30 px summary and 28 px rows with +N, −N and new", async () => {
  world.cwd = fixture();
  const m = mount();
  const out = await until(() => { const t = m.render(m.changes); return findById(t, "change-a.txt") && t; }, "the rows");
  const summary = findById(out, "changes-summary");
  assert.deepEqual(texts(summary), ["3 files changed on main"]);
  assert.ok(has(summary, "h", 30));
  assert.ok(has(summary, "text_color", T.muted));
  const order = walk(out).map((n) => n.nodeId).filter((id) => /^change-/.test(id ?? ""));
  // git's own order: tracked changes by path, then untracked files.
  assert.deepEqual(order, ["change-a.txt", "change-sub/inner.txt", "change-fresh.txt"]);
  for (const id of order) {
    const row = findById(out, id);
    assert.ok(has(row, "h", 28), `${id} is 28 px`);
    assert.ok(has(row, "rounded", RADIUS.control));
  }
  const find = (id, text) => walk(findById(out, id)).find((n) => n.kids.includes(text));
  assert.ok(has(find("change-a.txt", "a.txt"), "truncate"), "the path is truncated, not wrapped");
  assert.ok(has(find("change-a.txt", "+1"), "text_color", T.ansi2));
  assert.equal(find("change-a.txt", "−0"), undefined, "a zero count is not drawn");
  const inner = (text) => find("change-sub/inner.txt", text);
  assert.ok(has(inner("+2"), "text_color", T.ansi2));
  assert.ok(has(inner("−1"), "text_color", T.ansi1));
  const fresh = find("change-fresh.txt", "new");
  assert.ok(fresh, "untracked rows say new");
  assert.ok(has(fresh, "text_color", T.muted));
  assert.equal(find("change-fresh.txt", "+0"), undefined);
});

test("Changes tab: clicking a row selects Files and previews that file", async () => {
  world.cwd = fixture();
  state.files[`${world.cwd}/a.txt`] = "one\ntwo\n";
  state.shared["herdsidian.sidebar"] = { tab: "changes" };
  const m = mount();
  const out = await until(() => { const t = m.render(m.changes); return findById(t, "change-a.txt") && t; }, "the rows");
  m.click(findById(out, "change-a.txt"));
  assert.deepEqual(m.selected, ["files"]);
  assert.equal(state.shared["herdsidian.sidebar"].tab, "files");
  const preview = await until(() => { const t = m.render(m.files); return walk(t).some((n) => n.kind === "editor") && t; }, "the preview");
  assert.ok(texts(findById(preview, "files-path")).includes("a.txt"));
});

test("Changes tab: a file in a closed folder is revealed in the tree", async () => {
  world.cwd = fixture();
  state.files[`${world.cwd}/sub/inner.txt`] = "x\nq\nr\n";
  const m = mount();
  const out = await until(() => { const t = m.render(m.changes); return findById(t, "change-sub/inner.txt") && t; }, "the rows");
  m.click(findById(out, "change-sub/inner.txt"));
  const preview = await until(() => { const t = m.render(m.files); return walk(t).some((n) => n.kind === "editor") && t; }, "the preview");
  assert.ok(texts(findById(preview, "files-path")).includes("sub/inner.txt"));
  m.click(findById(preview, "files-back"));
  const back = await until(() => { const t = m.render(m.files); return findById(t, "file-sub/inner.txt") && t; }, "the revealed folder");
  assert.ok(findById(back, "file-sub"));
});

test("FilesTab.open shows a file outside the folder by its full path", async () => {
  world.cwd = fixture();
  const other = scratch();
  dirs.push(other);
  put(other, "far.md", "# far\n");
  state.files[`${other}/far.md`] = "# far\n";
  const m = mount();
  m.files.open(`${other}/far.md`);
  const out = await until(() => { const t = m.render(m.files); return walk(t).some((n) => n.kind === "editor") && t; }, "the preview");
  assert.ok(texts(findById(out, "files-path")).includes(`${other}/far.md`));
});

test("Changes tab: a folder that is not a git repo says so and publishes 0", async () => {
  world.cwd = scratch();
  dirs.push(world.cwd);
  put(world.cwd, "plain.txt", "x\n");
  const m = mount();
  await until(() => published()?.count === 0, "the count");
  assert.deepEqual(published(), { count: 0 });
  assert.equal(m.watch.data.state, "norepo");
  const out = await until(() => { const t = m.render(m.changes); return texts(t).some((s) => /Not a git repository/.test(s)) && t; }, "the message");
  assert.equal(walk(out).some((n) => /^change-/.test(n.nodeId ?? "")), false);
});

test("Changes tab: a repo without changes says so", async () => {
  const dir = scratch();
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  put(dir, "a.txt", "1\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  world.cwd = dir;
  const m = mount();
  const out = await until(() => { const t = m.render(m.changes); return texts(t).includes("No changes on main") && t; }, "the summary");
  assert.deepEqual(published(), { count: 0 });
  assert.equal(m.watch.data.root, dir);
  assert.ok(out);
});

test("Changes tab: a repo with no commit yet lists its files", async () => {
  const dir = scratch();
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "trunk");
  put(dir, "a.txt", "1\n");
  git(dir, "add", "a.txt");
  world.cwd = dir;
  const m = mount();
  const out = await until(() => { const t = m.render(m.changes); return findById(t, "change-a.txt") && t; }, "the row");
  assert.deepEqual(texts(findById(out, "changes-summary")), ["1 file changed on trunk"]);
  assert.equal(published().count, 1);
});

test("Changes tab: shows at most 500 rows but counts every file", async () => {
  const dir = scratch();
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  put(dir, "seed.txt", "1\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  for (let i = 0; i < 520; i++) writeFileSync(join(dir, `n${String(i).padStart(3, "0")}.txt`), "x\n");
  world.cwd = dir;
  const m = mount();
  await until(() => ready(520), "the count");
  const out = await until(() => { const t = m.render(m.changes); return findById(t, "change-n000.txt") && t; }, "the rows");
  assert.equal(walk(out).filter((n) => /^change-/.test(n.nodeId ?? "")).length, 500);
  assert.deepEqual(texts(findById(out, "changes-summary")), ["520 files changed on main"]);
  assert.ok(texts(out).some((s) => /20 more/.test(s)), "says how many are not shown");
});

const fire = async (root, paths) => {
  const pending = await until(() => watchers.filter((w) => w.root === root).at(-1), "the folder watch");
  watchers.splice(watchers.indexOf(pending), 1);
  pending.resolve(paths);
};

test("Changes watch: a folder event refreshes; .git/objects and build-folder events are ignored", async () => {
  const dir = fixture();
  world.cwd = dir;
  mount();
  await until(() => ready(3), "the first count");
  put(dir, "later.txt", "x\n");
  await fire(dir, [`${dir}/later.txt`]);
  await until(() => ready(4), "the count after a file event");

  put(dir, "quiet.txt", "x\n");
  const statuses = () => execs.filter(([, args]) => args.includes("status")).length;
  const before = statuses();
  await fire(dir, [`${dir}/.git/objects/ab/cdef`, `${dir}/.git/objects/pack/p.pack`]);
  await sleep(150);
  assert.equal(statuses(), before, "an objects-only batch runs no git");
  assert.equal(published().count, 4);

  await fire(dir, [dir]);
  await until(() => ready(5), "the count after a batch with the root");

  // Two batches inside the quiet period are merged into one refresh.
  put(dir, "m1.txt", "x\n");
  put(dir, "m2.txt", "x\n");
  const merged = statuses();
  await fire(dir, [`${dir}/m1.txt`]);
  await fire(dir, [`${dir}/m2.txt`]);
  await until(() => ready(7), "the count after two merged batches");
  await sleep(250);
  assert.equal(statuses() - merged, 1, "one git refresh for both batches");
});

test("Changes watch: the 10 s timer does not read while a local watch works", async () => {
  const dir = fixture();
  world.cwd = dir;
  const m = mount();
  await until(() => ready(3), "the count");
  assert.equal(m.timers[0][0], 10000);
  const statuses = () => execs.filter(([, args]) => args.includes("status")).length;
  const before = statuses();
  put(dir, "timed.txt", "x\n");
  m.timers[0][1](m.cx);
  await sleep(250);
  assert.equal(statuses(), before);
  assert.equal(published().count, 3);
});

test("Changes watch: the 10 s timer refreshes when the watch failed", async () => {
  const dir = fixture();
  world.cwd = dir;
  const m = mount();
  await until(() => ready(3), "the count");
  const pending = await until(() => watchers.filter((w) => w.root === dir).at(-1), "the folder watch");
  pending.reject(new Error("no watch"));
  await sleep(50);
  put(dir, "timed.txt", "x\n");
  m.timers[0][1](m.cx);
  await until(() => ready(4), "the count after the timer");
});

test("Changes watch: follows the focused repo when it changes (checked on render)", async () => {
  const first = fixture();
  const second = scratch();
  dirs.push(second);
  git(second, "init", "-q", "-b", "dev");
  put(second, "only.txt", "x\n");
  world.cwd = first;
  const m = mount();
  await until(() => ready(3), "the first repo");
  world.cwd = second;
  m.render(m.changes);
  await until(() => m.watch.data.root === second, "the second repo");
  assert.equal(published().count, 1);
  const out = await until(() => { const t = m.render(m.changes); return findById(t, "change-only.txt") && t; }, "the second repo's row");
  assert.deepEqual(texts(findById(out, "changes-summary")), ["1 file changed on dev"]);
});
