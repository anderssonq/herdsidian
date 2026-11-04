import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MENU, ACTION_KEY, menuItems, menuSize, placeMenu, validateName, noteFileName, nextUntitled, takenName, isSameItem, safeRel,
  under, movePath, movedState, removedState, pendingAction, folderCounts, deleteDetail, resultMessage,
} from "../mods/herdsidian/actions.js";

const NFC = "café", NFD = "café";

// menuItems
test("a folder row offers New note, New folder, Rename, Delete in this order", () => {
  assert.deepEqual(menuItems("dir"), [
    { id: "new-note", label: "New note" }, { id: "new-folder", label: "New folder" },
    { id: "rename", label: "Rename" }, { id: "delete", label: "Delete" },
  ]);
});

test("a note row offers Rename and Delete only", () => {
  assert.deepEqual(menuItems("note").map((r) => r.label), ["Rename", "Delete"]);
});

test("empty space offers New note and New folder, never Rename or Delete for the root", () => {
  assert.deepEqual(menuItems("root").map((r) => r.id), ["new-note", "new-folder"]);
});

test("an unknown kind has no rows", () => {
  assert.deepEqual(menuItems("other"), []);
});

test("the action key and menu constants are the contract values", () => {
  assert.equal(ACTION_KEY, "herdsidian.vault-action");
  assert.deepEqual(MENU, { width: 180, row: 30, pad: 10, margin: 8 });
});

// placeMenu
const view = { width: 1440, height: 901 };

test("keeps the pointer when the menu fits", () => {
  assert.deepEqual(placeMenu({ x: 100, y: 200 }, 4, view), { at: { x: 100, y: 200 }, width: 180, height: 130 });
});

test("moves the menu left of the right edge at zoom 1", () => {
  const r = placeMenu({ x: 1435, y: 100 }, 4, view);
  assert.deepEqual(r.at, { x: 1440 - 180 - 8, y: 100 });
});

test("moves the menu above the bottom edge at zoom 1", () => {
  const r = placeMenu({ x: 100, y: 895 }, 4, view);
  assert.deepEqual(r.at, { x: 100, y: 901 - 130 - 8 });
});

test("clamps both axes in the corner at zoom 1", () => {
  const r = placeMenu({ x: 1438, y: 899 }, 4, view);
  assert.deepEqual(r.at, { x: 1252, y: 763 });
});

test("clamps with the grown size at zoom 1.1 and leaves the pointer scale alone", () => {
  const right = placeMenu({ x: 1435, y: 100 }, 4, view, 1.1);
  assert.deepEqual(right.at, { x: 1440 - 180 * 1.1 - 8, y: 100 });
  const bottom = placeMenu({ x: 100, y: 895 }, 4, view, 1.1);
  assert.deepEqual(bottom.at, { x: 100, y: 901 - 130 * 1.1 - 8 });
  const corner = placeMenu({ x: 1438, y: 899 }, 4, view, 1.1);
  assert.deepEqual(corner.at, { x: 1440 - 180 * 1.1 - 8, y: 901 - 130 * 1.1 - 8 });
});

test("returns the unscaled width and height at zoom 1.1", () => {
  const r = placeMenu({ x: 1438, y: 899 }, 2, view, 1.1);
  assert.equal(r.width, 180);
  assert.equal(r.height, 70);
});

test("a zoom that is not a positive number counts as 1", () => {
  const base = placeMenu({ x: 1438, y: 899 }, 4, view, 1);
  for (const z of [0, -2, NaN, Infinity, "1.1", null]) assert.deepEqual(placeMenu({ x: 1438, y: 899 }, 4, view, z), base, String(z));
});

test("a small viewport pins the menu to the margin", () => {
  const r = placeMenu({ x: 50, y: 50 }, 4, { width: 100, height: 80 });
  assert.deepEqual(r.at, { x: 8, y: 8 });
});

test("a pointer before the margin is pulled to the margin", () => {
  assert.deepEqual(placeMenu({ x: 0, y: 0 }, 2, view).at, { x: 8, y: 8 });
});

test("a viewport that is not a number gives at: pointer with the same size", () => {
  for (const v of [null, undefined, {}, { width: "1440", height: 900 }, { width: NaN, height: 900 }]) {
    assert.deepEqual(placeMenu({ x: 1, y: 2 }, 3, v), { at: "pointer", width: 180, height: 100 });
  }
});

