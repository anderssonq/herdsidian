// The Changes tab, diff view (V2): header, tabs, rows, widths, notices, refresh, keys and glass.
// Written from the spec and the plan's contracts. Colors come from diffTokens, read lazily so a missing export fails one test.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as lib from "../lib/tokens.js";
import * as diff from "../mods/herdsidian/diff.js";
import { mount, fakeGit, fakeFiles, reset, world, state, during, findById, walk, rowsOf, texts, has, settle } from "./support/changes-kit.js";

const ROOT = "/work/repo";
const MINUS = "−";
const THEME = { foreground: "#eeeeee", background: "#111111", chrome: "#222222", canvas: "#333333", raised: "#2a2a2a", accent: "#ff00aa",
  muted: "#999999", dim: "#555555", hover: "#444444", blocked: "#ffaa00", ansi1: "#ff0001", ansi2: "#00ff02",
  ansi3: "#aa0003", ansi4: "#0aa004", ansi5: "#0005aa", ansi6: "#a0a006" };
const GLASS = { ...THEME, background: lib.CLEAR };
const dkOf = (theme = THEME) => lib.diffTokens(theme);

// Scroll handles made by the view, so a test can read scroll_to_item.
const base = globalThis.__herdsidianStubs["gpui-base"];
const handles = [];
const makeHandle = base.ScrollHandle.new;
base.ScrollHandle.new = (...args) => { const h = makeHandle(...args); handles.push(h); return h; };

beforeEach(() => { reset(); handles.length = 0; });

