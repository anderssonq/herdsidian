// Fix round B1: the ChangesWatch load (debounced batches, ignored folders, the 10 s timer only without a local
// watch), the light 2 s badge check, and the Files tab timer started from the constructor.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx, settle } from "./support/mod-stubs.js";
import { during } from "./support/live-cx.js";

const world = { cwd: "/work/repo", machine: null };
let watchers = [];
let statuses = 0;
const stubs = globalThis.__herdsidianStubs;
stubs.herdr.spaces = () => (world.cwd ? [{ id: "s1", active: true, folder: world.cwd, machine: world.machine }] : []);
stubs.herdr.panes = () => (world.cwd ? [{ pane: "p1", cwd: world.cwd }] : []);
stubs.herdr.focused = () => ({ pane: "p1" });
stubs.herdr.home = () => "/nowhere";
stubs.herdr.watchFolder = () => new Promise((resolve, reject) => { watchers.push({ resolve, reject }); });

const { relevant } = await import("../mods/herdsidian/changes.js");
const { ChangesWatch } = await import("../mods/herdsidian/changes-view.js");
const { FilesTab } = await import("../mods/herdsidian/files-view.js");

const ROOT = "/work/repo";

beforeEach(() => {
  state.shared = {}; watchers = []; statuses = 0;
  world.cwd = ROOT; world.machine = null;
  state.exec = async (_cmd, args) => {
    if (args.includes("--show-toplevel")) return { code: 0, stdout: `${world.cwd}\n`, stderr: "" };
    if (args.includes("status")) { statuses++; return { code: 0, stdout: "## main\0 M a.txt\0", stderr: "" }; }
    return { code: 0, stdout: "", stderr: "" };
  };
});

test("relevant drops batches made only of ignored folders", () => {
  for (const dir of [".git/objects/ab/cd", ".git/objects/pack/x.pack", "node_modules/x/i.js", ".next/cache/a", "dist/a.js", "target/debug/a",
    "build/a.o", ".turbo/log", ".cache/a", "packages/web/node_modules/x/i.js", "apps/a/dist/b.js"]) {
    assert.equal(relevant([`${ROOT}/${dir}`], ROOT), false, dir);
  }
  assert.equal(relevant([`${ROOT}/node_modules/a`, `${ROOT}/.git/objects/ab/cd`], ROOT), false);
});

test("relevant keeps the git state and source files", () => {
  for (const p of [".git/index", ".git/HEAD", ".git/refs/heads/main", "src/a.js", "README.md", ".github/ci.yml", "distance.txt"]) {
    assert.equal(relevant([`${ROOT}/${p}`], ROOT), true, p);
  }
  assert.equal(relevant([`${ROOT}/node_modules/a`, `${ROOT}/.git/index`], ROOT), true);
  assert.equal(relevant([`${ROOT}/node_modules/a`, `${ROOT}/src/a.js`], ROOT), true);
});

test("relevant matches ignored names on folder segments only, not on the file name", () => {
  for (const p of ["build", "scripts/build", "dist", "src/target", "docs/node_modules", ".cache"]) {
    assert.equal(relevant([`${ROOT}/${p}`], ROOT), true, p);
  }
  assert.equal(relevant([`${ROOT}/scripts/build/out.js`], ROOT), false);
  assert.equal(relevant([`${ROOT}/build/a.o`, `${ROOT}/scripts/build`], ROOT), true);
});

test("relevant looks at the path inside the repo, not at the repo's own place", () => {
  assert.equal(relevant(["/srv/build/repo/src/a.js"], "/srv/build/repo"), true);
  assert.equal(relevant(["/srv/build/repo/dist/a.js"], "/srv/build/repo"), false);
});