test("a pointer that is not a number gives at: pointer", () => {
  assert.equal(placeMenu(null, 3, view).at, "pointer");
  assert.equal(placeMenu({ x: "1", y: 2 }, 3, view).at, "pointer");
});

test("the height is rows times 30 plus 10", () => {
  assert.equal(placeMenu({ x: 0, y: 0 }, 2, view).height, 70);
  assert.equal(placeMenu({ x: 0, y: 0 }, 4, view).height, 130);
});

test("menuSize is rows times 30 plus 10 at the menu width", () => {
  assert.deepEqual(menuSize("dir"), { width: MENU.width, height: 130 });
  assert.deepEqual(menuSize("note"), { width: MENU.width, height: 70 });
  assert.deepEqual(menuSize("root"), { width: MENU.width, height: 70 });
});

// validateName
test("accepts a name and trims it first", () => {
  assert.deepEqual(validateName("  Notes  "), { ok: true, name: "Notes" });
});

test("refuses an empty name and a name of only spaces, each with a reason", () => {
  for (const t of ["", "   ", "\t", undefined, null]) {
    const r = validateName(t);
    assert.equal(r.ok, false);
    assert.match(r.reason, /empty/);
  }
});

test("refuses a slash", () => {
  const r = validateName("a/b");
  assert.equal(r.ok, false);
  assert.match(r.reason, /"\/"/);
});

test("refuses . and .. with their own reason", () => {
  for (const t of [".", " .. "]) {
    const r = validateName(t);
    assert.equal(r.ok, false);
    assert.match(r.reason, /"\." or "\.\."/);
  }
});

test("refuses a leading dot, also after trimming", () => {
  for (const t of [".foo", " .hidden"]) {
    const r = validateName(t);
    assert.equal(r.ok, false);
    assert.match(r.reason, /start with/);
  }
});

test("refuses node_modules", () => {
  const r = validateName(" node_modules ");
  assert.equal(r.ok, false);
  assert.match(r.reason, /node_modules/);
});

test("refuses a control character inside the name", () => {
  for (const t of ["a\u0000b", "a\tb", "a\nb", "a\u007fb"]) {
    const r = validateName(t);
    assert.equal(r.ok, false, JSON.stringify(t));
    assert.match(r.reason, /control/);
  }
});

test("each refusal has a different reason", () => {
  const reasons = ["", "a/b", "..", ".x", "node_modules", "a\u0001"].map((t) => validateName(t).reason);
  assert.equal(new Set(reasons).size, reasons.length);
});

test("allows names with a leading dash, shell characters and quotes as typed", () => {
  for (const t of ["-x", "--help", "$(touch x)", "*", "it's", 'say "hi"', "a b", "node_modules2"]) {
    assert.deepEqual(validateName(t), { ok: true, name: t });
  }
});

// noteFileName
test("keeps the extension the file had", () => {
  assert.equal(noteFileName("Foo.MD", "Bar"), "Bar.MD");
  assert.equal(noteFileName("Foo.md", "Bar"), "Bar.md");
});

test("a typed .md is not doubled", () => {
  assert.equal(noteFileName("Foo.MD", "Bar.md"), "Bar.md");
  assert.equal(noteFileName("Foo.md", "Bar.md"), "Bar.md");
});

test("a typed v1.2 gets .md", () => {
  assert.equal(noteFileName("Foo.md", "v1.2"), "v1.2.md");
});

test("a leaf with no .md still gives .md", () => {
  assert.equal(noteFileName("Foo", "Bar"), "Bar.md");
});

// nextUntitled, takenName, isSameItem
test("nextUntitled gives Untitled.md when it is free", () => {
  assert.equal(nextUntitled([]), "Untitled.md");
  assert.equal(nextUntitled(["Other.md"]), "Untitled.md");
});

test("nextUntitled counts from 2 and fills the first free number", () => {
  assert.equal(nextUntitled(["Untitled.md"]), "Untitled 2.md");
  assert.equal(nextUntitled(["Untitled.md", "Untitled 2.md"]), "Untitled 3.md");
  assert.equal(nextUntitled(["Untitled.md", "Untitled 3.md"]), "Untitled 2.md");
});

test("nextUntitled ignores case", () => {
  assert.equal(nextUntitled(["UNTITLED.MD"]), "Untitled 2.md");
});

test("nextUntitled sees a name in NFD the same as NFC", () => {
  assert.equal(nextUntitled([`${NFD}.md`]), "Untitled.md");
  assert.equal(takenName([`${NFD}.md`], `${NFC}.md`), true);
});