const status = (...lines) => `## main\0${lines.map((l) => `${l}\0`).join("")}`;
const numstat = (...lines) => lines.map((l) => `${l}\0`).join("");
const patch = (path, ...body) => [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`, ...body, ""].join("\n");

const A_PATCH = patch("src/a.js", "@@ -1,4 +1,4 @@ function main() {", " keep", "-old line", "+new line", " tail", " more");
const B_PATCH = patch("b.txt", "@@ -1,3 +1,2 @@", " one", "-two", "-three", "+TWO");
const C_PATCH = patch("c.txt", "@@ -1 +1 @@", "-a", "\\ No newline at end of file", "+b", "\\ No newline at end of file");
const STATUS = status(" M b.txt", " M c.txt", " M src/a.js", "?? new.txt");
const NUMSTAT = numstat("1\t2\tb.txt", "1\t1\tc.txt", "1\t1\tsrc/a.js");
const PATCHES = { "b.txt": B_PATCH, "c.txt": C_PATCH, "src/a.js": A_PATCH };

async function until(fn, what) {
  for (let i = 0; i < 100; i++) {
    const value = fn();
    if (value) return value;
    await settle();
  }
  return assert.fail(`timed out waiting for ${what}`);
}

// A mounted tab on a list of files and a width.
async function setup({ theme = THEME, stat = STATUS, nums = NUMSTAT, patches = PATCHES, files = { [`${ROOT}/new.txt`]: "alpha\nbeta\n" },
  space = {}, width, gitOptions = {} } = {}) {
  Object.assign(world, { spaces: [{ id: "s1", active: true, folder: ROOT, ...space }], panes: [{ pane: "p1", cwd: ROOT }], focused: { pane: "p1" } });
  state.shared["herdsidian.sidebar"] = { tab: "changes" };
  const git = fakeGit({ status: stat, numstat: nums, patches, ...gitOptions });
  fakeFiles(files);
  const m = mount({ theme });
  m.render();
  const list = await until(() => { const t = m.render(); return walk(t).some((n) => /^change-/.test(n.nodeId ?? "")) && t; }, "the list");
  // The default width is a convenience; a test that names a width needs the resize handler.
  try { m.resize(list, width ?? 400); } catch (error) { if (width !== undefined) throw error; }
  return { m, git, list: m.render() };
}

async function open(s, path) {
  s.m.click(findById(s.m.render(), `change-${path}`));
  return until(() => {
    const t = s.m.render();
    return (findById(t, "diff-code") || findById(t, "diff-notice")) && !texts(t).includes("Loading diff…") && t;
  }, `the diff of ${path}`);
}

const order = (tree) => walk(tree).map((n) => n.nodeId).filter((id) => /^change-/.test(id ?? "")).map((id) => id.slice(7));
const patchCalls = (git) => git.calls.filter(([cmd, args]) => cmd === "git" && args.includes("-U3"));
const vlist = (tree) => walk(tree).find((n) => n.kind === "vlist");
const allRows = (tree) => rowsOf(tree, [0, vlist(tree).arg.count]);
const pathOf = (tree) => texts(findById(tree, "diff-path"));
const hasCall = (node, name) => node.calls.some(([n]) => n === name);
const svgs = (node) => walk(node).filter((n) => n.kind === "svg").map((n) => n.arg);
const holder = (node, str) => walk(node).find((n) => n.kids.includes(str));

// The nodes from `node` down to the first one that holds `str` as a child.
function chain(node, str, path = []) {
  const here = [...path, node];
  if (node.kids.includes(str)) return here;
  for (const kid of node.kids) {
    if (kid && typeof kid === "object") {
      const found = chain(kid, str, here);
      if (found) return found;
    }
  }
  return null;
}
const colorOf = (nodes) => {
  for (const n of [...nodes].reverse()) {
    const call = n.calls.filter(([k]) => k === "text_color").at(-1);
    if (call) return call[1][0];
  }
  return null;
};

// AC17
test("AC17 header: paddings, ids, tooltips, semibold name over a 10.5 muted path, both truncated", async () => {
  const s = await setup();
  const tree = await open(s, "src/a.js");
  const header = findById(tree, "diff-header");
  for (const [name, value] of [["pt", 2], ["pr", 8], ["pb", 6], ["pl", 8], ["gap", 4]]) assert.ok(has(header, name, value), `${name} ${value}`);
  for (const id of ["diff-back", "diff-path", "diff-mode-unified", "diff-mode-split", "diff-prev", "diff-next", "diff-open-files"]) {
    assert.ok(findById(header, id), `${id} is in the header`);
  }
  assert.ok(has(findById(tree, "diff-back"), "tooltip", "Back to the changes"));
  assert.ok(svgs(findById(tree, "diff-back")).some((p) => p.endsWith("chevron-left.svg")));
  assert.ok(has(findById(tree, "diff-prev"), "tooltip", "Previous file"));
  assert.ok(has(findById(tree, "diff-next"), "tooltip", "Next file"));
  assert.ok(has(findById(tree, "diff-open-files"), "tooltip", "Open in Files"));
  assert.ok(texts(findById(tree, "diff-mode-unified")).includes("Unified"));
  assert.ok(texts(findById(tree, "diff-mode-split")).includes("Split"));
  assert.deepEqual(pathOf(tree), ["a.js", "src/a.js"]);
  const name = holder(findById(tree, "diff-path"), "a.js");
  assert.ok(hasCall(name, "font_semibold") && hasCall(name, "truncate"));
  const path = holder(findById(tree, "diff-path"), "src/a.js");
  assert.ok(has(path, "text_size", 10.5) && has(path, "text_color", THEME.muted) && hasCall(path, "truncate"));
});

// AC18
test("AC18 back shows the list again and runs no command", async () => {
  const s = await setup();
  const tree = await open(s, "src/a.js");
  const before = s.git.calls.length;
  s.m.click(findById(tree, "diff-back"));
  const out = s.m.render();
  assert.equal(findById(out, "diff-view"), null);
  assert.deepEqual(order(out), ["b.txt", "c.txt", "src/a.js", "new.txt"]);
  await settle();
  assert.equal(s.git.calls.length, before, "no exec after back");
});

// AC19
test("AC19 Open in Files selects Files and opens <root>/<path>", async () => {
  const s = await setup();
  const opened = [];
  s.m.files.open = (...args) => { opened.push(args); };
  const tree = await open(s, "src/a.js");
  s.m.click(findById(tree, "diff-open-files"));
  assert.deepEqual(s.m.selected, ["files"]);
  assert.equal(opened.length, 1);
  assert.equal(opened[0][0], `${ROOT}/src/a.js`);
});

// AC20
test("AC20 previous and next move by list order; at an end the button is muted, has no hover and changes nothing", async () => {
  const s = await setup();
  let tree = await open(s, "c.txt");
  assert.ok(hasCall(findById(tree, "diff-prev"), "hover") && hasCall(findById(tree, "diff-next"), "hover"));
  s.m.click(findById(tree, "diff-next"));
  tree = await until(() => { const t = s.m.render(); return pathOf(t).includes("src/a.js") && t; }, "next file");
  s.m.click(findById(tree, "diff-prev"));
  tree = await until(() => { const t = s.m.render(); return pathOf(t).includes("c.txt") && t; }, "previous file");
  s.m.click(findById(tree, "diff-prev"));
  tree = await until(() => { const t = s.m.render(); return pathOf(t).includes("b.txt") && t; }, "first file");
  const prev = findById(tree, "diff-prev");
  assert.ok(has(prev, "text_color", THEME.muted));
  assert.equal(hasCall(prev, "hover"), false, "no hover at the first row");
  if (prev.onClick) s.m.click(prev);
  await settle();
  assert.ok(pathOf(s.m.render()).includes("b.txt"), "a click at the start changes nothing");
});

test("AC20 the last file has a muted next button with no hover", async () => {
  const s = await setup();
  const tree = await open(s, "new.txt");
  const next = findById(tree, "diff-next");
  assert.ok(has(next, "text_color", THEME.muted));
  assert.equal(hasCall(next, "hover"), false);
  if (next.onClick) s.m.click(next);
  await settle();
  assert.ok(pathOf(s.m.render()).includes("new.txt"));
  assert.ok(hasCall(findById(tree, "diff-prev"), "hover"));
});

// AC21
test("AC21 tabs: one per listed file in order, name and counts, a 2 px accent line on the open one, a click opens, scroll_to_item", async () => {
  const s = await setup();
  const dk = dkOf();
  const tree = await open(s, "src/a.js");
  const tabs = findById(tree, "diff-tabs");
  assert.deepEqual(walk(tabs).map((n) => n.nodeId).filter((id) => /^diff-tab-/.test(id ?? "")), order(s.list).map((p) => `diff-tab-${p}`));
  assert.ok(walk(tabs).some((n) => n.calls.some(([k]) => /overflow_x|track_scroll/.test(k))), "the tabs scroll on x");
  const b = findById(tabs, "diff-tab-b.txt");
  assert.ok(texts(b).includes("b.txt"));
  assert.ok(has(holder(b, "+1"), "text_color", dk.addText));
  assert.ok(has(holder(b, `${MINUS}2`), "text_color", dk.delText));
  const line = (tab) => walk(tab).find((n) => has(n, "h", 2) && has(n, "bg", THEME.accent));
  assert.ok(line(findById(tabs, "diff-tab-src/a.js")), "the open tab has the accent line");
  assert.equal(line(findById(tabs, "diff-tab-b.txt")), undefined, "the others have none");
  assert.ok(handles.some((h) => h.scrolls.some(([i]) => i === 2)), "scroll_to_item(2) for the open tab");
  s.m.click(findById(tabs, "diff-tab-c.txt"));
  const next = await until(() => { const t = s.m.render(); return pathOf(t).includes("c.txt") && t; }, "the clicked tab");
  assert.ok(line(findById(next, "diff-tab-c.txt")));
});

// AC22
test("AC22 the diff view has no origin row", async () => {
  const s = await setup();
  const tree = await open(s, "src/a.js");
  assert.equal(findById(tree, "diff-origin"), null);
});

// AC25
test("AC25 unified rows: context, del, add with their numbers, signs and word pieces", async () => {
  const s = await setup();
  const dk = dkOf();
  const tree = await open(s, "src/a.js");
  const rows = allRows(tree);
  assert.equal(rows.length, 6);
  assert.equal(texts(rows[0]).join(""), "Line 1 · function main() {");
  assert.deepEqual(texts(rows[1]), ["1", "1", " ", "keep"]);
  assert.deepEqual(texts(rows[2]).slice(0, 3), ["2", "", MINUS]);
  assert.equal(texts(rows[2]).slice(3).join(""), "old line");
  assert.ok(walk(rows[2]).some((n) => has(n, "bg", dk.delLine)), "the del line tint");
  assert.ok(has(holder(rows[2], "old"), "bg", dk.delWord), "the changed piece has the del word tint");
  assert.deepEqual(texts(rows[3]).slice(0, 3), ["", "2", "+"]);
  assert.equal(texts(rows[3]).slice(3).join(""), "new line");
  assert.ok(walk(rows[3]).some((n) => has(n, "bg", dk.addLine)), "the add line tint");
  assert.ok(has(holder(rows[3], "new"), "bg", dk.addWord));
  assert.deepEqual(texts(rows[4]), ["3", "3", " ", "tail"]);
  assert.deepEqual(texts(rows[5]), ["4", "4", " ", "more"]);
  assert.ok(walk(rows[0]).some((n) => has(n, "bg", dk.hunk)), "the hunk row tint");
});

test("AC25 a no-newline marker is a muted note row with no numbers", async () => {
  const s = await setup();
  const dk = dkOf();
  const tree = await open(s, "c.txt");
  const rows = allRows(tree);
  assert.equal(rows.length, 5);
  for (const i of [2, 4]) {
    assert.ok(texts(rows[i]).join("").includes("No newline at end of file"));
    assert.ok(texts(rows[i]).every((t) => !/^\d+$/.test(t)), "no numbers on a note");
    assert.ok(walk(rows[i]).some((n) => has(n, "text_color", dk.numText)));
  }
});

test("AC25 a rename starts with the note Renamed from <old path>", async () => {
  const s = await setup({
    stat: `## main\0R  new name.txt\0old name.txt\0`,
    nums: "1\t0\t\0old name.txt\0new name.txt\0",
    patches: { "new name.txt": patch("new name.txt", "@@ -1 +1,2 @@", " same", "+more") },
  });
  const tree = await open(s, "new name.txt");
  assert.ok(texts(allRows(tree)[0]).join("").includes("Renamed from old name.txt"));
  const [, args] = patchCalls(s.git)[0];
  assert.ok(args.includes("old name.txt") && args.includes("new name.txt"), "both paths reach git");
});