// The watch as main.js makes it (in init), with a sleep a test releases by hand.
function mountWatch() {
  const cx = fakeCx(), timers = [], sleeps = [];
  cx.timer.every = (ms, fn) => { timers.push([ms, fn]); };
  cx.sleep = (ms) => new Promise((resolve) => { sleeps.push({ ms, resolve }); });
  const host = { cx: null };
  let watch;
  during(cx, (scoped) => { host.cx = scoped; watch = new ChangesWatch(host); });
  return { cx, timers, sleeps, watch };
}

test("a relevant batch waits 600 ms, merges the batches that arrive meanwhile and refreshes once", async () => {
  const m = mountWatch();
  await settle();
  assert.equal(statuses, 1);
  assert.equal(watchers.length, 1);
  watchers[0].resolve([`${ROOT}/a.txt`]);
  await settle();
  assert.equal(m.sleeps.length, 1);
  assert.equal(m.sleeps[0].ms, 600);
  assert.equal(statuses, 1, "no git before the quiet period ends");
  watchers[1].resolve([`${ROOT}/b.txt`]);
  await settle();
  assert.equal(m.sleeps.length, 2, "a batch inside the wait restarts it");
  m.sleeps[0].resolve();
  await settle();
  assert.equal(statuses, 1, "the first wait was replaced");
  m.sleeps[1].resolve();
  await settle();
  assert.equal(statuses, 2, "one refresh for both batches");
});

test("an ignored batch inside the wait does not restart it", async () => {
  const m = mountWatch();
  await settle();
  watchers[0].resolve([`${ROOT}/a.txt`]);
  await settle();
  assert.equal(m.sleeps.length, 1);
  watchers[1].resolve([`${ROOT}/node_modules/x/i.js`]);
  await settle();
  assert.equal(m.sleeps.length, 1, "no new wait");
  assert.equal(watchers.length, 3, "it keeps watching");
  m.sleeps[0].resolve();
  await settle();
  assert.equal(statuses, 2, "the first wait still ends in a refresh");
});

test("the wait is capped at 2500 ms from the first relevant batch", async () => {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    const m = mountWatch();
    await settle();
    watchers[0].resolve([`${ROOT}/a.txt`]);
    await settle();
    assert.equal(m.sleeps[0].ms, 600);
    now += 2000;
    watchers[1].resolve([`${ROOT}/b.txt`]);
    await settle();
    assert.equal(m.sleeps.length, 2);
    assert.equal(m.sleeps[1].ms, 500, "the restart is cut to what is left of the cap");
    assert.equal(statuses, 1);
    now += 500;
    watchers[2].resolve([`${ROOT}/c.txt`]);
    await settle();
    assert.equal(statuses, 2, "at the cap it refreshes although events keep arriving");
    assert.equal(m.sleeps.length, 2, "no further wait");
  } finally { Date.now = realNow; }
});

test("a batch of ignored folders starts no wait and no git", async () => {
  const m = mountWatch();
  await settle();
  watchers[0].resolve([`${ROOT}/node_modules/x/i.js`, `${ROOT}/.git/objects/ab/cd`]);
  await settle();
  assert.equal(m.sleeps.length, 0);
  assert.equal(statuses, 1);
  assert.equal(watchers.length, 2, "it keeps watching");
});

test("the 10 s timer reads nothing while a local watch works", async () => {
  const m = mountWatch();
  await settle();
  assert.equal(m.timers.find(([ms]) => ms === 10000) !== undefined, true);
  during(m.cx, (cx) => m.timers.find(([ms]) => ms === 10000)[1](cx));
  await settle();
  assert.equal(statuses, 1);
});

test("the 10 s timer reads a remote repo", async () => {
  world.machine = "box";
  const m = mountWatch();
  await settle();
  assert.equal(watchers.length, 0, "no watch for a remote repo");
  during(m.cx, (cx) => m.timers.find(([ms]) => ms === 10000)[1](cx));
  await settle();
  assert.equal(statuses, 2);
});

test("the 10 s timer reads again when the watch failed", async () => {
  const m = mountWatch();
  await settle();
  watchers[0].reject(new Error("no watch"));
  await settle();
  during(m.cx, (cx) => m.timers.find(([ms]) => ms === 10000)[1](cx));
  await settle();
  assert.equal(statuses, 2);
});