test("takenName ignores case and Unicode form", () => {
  assert.equal(takenName(["Foo.md"], "foo.MD"), true);
  assert.equal(takenName([NFD], NFC), true);
  assert.equal(takenName([NFC], NFD), true);
});

test("takenName counts a file the tree does not show", () => {
  assert.equal(takenName(["photo.png"], "Photo.png"), true);
});

test("Foo.md and Foo side by side are not taken", () => {
  assert.equal(takenName(["Foo.md"], "Foo"), false);
  assert.equal(takenName(["Foo"], "Foo.md"), false);
});

test("takenName skips the item's own leaf only", () => {
  assert.equal(takenName(["Foo.md"], "Foo.md", "Foo.md"), false);
  assert.equal(takenName(["Foo.md", "foo.md"], "FOO.md", "Foo.md"), true);
});

test("isSameItem is true when only the case or the Unicode form differs", () => {
  assert.equal(isSameItem("foo.md", "Foo.md"), true);
  assert.equal(isSameItem("docs", "Docs"), true);
  assert.equal(isSameItem(NFD, NFC), true);
});

test("isSameItem is false for equal bytes and for different names", () => {
  assert.equal(isSameItem("Foo.md", "Foo.md"), false);
  assert.equal(isSameItem("Foo.md", "Bar.md"), false);
});

// safeRel
test("safeRel refuses empty, dot, dot-dot, absolute and escaping paths", () => {
  for (const p of ["", ".", "..", "/etc", "/", "a/../..", "../a", "a/..", "a/./b", "a//b", "a/", "a\0b", null, undefined, 3]) {
    assert.equal(safeRel(p, { allowRoot: false }).ok, false, String(p));
    assert.equal(typeof safeRel(p, { allowRoot: false }).reason, "string");
  }
});

test("safeRel passes the root only with allowRoot", () => {
  assert.deepEqual(safeRel("", { allowRoot: true }), { ok: true, rel: "" });
  assert.equal(safeRel("", { allowRoot: true }).ok, true);
  assert.equal(safeRel("").ok, false);
});

test("safeRel still refuses dot, dot-dot and absolute paths with allowRoot", () => {
  for (const p of [".", "..", "/x", "a/../.."]) assert.equal(safeRel(p, { allowRoot: true }).ok, false, p);
});

test("safeRel passes a plain relative path and odd names", () => {
  assert.deepEqual(safeRel("a/b.md", { allowRoot: false }), { ok: true, rel: "a/b.md" });
  assert.equal(safeRel("-x/--help", { allowRoot: false }).ok, true);
  assert.equal(safeRel("$(touch x)", { allowRoot: false }).ok, true);
});

// under, movePath
test("under matches the item and what is below it, not a sibling with the same start", () => {
  assert.equal(under("a", "a"), true);
  assert.equal(under("a/b", "a"), true);
  assert.equal(under("ab", "a"), false);
  assert.equal(under("ab/c", "a"), false);
});

test("movePath maps the item and below it, and leaves the rest", () => {
  assert.equal(movePath("a", "a", "z"), "z");
  assert.equal(movePath("a/b/c.md", "a", "z"), "z/b/c.md");
  assert.equal(movePath("ab/c.md", "a", "z"), "ab/c.md");
  assert.equal(movePath(null, "a", "z"), null);
});

// movedState
const state = () => ({
  note: "a/n.md", selected: "a/n.md", folders: new Set(["a", "a/sub", "ab", "other"]),
  entries: new Map([["", [1]], ["a", [2]], ["a/sub", [3]], ["ab", [4]]]),
  all: ["a/n.md", "a/sub/x.md", "ab/y.md", "z.md"], recent: ["a/n.md", "ab/y.md", "z.md"],
});

test("movedState re-keys the folder and its open subfolders, and not a sibling that starts the same", () => {
  const s = movedState(state(), "a", "b");
  assert.deepEqual([...s.folders].sort(), ["ab", "b", "b/sub", "other"]);
  assert.deepEqual([...s.entries.keys()].sort(), ["", "ab", "b", "b/sub"]);
  assert.deepEqual(s.entries.get("b/sub"), [3]);
  assert.deepEqual(s.entries.get("ab"), [4]);
});