test("AC25 split rows: one number per side, the filler holds the hatch svg", async () => {
  const s = await setup({ width: 800 });
  const tree = await open(s, "b.txt");
  const rows = allRows(tree);
  assert.equal(rows.length, 4, "hunk, context, two pairs");
  assert.deepEqual(texts(rows[1]), ["1", " ", "one", "1", " ", "one"]);
  assert.deepEqual(texts(rows[2]), ["2", MINUS, "two", "2", "+", "TWO"]);
  assert.deepEqual(texts(rows[3]), ["3", MINUS, "three"]);
  assert.ok(svgs(rows[3]).includes("mods/herdsidian/diff-hatch.svg"), "the empty right cell is hatched");
  assert.equal(svgs(rows[2]).length, 0);
});

test("AC25 unified rows of the same file: a del run is followed by the adds", async () => {
  const s = await setup({ width: 800 });
  s.m.click(findById(s.m.render(), "change-b.txt"));
  const tree = await until(() => { const t = s.m.render(); return findById(t, "diff-mode-unified") && findById(t, "diff-code") && t; }, "the diff");
  s.m.click(findById(tree, "diff-mode-unified"));
  const rows = allRows(s.m.render());
  assert.deepEqual(rows.map((r) => texts(r).slice(0, 3)).slice(1), [["1", "1", " "], ["2", "", MINUS], ["3", "", MINUS], ["", "2", "+"]]);
});