test("a light 2 s timer from the constructor follows the focus without a render", async () => {
  const m = mountWatch();
  await settle();
  const light = m.timers.find(([ms]) => ms === 2000);
  assert.ok(light, "a 2 s timer was started in the constructor");
  assert.deepEqual(state.shared["herdsidian.changes"], { count: 1 });
  assert.equal(m.watch.data.root, ROOT);
  during(m.cx, (cx) => light[1](cx));
  await settle();
  assert.equal(statuses, 1, "the same repo costs no git");
  world.cwd = "/work/other";
  during(m.cx, (cx) => light[1](cx));
  await settle();
  assert.equal(m.watch.data.root, "/work/other");
});

test("the light check publishes {count: 0} for no folder", async () => {
  const m = mountWatch();
  await settle();
  assert.deepEqual(state.shared["herdsidian.changes"], { count: 1 });
  world.cwd = null;
  during(m.cx, (cx) => m.timers.find(([ms]) => ms === 2000)[1](cx));
  await settle();
  assert.equal(m.watch.data.state, "nofolder");
  assert.deepEqual(state.shared["herdsidian.changes"], { count: 0 });
  const published = state.shared["herdsidian.changes"];
  during(m.cx, (cx) => m.watch.refresh(cx));
  await settle();
  assert.equal(state.shared["herdsidian.changes"], published, "the same value is not published again");
});

test("the light check publishes {count: 0} when the folder is not a git repo", async () => {
  const m = mountWatch();
  await settle();
  assert.deepEqual(state.shared["herdsidian.changes"], { count: 1 });
  const exec = state.exec;
  state.exec = async (cmd, args) => (args.includes("--show-toplevel") ? { code: 128, stdout: "", stderr: "not a git repository" } : exec(cmd, args));
  world.cwd = "/work/plain";
  during(m.cx, (cx) => m.timers.find(([ms]) => ms === 2000)[1](cx));
  await settle();
  assert.equal(m.watch.data.state, "norepo");
  assert.deepEqual(state.shared["herdsidian.changes"], { count: 0 });
});

test("a git error in the same repo as the last good read keeps the published count", async () => {
  const m = mountWatch();
  await settle();
  const published = state.shared["herdsidian.changes"];
  assert.deepEqual(published, { count: 1 });
  const exec = state.exec;
  state.exec = async (cmd, args) => (args.includes("status") ? { code: 128, stdout: "", stderr: "index.lock exists" } : exec(cmd, args));
  during(m.cx, (cx) => m.watch.refresh(cx));
  await settle();
  assert.equal(m.watch.data.state, "error");
  assert.equal(state.shared["herdsidian.changes"], published, "no drop to 0");
  state.exec = exec;
  during(m.cx, (cx) => m.watch.refresh(cx));
  await settle();
  assert.equal(m.watch.data.state, "ready");
  assert.deepEqual(state.shared["herdsidian.changes"], { count: 1 });
});

test("a git error after no folder publishes {count: 0}, not a kept count", async () => {
  const m = mountWatch();
  await settle();
  assert.deepEqual(state.shared["herdsidian.changes"], { count: 1 });
  const light = m.timers.find(([ms]) => ms === 2000)[1];
  world.cwd = null;
  during(m.cx, (cx) => light(cx));
  await settle();
  assert.deepEqual(state.shared["herdsidian.changes"], { count: 0 });
  const exec = state.exec;
  state.exec = async (cmd, args) => (args.includes("status") ? { code: 128, stdout: "", stderr: "index.lock exists" } : exec(cmd, args));
  world.cwd = ROOT;
  during(m.cx, (cx) => light(cx));
  await settle();
  assert.equal(m.watch.data.state, "error");
  assert.deepEqual(state.shared["herdsidian.changes"], { count: 0 });
});