test("movedState maps note, selected, recent and the sorted list", () => {
  const s = movedState(state(), "a", "b");
  assert.equal(s.note, "b/n.md");
  assert.equal(s.selected, "b/n.md");
  assert.deepEqual(s.recent, ["b/n.md", "ab/y.md", "z.md"]);
  assert.deepEqual(s.all, ["ab/y.md", "b/n.md", "b/sub/x.md", "z.md"]);
});

test("movedState maps a renamed note and keeps null note and selected null", () => {
  const s = movedState({ ...state(), note: null, selected: null }, "z.md", "w.md");
  assert.equal(s.note, null);
  assert.equal(s.selected, null);
  assert.deepEqual(s.recent, ["a/n.md", "ab/y.md", "w.md"]);
});

test("movedState does not change its input", () => {
  const before = state();
  movedState(before, "a", "b");
  assert.deepEqual([...before.folders], [...state().folders]);
  assert.deepEqual(before.all, state().all);
});

// removedState
test("removedState drops the folder, its subfolders and entries, and not a sibling", () => {
  const s = removedState(state(), "a");
  assert.deepEqual([...s.folders].sort(), ["ab", "other"]);
  assert.deepEqual([...s.entries.keys()].sort(), ["", "ab"]);
  assert.deepEqual(s.all, ["ab/y.md", "z.md"]);
});

test("removedState clears note and selected at or under the item", () => {
  const s = removedState(state(), "a");
  assert.equal(s.note, null);
  assert.equal(s.selected, null);
  const other = removedState(state(), "z.md");
  assert.equal(other.note, "a/n.md");
  assert.equal(other.selected, "a/n.md");
});

test("removedState removes a deleted path from recent (AC53)", () => {
  assert.deepEqual(removedState(state(), "a").recent, ["ab/y.md", "z.md"]);
  assert.deepEqual(removedState(state(), "z.md").recent, ["a/n.md", "ab/y.md"]);
});

// pendingAction
const req = (over = {}) => ({ id: "r1", at: 10_000, vault: "/v", op: "delete", path: "a.md", kind: "note", ...over });

test("a fresh request in this vault runs", () => {
  assert.deepEqual(pendingAction(req(), null, "/v", 11_000), { action: "run", id: "r1" });
});

test("a request older than 5 seconds is ignored", () => {
  assert.deepEqual(pendingAction(req(), null, "/v", 15_000), { action: "none", id: "r1" });
  assert.equal(pendingAction(req(), null, "/v", 14_999).action, "run");
});

test("a request from the future is ignored", () => {
  assert.equal(pendingAction(req(), null, "/v", 9_000).action, "none");
});

test("a handled id does not run again", () => {
  assert.deepEqual(pendingAction(req(), "r1", "/v", 11_000), { action: "none", id: "r1" });
});

test("a request for another vault is reported and not run (AC62)", () => {
  assert.deepEqual(pendingAction(req({ vault: "/w" }), null, "/v", 11_000), { action: "other-vault", id: "r1" });
});

test("a missing request, an unknown op or a missing path does nothing", () => {
  assert.deepEqual(pendingAction(undefined, null, "/v", 11_000), { action: "none", id: null });
  assert.equal(pendingAction(req({ op: "format" }), null, "/v", 11_000).action, "none");
  assert.equal(pendingAction(req({ path: undefined }), null, "/v", 11_000).action, "none");
});

test("a request for the root has an empty path and still runs", () => {
  assert.equal(pendingAction(req({ op: "new-note", path: "", kind: "root" }), null, "/v", 11_000).action, "run");
});

// folderCounts, deleteDetail
test("folderCounts gives the total and the files the tree does not show", () => {
  const c = folderCounts(["d/a.md", "d/b.MD", "d/pic.png", "d/.obsidian/x.md", "d/sub/.git/y", "d/sub/c.md", "d/node_modules/z.md"], "d");
  assert.deepEqual(c, { total: 7, unseen: 4, link: false });
});

test("folderCounts of an empty folder is zero", () => {
  assert.deepEqual(folderCounts([], "d"), { total: 0, unseen: 0, link: false });
});

test("folderCounts does not read the folder's own name as a hidden part", () => {
  assert.deepEqual(folderCounts([".git/a.md"], ".git"), { total: 1, unseen: 0, link: false });
});

test("folderCounts marks a symbolic link to a folder", () => {
  assert.deepEqual(folderCounts(["d"], "d"), { total: 0, unseen: 0, link: true });
});