// AC28
test("AC28 519 gives unified plus the note; 520 gives split with no click; Unified picked stays unified", async () => {
  const s = await setup({ width: 519 });
  let tree = await open(s, "b.txt");
  assert.equal(vlist(tree).arg.count, 5, "unified rows");
  assert.deepEqual(texts(findById(tree, "diff-note")), ["Split needs a sidebar of 520 px or more: shown unified."]);
  s.m.resize(tree, 520);
  tree = s.m.render();
  assert.equal(vlist(tree).arg.count, 4, "split rows with no click");
  assert.equal(findById(tree, "diff-note"), null);
  s.m.click(findById(tree, "diff-mode-unified"));
  s.m.resize(tree, 800);
  tree = s.m.render();
  assert.equal(vlist(tree).arg.count, 5, "Unified picked stays unified at 800");
  assert.equal(findById(tree, "diff-note"), null, "no note: the person chose it");
});

test("AC28 the zoom divides the size", async () => {
  world.zoom = 1.1;
  const s = await setup({ width: 570 });
  const tree = await open(s, "b.txt");
  assert.equal(vlist(tree).arg.count, 5, "570 / 1.1 is under 520: unified");
  assert.ok(findById(tree, "diff-note"));
});

// AC29
test("AC29 every text piece of a row is dk.text and no ansi3 to ansi6 color is drawn in diff-code", async () => {
  const s = await setup();
  const dk = dkOf();
  const tree = await open(s, "src/a.js");
  const rows = allRows(tree);
  for (const row of rows.slice(1)) {
    for (const piece of texts(row).slice(3)) assert.equal(colorOf(chain(row, piece)), dk.text, `piece "${piece}"`);
  }
  const used = [...walk(findById(tree, "diff-code")), ...rows.flatMap((r) => walk(r))]
    .flatMap((n) => n.calls.flatMap(([, args]) => args.filter((a) => typeof a === "string")));
  for (const color of [THEME.ansi3, THEME.ansi4, THEME.ansi5, THEME.ansi6]) assert.equal(used.includes(color), false, `${color} not drawn`);
});

// AC30
test("AC30 one virtual list with the row count; a render builds end - start rows; 2500 lines give 2000 and a last note", async () => {
  const text = Array.from({ length: 2500 }, (_, i) => `line ${i + 1}`).join("\n");
  const s = await setup({ files: { [`${ROOT}/new.txt`]: text } });
  const tree = await open(s, "new.txt");
  const lists = walk(findById(tree, "diff-code")).filter((n) => n.kind === "vlist");
  assert.equal(lists.length, 1);
  assert.equal(lists[0].arg.id, "diff-lines");
  assert.equal(lists[0].arg.count, 2002, "one hunk row, 2000 lines, the note");
  assert.equal(texts(tree).some((t) => t.startsWith("line ")), false, "no line element in the tree");
  assert.equal(rowsOf(tree, [10, 15]).length, 5);
  const rows = rowsOf(tree, [1, 2001]);
  assert.ok(rows.every((r) => texts(r)[2] === "+"), "2000 add rows");
  assert.deepEqual(texts(rowsOf(tree, [2001, 2002])[0]), ["Showing the first 2000 of 2500 lines."]);
  assert.equal(texts(rowsOf(tree, [0, 1])[0]).join(""), "Line 1");
});

