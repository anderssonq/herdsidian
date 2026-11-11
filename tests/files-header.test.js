// The Files tab header with a file open: it looks and works like the Notes sub-header (back button, two lines, copy-path button).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { state, fakeCx, findById, walk } from "./support/mod-stubs.js";
import { during } from "./support/live-cx.js";

const world = { cwd: null, home: "/nowhere" };
const stubs = globalThis.__herdsidianStubs;
stubs.herdr.spaces = () => [{ id: "s1", active: true, folder: world.cwd }];
stubs.herdr.panes = () => (world.cwd ? [{ pane: "p1", cwd: world.cwd }] : []);
stubs.herdr.focused = () => ({ pane: "p1" });
stubs.herdr.home = () => world.home;
stubs.herdr.watchFolder = () => new Promise(() => {});

const { FilesTab } = await import("../mods/herdsidian/files-view.js");
const { ChangesTab, ChangesWatch } = await import("../mods/herdsidian/changes-view.js");
const { RADIUS } = await import("../mods/herdsidian/tokens.js");

const T = { foreground: "#eeeeee", background: "#111111", chrome: "#222222", canvas: "#333333", raised: "#2a2a2a", accent: "#ff00aa",
  muted: "#999999", dim: "#555555", hover: "#444444", blocked: "#ffaa00", ansi1: "#ff0001", ansi2: "#00ff02" };

const dirs = [];
const scratch = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), "herdsidian-head-"))); dirs.push(d); return d; };
const put = (dir, name, text) => { mkdirSync(join(dir, name, ".."), { recursive: true }); writeFileSync(join(dir, name), text); };
const fixture = () => {
  const dir = scratch();
  put(dir, "a.txt", "one\n");
  put(dir, "sub/inner.txt", "x\ny\n");
  return dir;
};

let inflight = 0;
const realExec = (cmd, args, opts = {}) => new Promise((resolve) => {
  inflight++;
  execFile(cmd, args, { cwd: opts.cwd, encoding: "utf8", maxBuffer: 1 << 24 }, (err, stdout, stderr) => {
    inflight--;
    resolve({ stdout, stderr, code: err ? (typeof err.code === "number" ? err.code : 1) : 0 });
  });
});

beforeEach(() => { state.shared = {}; state.files = {}; state.toasts = []; state.exec = realExec; world.cwd = null; });
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
const has = (node, name, ...args) => node.calls.some(([n, a]) => n === name && JSON.stringify(a) === JSON.stringify(args));
const hasCall = (node, name) => node.calls.some(([n]) => n === name);
const svgOf = (node) => walk(node).filter((n) => n.kind === "svg").map((n) => n.arg);

function mount() {
  const cx = fakeCx();
  const holder = {};
  const host = { cx: null, selectTab: (tab) => { state.shared["herdsidian.sidebar"] = { tab }; },
    files: () => holder.files, vault: () => null, changes: () => holder.watch };
  during(cx, (scoped) => { host.cx = scoped; holder.watch = new ChangesWatch(host); holder.files = new FilesTab(host); });
  holder.changes = new ChangesTab(host);
  const render = (tab) => during(cx, (c) => tab.render(T, c));
  const click = (node) => during(cx, (c) => node.onClick(null, c));
  return { cx, files: holder.files, changes: holder.changes, render, click };
}

// Opens `rel` from the tree (folders opened first) and returns the rendered preview.
async function openFile(m, rel) {
  const parts = rel.split("/");
  let out = await until(() => { const t = m.render(m.files); return findById(t, `file-${parts[0]}`) && t; }, "the rows");
  for (let i = 1; i < parts.length; i++) {
    m.click(findById(out, `file-${parts.slice(0, i).join("/")}`));
    out = await until(() => { const t = m.render(m.files); return findById(t, `file-${parts.slice(0, i + 1).join("/")}`) && t; }, "the folder rows");
  }
  m.click(findById(out, `file-${rel}`));
  return until(() => { const t = m.render(m.files); return walk(t).some((n) => n.kind === "editor") && t; }, "the preview");
}

test("the back button is a 28 px Notes-style button with a chevron and a tooltip, no arrow text, and closes the preview", async () => {
  world.cwd = fixture();
  state.files[`${world.cwd}/a.txt`] = "one\n";
  state.shared["herdsidian.sidebar"] = { tab: "files" };
  const m = mount();
  const out = await openFile(m, "a.txt");
  const back = findById(out, "files-back");
  assert.ok(back);
  assert.ok(has(back, "size", 28));
  assert.ok(has(back, "rounded", RADIUS.control));
  assert.ok(has(back, "text_color", T.muted));
  assert.ok(has(back, "tooltip", "Back to the files"));
  assert.ok(svgOf(back).some((p) => p.endsWith("chevron-left.svg")));
  assert.equal(texts(out).some((s) => s.includes("←")), false);
  m.click(back);
  assert.ok(findById(m.render(m.files), "file-a.txt"), "the tree shows again");
});