test("deleteDetail names a note and says it goes to the Trash", () => {
  const t = deleteDetail("Foo.md", "note", null);
  assert.match(t, /Foo\.md/);
  assert.match(t, /Trash/);
});

test("deleteDetail states the total and the files not shown for a folder", () => {
  const t = deleteDetail("docs", "dir", { total: 7, unseen: 4, link: false });
  assert.match(t, /7 files/);
  assert.match(t, /4 not shown/);
  assert.match(t, /Trash/);
});

test("deleteDetail uses the singular and skips the hidden part when all files show", () => {
  const t = deleteDetail("docs", "dir", { total: 1, unseen: 0, link: false });
  assert.match(t, /1 file\b/);
  assert.doesNotMatch(t, /not shown/);
});

test("deleteDetail states that an empty folder is empty", () => {
  assert.match(deleteDetail("docs", "dir", { total: 0, unseen: 0, link: false }), /empty/);
});

test("deleteDetail says the count is not known and still names the Trash", () => {
  const t = deleteDetail("docs", "dir", null);
  assert.match(t, /not known/);
  assert.match(t, /Trash/);
});

test("deleteDetail says a link moves alone, not its target", () => {
  const t = deleteDetail("docs", "dir", { total: 0, unseen: 0, link: true });
  assert.match(t, /link/);
  assert.match(t, /target/);
  assert.doesNotMatch(t, /empty/);
});

// resultMessage
const done = (over = {}) => ({ updated: [], notUpdated: [], captured: 0, checked: 3, total: 3, attachmentsChecked: true, ...over });

test("resultMessage states 0 notes updated when nothing referenced the item", () => {
  assert.deepEqual(resultMessage(done()), { title: "0 notes updated", level: "success" });
});

test("resultMessage counts updated notes with a singular for one", () => {
  assert.equal(resultMessage(done({ updated: ["a.md"] })).title, "1 note updated");
  assert.equal(resultMessage(done({ updated: ["a.md", "b.md"] })).title, "2 notes updated");
  assert.equal(resultMessage(done({ updated: ["a.md"] })).level, "success");
});

test("resultMessage lists up to 5 not-updated paths", () => {
  const r = resultMessage(done({ updated: ["a.md"], notUpdated: ["n1.md", "n2.md", "n3.md", "n4.md", "n5.md"] }));
  assert.equal(r.title, "1 note updated, 5 not updated");
  assert.equal(r.level, "warning");
  for (const p of ["n1.md", "n2.md", "n3.md", "n4.md", "n5.md"]) assert.ok(r.body.includes(p), p);
  assert.doesNotMatch(r.body, /more/);
});

test("resultMessage shows and N more past 5 paths", () => {
  const list = ["n1.md", "n2.md", "n3.md", "n4.md", "n5.md", "n6.md", "n7.md"];
  const r = resultMessage(done({ notUpdated: list }));
  assert.ok(r.body.includes("n5.md"));
  assert.ok(!r.body.includes("n6.md"));
  assert.ok(r.body.includes("and 2 more"));
});

test("resultMessage states the captured count and warns (AC32)", () => {
  const r = resultMessage(done({ captured: 3 }));
  assert.match(r.body, /3 links/);
  assert.equal(r.level, "warning");
  assert.match(resultMessage(done({ captured: 1 })).body, /1 link\b/);
});

test("resultMessage states the cap as first 5000 of N and warns (AC37)", () => {
  const r = resultMessage(done({ checked: 5000, total: 6200 }));
  assert.match(r.body, /first 5000 of 6200/);
  assert.equal(r.level, "warning");
});

test("resultMessage says that attachment links were not checked and warns (AC46)", () => {
  const r = resultMessage(done({ attachmentsChecked: false }));
  assert.match(r.body, /Attachment links were not checked/);
  assert.equal(r.level, "warning");
});

test("resultMessage with every extra at once keeps each line", () => {
  const r = resultMessage(done({ updated: ["a.md"], notUpdated: ["n.md"], captured: 2, checked: 5000, total: 5001, attachmentsChecked: false }));
  assert.match(r.body, /n\.md/);
  assert.match(r.body, /2 links/);
  assert.match(r.body, /first 5000 of 5001/);
  assert.match(r.body, /Attachment/);
  assert.equal(r.level, "warning");
});

test("resultMessage has no body when there is nothing to add", () => {
  assert.equal("body" in resultMessage(done({ updated: ["a.md"] })), false);
});