// AC31 (2026-11-26, scope change by Andersson): a long line wraps onto more rows of ROW_H; no wheel pans the code.
const longPatch = (a, b) => ({ stat: status(" M l.txt"), nums: numstat("1\t1\tl.txt"), patches: { "l.txt": patch("l.txt", "@@ -1 +1 @@", `-${a}`, `+${b}`) } });
const codeOf = (row) => texts(row).slice(3).join("");

test("AC31 unified: a long line wraps onto rows that fit the cell; the next rows have no numbers and no sign", async () => {
  const b = `R${"b".repeat(199)}`;
  const s = await setup({ ...longPatch("a", b), width: 400 });
  const tree = await open(s, "l.txt");
  const rows = allRows(tree);
  assert.ok(rows.length > 4, `more rows than the 3 lines: ${rows.length}`);
  const first = rows.findIndex((r) => texts(r)[2] === "+");
  const pieces = rows.slice(first).map(codeOf);
  assert.equal(pieces.join(""), b, "the pieces hold the whole line in order");
  const cols = Math.max(...pieces.map((p) => p.length));
  assert.ok(cols * diff.CHAR_W <= 400 - diff.gutter([], "unified"), "every piece fits the cell");
  assert.deepEqual(texts(rows[first]).slice(0, 3), ["", "1", "+"]);
  for (const r of rows.slice(first + 1)) assert.deepEqual(texts(r).slice(0, 3), ["", "", ""], "a next row has no number and no sign");
});

test("AC31 split: the pair takes the rows of its longer side; the short side goes on with an empty cell, not the filler", async () => {
  const a = `L${"a".repeat(149)}`;
  const s = await setup({ ...longPatch(a, "Rz"), width: 800 });
  const tree = await open(s, "l.txt");
  const rows = allRows(tree).slice(1);
  assert.ok(rows.length > 1, "the old side wraps");
  assert.equal(rows.map((r) => texts(r).filter((x) => /^L?a+$/.test(x)).join("")).join(""), a);
  assert.ok(rows.every((r) => svgs(r).length === 0), "no hatch filler: both sides have a line");
  assert.ok(texts(rows[0]).includes("Rz"));
  for (const r of rows.slice(1)) assert.equal(texts(r).includes("Rz"), false);
});

test("AC31 a narrower tab wraps the same line onto more rows", async () => {
  const b = `R${"b".repeat(299)}`;
  const s = await setup({ ...longPatch("a", b), width: 500 });
  const wide = vlist(await open(s, "l.txt")).arg.count;
  s.m.resize(s.m.render(), 300);
  const narrow = vlist(s.m.render()).arg.count;
  assert.ok(narrow > wide, `${narrow} rows at 300 px, ${wide} at 500 px`);
});

test("AC31 split to unified cuts the line again for the wider unified cell", async () => {
  const b = `R${"b".repeat(149)}`;
  const s = await setup({ ...longPatch("a", b), width: 800 });
  const tree = await open(s, "l.txt");
  const split = vlist(tree).arg.count;
  s.m.click(findById(tree, "diff-mode-unified"));
  const unified = allRows(s.m.render());
  const first = unified.findIndex((r) => texts(r)[2] === "+");
  assert.equal(unified.slice(first).map(codeOf).join(""), b, "the unified pieces hold the whole line");
  assert.ok(unified.length - first < split - 1, `fewer rows for the line in unified (${unified.length - first}) than in split (${split - 1})`);
});

test("AC31 the code area has no wheel handler and no cell is moved sideways", async () => {
  const s = await setup({ ...longPatch(`L${"a".repeat(200)}`, `R${"b".repeat(200)}`) });
  const tree = await open(s, "l.txt");
  assert.equal(hasCall(findById(tree, "diff-code"), "on_scroll_wheel"), false);
  assert.equal(allRows(tree).some((r) => walk(r).some((n) => hasCall(n, "left") || hasCall(n, "flex_wrap") || hasCall(n, "whitespace_normal"))), false);
});

// AC35
test("AC35 a binary file by numstat shows the notice with back, and runs no patch", async () => {
  const s = await setup({ stat: status(" M d.bin"), nums: numstat("-\t-\td.bin"), patches: {} });
  const tree = await open(s, "d.bin");
  assert.deepEqual(texts(findById(tree, "diff-notice")), ["Binary file, no preview"]);
  assert.ok(findById(tree, "diff-back"));
  assert.equal(patchCalls(s.git).length, 0);
});