test("an error in another repo leaves no kept count for the first repo", async () => {
  const m = mountWatch();
  await settle();
  const light = m.timers.find(([ms]) => ms === 2000)[1];
  const exec = state.exec;
  state.exec = async (cmd, args) => (args.includes("status") && args.includes("/work/b") ? { code: 128, stdout: "", stderr: "boom" } : exec(cmd, args));
  world.cwd = "/work/b";
  during(m.cx, (cx) => light(cx));
  await settle();
  assert.equal(m.watch.data.state, "error");
  assert.deepEqual(state.shared["herdsidian.changes"], { count: 0 });
  assert.equal(m.watch.readyRoot, null, "the first repo's count is gone, nothing to keep");
  // The first repo fails too: it publishes 0 itself instead of keeping the 0 that came from the other repo.
  state.exec = async (cmd, args) => (args.includes("status") ? { code: 128, stdout: "", stderr: "boom" } : exec(cmd, args));
  world.cwd = ROOT;
  during(m.cx, (cx) => light(cx));
  await settle();
  assert.equal(m.watch.data.state, "error");
  assert.deepEqual(state.shared["herdsidian.changes"], { count: 0 });
  assert.equal(m.watch.readyRoot, null);
  // It recovers its real count on its next good read.
  state.exec = exec;
  during(m.cx, (cx) => m.watch.refresh(cx));
  await settle();
  assert.deepEqual(state.shared["herdsidian.changes"], { count: 1 });
});

test("a git error with no good read of that repo publishes {count: 0}, on a new repo or on the first read", async () => {
  state.exec = async (_cmd, args) => (args.includes("--show-toplevel") ? { code: 0, stdout: `${world.cwd}\n`, stderr: "" } : { code: 1, stdout: "", stderr: "boom" });
  const m = mountWatch();
  await settle();
  assert.equal(m.watch.data.state, "error");
  assert.deepEqual(state.shared["herdsidian.changes"], { count: 0 });
});

test("the light check publishes {count: 0} when git fails in another repo", async () => {
  const m = mountWatch();
  await settle();
  assert.deepEqual(state.shared["herdsidian.changes"], { count: 1 });
  const exec = state.exec;
  state.exec = async (cmd, args) => (args.includes("status") ? { code: 1, stdout: "", stderr: "boom" } : exec(cmd, args));
  world.cwd = "/work/broken";
  during(m.cx, (cx) => m.timers.find(([ms]) => ms === 2000)[1](cx));
  await settle();
  assert.equal(m.watch.data.state, "error");
  assert.deepEqual(state.shared["herdsidian.changes"], { count: 0 });
});

test("the Files tab starts its 10 s timer in the constructor, not in render", () => {
  const cx = fakeCx(), timers = [];
  cx.timer.every = (ms, fn) => { timers.push([ms, fn]); };
  const host = { cx: null };
  let tab;
  during(cx, (scoped) => { host.cx = scoped; tab = new FilesTab(host); });
  assert.deepEqual(timers.map(([ms]) => ms), [10000]);
  state.shared["herdsidian.sidebar"] = { tab: "files" };
  during(cx, (c) => { try { tab.render({}, c); } catch { /* the tree needs a full theme; only the timers count here */ } });
  assert.equal(timers.length, 1, "render starts no timer");
});

test("the Files timer refreshes only while the tab is shown", () => {
  const cx = fakeCx(), timers = [];
  cx.timer.every = (ms, fn) => { timers.push([ms, fn]); };
  let tab;
  const host = { cx: null };
  during(cx, (scoped) => { host.cx = scoped; tab = new FilesTab(host); });
  let refreshed = 0;
  tab.refresh = () => { refreshed++; };
  state.shared["herdsidian.sidebar"] = { tab: "notes" };
  timers[0][1](cx);
  assert.equal(refreshed, 0);
  assert.equal(tab.stale, true);
  state.shared["herdsidian.sidebar"] = { tab: "files" };
  timers[0][1](cx);
  assert.equal(refreshed, 1);
});