test("two lines: the base name semibold, then the relative path at 10.5 in muted; both truncate; row keeps files-path", async () => {
  world.cwd = fixture();
  state.files[`${world.cwd}/sub/inner.txt`] = "x\ny\n";
  state.shared["herdsidian.sidebar"] = { tab: "files" };
  const m = mount();
  const out = await openFile(m, "sub/inner.txt");
  const row = findById(out, "files-path");
  assert.ok(row);
  assert.ok(texts(row).includes("inner.txt"));
  const title = walk(row).find((n) => n.kids.includes("inner.txt"));
  assert.ok(hasCall(title, "font_semibold"));
  assert.ok(hasCall(title, "truncate"));
  const path = walk(row).find((n) => n.kids.includes("sub/inner.txt"));
  assert.ok(path, "the relative path line");
  assert.ok(has(path, "text_size", 10.5));
  assert.ok(has(path, "text_color", T.muted));
  assert.ok(hasCall(path, "truncate"));
});

test("the copy button draws copy.svg and copies the absolute path, then notifies", async () => {
  world.cwd = fixture();
  state.files[`${world.cwd}/a.txt`] = "one\n";
  state.shared["herdsidian.sidebar"] = { tab: "files" };
  const m = mount();
  const out = await openFile(m, "a.txt");
  const copy = findById(out, "files-copy-path");
  assert.ok(copy);
  assert.ok(has(copy, "size", 28));
  assert.ok(has(copy, "tooltip", "Copy the full path"));
  assert.deepEqual(svgOf(copy), ["mods/herdsidian/copy.svg"]);
  m.click(copy);
  assert.deepEqual(m.cx.clipboard, [`${world.cwd}/a.txt`]);
  assert.deepEqual(state.toasts, [{ title: "Path copied", level: "success" }]);
});

test("a file opened from Changes, or by an absolute path outside the folder, copies its absolute path", async () => {
  world.cwd = fixture();
  state.files[`${world.cwd}/a.txt`] = "one\n";
  state.shared["herdsidian.sidebar"] = { tab: "changes" };
  const m = mount();
  m.files.open(`${world.cwd}/sub/inner.txt`);
  state.files[`${world.cwd}/sub/inner.txt`] = "x\n";
  let out = await until(() => { const t = m.render(m.files); return walk(t).some((n) => n.kind === "editor") && t; }, "the revealed preview");
  m.click(findById(out, "files-copy-path"));
  assert.equal(m.cx.clipboard.at(-1), `${world.cwd}/sub/inner.txt`);

  const other = scratch();
  put(other, "far.md", "# far\n");
  state.files[`${other}/far.md`] = "# far\n";
  m.files.open(`${other}/far.md`);
  out = await until(() => { const t = m.render(m.files); return texts(findById(t, "files-path") ?? t).includes("far.md") && t; }, "the outside preview");
  m.click(findById(out, "files-copy-path"));
  assert.equal(m.cx.clipboard.at(-1), `${other}/far.md`);
  assert.equal(state.toasts.length, 2);
});

test("with no file open there is no back or copy button, and the header shows the folder as a tilde path", async () => {
  world.cwd = fixture();
  world.home = join(world.cwd, "..");
  try {
    state.shared["herdsidian.sidebar"] = { tab: "files" };
    const m = mount();
    const out = await until(() => { const t = m.render(m.files); return findById(t, "file-sub") && t; }, "the rows");
    assert.equal(findById(out, "files-back"), null);
    assert.equal(findById(out, "files-copy-path"), null);
    assert.ok(texts(findById(out, "files-path")).some((s) => s.startsWith("~/")));
  } finally { world.home = "/nowhere"; }
});

test("the header has the Notes padding: pt 2, pr 8, pb 6, pl 8, gap 4", async () => {
  world.cwd = fixture();
  state.files[`${world.cwd}/a.txt`] = "one\n";
  state.shared["herdsidian.sidebar"] = { tab: "files" };
  const m = mount();
  const out = await openFile(m, "a.txt");
  const header = walk(out).find((n) => has(n, "pt", 2));
  assert.ok(header, "a node with pt 2");
  assert.ok(has(header, "pr", 8) && has(header, "pb", 6) && has(header, "pl", 8) && has(header, "gap", 4));
  assert.ok(walk(header).includes(findById(out, "files-back")) && walk(header).includes(findById(out, "files-copy-path")));
});