test("AC35 a binary file by the patch text shows the same notice", async () => {
  const text = "diff --git a/e.bin b/e.bin\nindex 1111111..2222222 100644\nBinary files a/e.bin and b/e.bin differ\n";
  const s = await setup({ stat: status(" M e.bin"), nums: numstat("1\t1\te.bin"), patches: { "e.bin": text } });
  const tree = await open(s, "e.bin");
  assert.deepEqual(texts(findById(tree, "diff-notice")), ["Binary file, no preview"]);
  assert.equal(patchCalls(s.git).length, 1);
});

// AC36
test("AC36 a deleted file is all del rows", async () => {
  const dk = dkOf();
  const text = patch("gone.txt", "@@ -1,2 +0,0 @@", "-x", "-y");
  const s = await setup({ stat: status(" D gone.txt"), nums: numstat("0\t2\tgone.txt"), patches: { "gone.txt": text } });
  const tree = await open(s, "gone.txt");
  const rows = allRows(tree);
  assert.equal(rows.length, 3);
  for (const row of rows.slice(1)) {
    assert.equal(texts(row)[2], MINUS);
    assert.ok(walk(row).some((n) => has(n, "bg", dk.delLine)));
  }
});

test("AC36 a file in conflict shows git's patch with no merge action", async () => {
  const text = patch("conf.txt", "@@ -1 +1,5 @@", "+<<<<<<< HEAD", "+mine", "+=======", "+theirs", "+>>>>>>> other");
  const s = await setup({ stat: status("UU conf.txt"), nums: numstat("5\t0\tconf.txt"), patches: { "conf.txt": text } });
  const tree = await open(s, "conf.txt");
  const rows = allRows(tree);
  assert.equal(rows.length, 6);
  assert.ok(texts(rows[1]).join("").includes("<<<<<<< HEAD"));
  assert.equal(texts(tree).some((t) => /accept|resolve|merge/i.test(t)), false, "no merge action");
});

// AC37
test("AC37 a watch refresh reads the open patch once and updates the tab counts", async () => {
  const phase = { n: 0 };
  const s = await setup({ gitOptions: { numstat: () => (phase.n ? numstat("1\t2\tb.txt", "1\t1\tc.txt", "5\t4\tsrc/a.js") : NUMSTAT) } });
  const dk = dkOf();
  await open(s, "src/a.js");
  assert.equal(patchCalls(s.git).length, 1);
  const before = s.m.watch.rev;
  phase.n = 1;
  const watcher = world.watchers.filter((w) => w.root === ROOT).at(-1);
  watcher.resolve([`${ROOT}/src/a.js`]);
  await until(() => s.m.watch.rev > before, "the refresh");
  await until(() => { s.m.render(); return patchCalls(s.git).length >= 2; }, "the second patch read");
  await settle();
  assert.equal(patchCalls(s.git).length, 2, "exactly one more patch exec");
  const tab = findById(s.m.render(), "diff-tab-src/a.js");
  assert.ok(has(holder(tab, "+5"), "text_color", dk.addText));
  assert.ok(texts(tab).includes(`${MINUS}4`));
});

test("AC37 a file that left the list shows the notice and the back button", async () => {
  const phase = { n: 0 };
  const s = await setup({ gitOptions: { status: () => (phase.n ? status(" M b.txt", " M c.txt") : STATUS) } });
  await open(s, "src/a.js");
  const before = s.m.watch.rev;
  phase.n = 1;
  world.watchers.filter((w) => w.root === ROOT).at(-1).resolve([`${ROOT}/src/a.js`]);
  await until(() => s.m.watch.rev > before, "the refresh");
  const tree = await until(() => { const t = s.m.render(); return texts(t).includes("This file has no changes any more.") && t; }, "the notice");
  assert.ok(findById(tree, "diff-back"));
});

// AC38
test("AC38 a failed patch shows the first line of stderr and the back button", async () => {
  const s = await setup({ gitOptions: { fail: "patch" } });
  const tree = await open(s, "b.txt");
  assert.deepEqual(texts(findById(tree, "diff-notice")), ["fake patch failure"]);
  assert.ok(findById(tree, "diff-back"));
});

// AC39
test("AC39 focus to another repo closes the diff and shows that repo's list", async () => {
  const s = await setup();
  await open(s, "src/a.js");
  fakeGit({ top: "/work/other", status: status(" M x.txt"), numstat: numstat("1\t1\tx.txt") });
  world.panes = [...world.panes, { pane: "p2", cwd: "/work/other" }];
  world.focused = { pane: "p2" };
  const tree = await until(() => { const t = s.m.render(); return findById(t, "change-x.txt") && t; }, "the other repo's list");
  assert.equal(findById(tree, "diff-view"), null);
});

test("AC39 another pane in the same repo keeps the diff", async () => {
  const s = await setup();
  await open(s, "src/a.js");
  world.panes = [...world.panes, { pane: "p3", cwd: `${ROOT}/src` }];
  world.focused = { pane: "p3" };
  s.m.render();
  await settle();
  await settle();
  const tree = s.m.render();
  assert.ok(findById(tree, "diff-view"));
  assert.deepEqual(pathOf(tree), ["a.js", "src/a.js"]);
});

test("AC39 a git error in the same repo keeps the diff", async () => {
  const s = await setup();
  await open(s, "src/a.js");
  fakeGit({ fail: "status" });
  const before = s.m.watch.rev;
  world.watchers.filter((w) => w.root === ROOT).at(-1).resolve([`${ROOT}/src/a.js`]);
  await until(() => s.m.watch.rev > before, "the failed refresh");
  assert.equal(s.m.watch.data.state, "error");
  const tree = s.m.render();
  assert.ok(findById(tree, "diff-view"), "the diff stays");
  assert.deepEqual(pathOf(tree), ["a.js", "src/a.js"]);
});

// AC40
test("AC40 a remote location passes { on } to the patch exec and to readTextFile", async () => {
  const s = await setup({ space: { machine: "box" } });
  const reads = [];
  state.readTextFile = async (path, opts) => { reads.push([path, opts]); return "x\n"; };
  await open(s, "b.txt");
  assert.equal(patchCalls(s.git)[0][2].on, "box");
  s.m.click(findById(s.m.render(), "diff-back"));
  await open(s, "new.txt");
  assert.deepEqual(reads, [[`${ROOT}/new.txt`, { on: "box" }]]);
});

// AC41
test("AC41 [ ] s and escape act and stop; another key does neither; a left press focuses", async () => {
  const s = await setup({ width: 800 });
  let tree = await open(s, "c.txt");
  assert.equal(s.m.key(tree, "]"), true);
  tree = await until(() => { const t = s.m.render(); return pathOf(t).includes("src/a.js") && t; }, "the next file");
  assert.equal(s.m.key(tree, "["), true);
  tree = await until(() => { const t = s.m.render(); return pathOf(t).includes("c.txt") && t; }, "the previous file");
  const split = vlist(tree).arg.count;
  assert.equal(s.m.key(tree, "s"), true);
  assert.notEqual(vlist(s.m.render()).arg.count, split, "s switches the mode");
  const stops = s.m.stops.count;
  assert.equal(s.m.key(s.m.render(), "a"), false);
  assert.equal(s.m.stops.count, stops, "a is left alone");
  assert.ok(pathOf(s.m.render()).includes("c.txt"));
  assert.equal(s.m.key(s.m.render(), "escape"), true);
  assert.equal(findById(s.m.render(), "diff-view"), null, "escape goes back");
});

test("AC41 a left mouse press in diff-view calls focus()", async () => {
  const s = await setup();
  const tree = await open(s, "c.txt");
  const press = findById(tree, "diff-view").calls.find(([name, args]) => name === "on_mouse_down" && args[0] === "left");
  assert.ok(press, "diff-view has a left press handler");
  const before = s.m.handles.reduce((sum, h) => sum + h.focuses, 0);
  during(s.m.cx, (c) => press[1][1]({ button: "left" }, c));
  assert.ok(s.m.handles.reduce((sum, h) => sum + h.focuses, 0) > before);
});

// AC43
test("AC43 glass on: diff-code has the well; header and tabs do not", async () => {
  const s = await setup({ theme: GLASS });
  const dk = dkOf(GLASS);
  assert.ok(dk.well, "the glass gives a well");
  const tree = await open(s, "src/a.js");
  assert.ok(has(findById(tree, "diff-code"), "bg", dk.well));
  assert.equal(walk(findById(tree, "diff-header")).some((n) => has(n, "bg", dk.well)), false);
  assert.equal(walk(findById(tree, "diff-tabs")).some((n) => has(n, "bg", dk.well)), false);
});

test("AC43 glass off: diff-code has no bg", async () => {
  const s = await setup();
  const tree = await open(s, "src/a.js");
  assert.equal(hasCall(findById(tree, "diff-code"), "bg"), false);
});

// AC25 / AC35: the rename note shows above the notice, not only inside the row list.
test("AC25 a pure rename with no hunk shows Renamed from above No text changes", async () => {
  const text = "diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n";
  const s = await setup({ stat: `## main\0R  new.txt\0old.txt\0`, nums: "0\t0\t\0old.txt\0new.txt\0", patches: { "new.txt": text } });
  const tree = await open(s, "new.txt");
  const nodes = walk(tree);
  const note = nodes.findIndex((n) => n.kids.some((k) => typeof k === "string" && k.includes("Renamed from old.txt")));
  assert.ok(note >= 0, "the note is drawn");
  assert.ok(texts(findById(tree, "diff-notice")).includes("No text changes"));
  assert.ok(note < nodes.findIndex((n) => n.nodeId === "diff-notice"), "the note is above the notice");
});

test("AC35 a renamed binary file shows Renamed from above Binary file, no preview", async () => {
  const s = await setup({ stat: `## main\0R  new.bin\0old.bin\0`, nums: "-\t-\t\0old.bin\0new.bin\0", patches: {} });
  const tree = await open(s, "new.bin");
  const nodes = walk(tree);
  const note = nodes.findIndex((n) => n.kids.some((k) => typeof k === "string" && k.includes("Renamed from old.bin")));
  assert.ok(note >= 0, "the note is drawn");
  assert.ok(texts(findById(tree, "diff-notice")).includes("Binary file, no preview"));
  assert.ok(note < nodes.findIndex((n) => n.nodeId === "diff-notice"), "the note is above the notice");
});

// AC25: the number column follows the widest number. Only the relative width is checked.
test("AC25 the line-number column grows with the widest number", async () => {
  const gutter = async (start) => {
    reset();
    const text = patch("n.txt", `@@ -${start},1 +${start},2 @@`, " same", "+more");
    const s = await setup({ stat: status(" M n.txt"), nums: numstat("1\t0\tn.txt"), patches: { "n.txt": text }, width: 400 });
    const row = allRows(await open(s, "n.txt"))[1];
    const sized = chain(row, String(start)).reverse().map((n) => n.calls.find(([k]) => k === "w" || k === "min_w")).find(Boolean);
    assert.ok(sized, `the number ${start} has a width`);
    return sized[1][0];
  };
  const narrow = await gutter(12);
  const wide = await gutter(123456);
  assert.ok(wide > narrow, `${wide} should be larger than ${narrow}`);
});

// Holds every patch exec until release(); `started` lists the patch commands that began.
function holdPatches() {
  const orig = state.exec, started = [], waiters = [];
  let open = false;
  state.exec = async (cmd, args, opts) => {
    if (cmd === "git" && args.includes("-U3")) {
      started.push(args);
      if (!open) await new Promise((resolve) => { waiters.push(resolve); });
    }
    return orig(cmd, args, opts);
  };
  return { started, release: () => { open = true; waiters.forEach((w) => w()); } };
}
const refresh = async (s) => {
  const before = s.m.watch.rev;
  world.watchers.filter((w) => w.root === ROOT).at(-1).resolve([`${ROOT}/b.txt`]);
  await until(() => s.m.watch.rev > before, "a watch refresh");
};

test("AC38 the loading view has the real header, the mode toggle and no list", async () => {
  const s = await setup();
  const hold = holdPatches();
  s.m.click(findById(s.m.render(), "change-b.txt"));
  await until(() => hold.started.length === 1, "the first patch exec");
  const tree = s.m.render();
  assert.ok(findById(tree, "diff-view"));
  assert.deepEqual(pathOf(tree), ["b.txt", "b.txt"]);
  assert.ok(findById(tree, "diff-mode-unified") && findById(tree, "diff-mode-split"));
  assert.ok(texts(tree).includes("Loading diff…"));
  assert.equal(vlist(tree), undefined, "no virtual list yet");
  assert.ok(!findById(tree, "diff-notice"), "loading is not a notice");
  hold.release();
});

test("AC37 a pending read is not restarted by a watch refresh; one re-read follows", async () => {
  const s = await setup();
  const hold = holdPatches();
  s.m.click(findById(s.m.render(), "change-b.txt"));
  await until(() => hold.started.length === 1, "the first patch exec");
  await refresh(s);
  s.m.render();
  await settle();
  assert.equal(hold.started.length, 1, "no second exec while the first is pending");
  hold.release();
  await until(() => hold.started.length === 2, "the one re-read");
  await until(() => { const t = s.m.render(); return findById(t, "diff-code") && !texts(t).includes("Loading diff…") && t; }, "the diff");
  for (let i = 0; i < 10; i++) await settle();
  assert.equal(hold.started.length, 2, "exactly one re-read");
});

// AC15: nothing is read while the store says another tab; one re-read follows on return.
test("AC15 a read finishing on another tab starts no new read; coming back starts one", async () => {
  const s = await setup();
  await open(s, "src/a.js");
  const hold = holdPatches();
  await refresh(s);
  await until(() => hold.started.length === 1, "the held re-read");
  state.shared["herdsidian.sidebar"] = { tab: "files" };
  await refresh(s);
  hold.release();
  for (let i = 0; i < 10; i++) await settle();
  assert.equal(hold.started.length, 1, "no patch exec while the store says files");
  state.shared["herdsidian.sidebar"] = { tab: "changes" };
  s.m.render();
  await until(() => hold.started.length === 2, "the re-read on return");
  for (let i = 0; i < 10; i++) await settle();
  assert.equal(hold.started.length, 2, "exactly one re-read");
});
