// What ChangesWatch does with the answer of `git rev-parse --show-toplevel` (pure decision, changes.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTop, publishes, readRoots } from "../mods/herdsidian/changes.js";

test("publishes: an error in the repo of the last good read publishes nothing; a ready read always does", () => {
  assert.equal(publishes("error", { sameRoot: true }), false);
  assert.equal(publishes("error", { sameRoot: false }), true);
  assert.equal(publishes("ready", { sameRoot: true }), true);
});

test("readRoots: a ready read remembers its repo", () => {
  assert.deepEqual(readRoots("ready", "/a", null), { sameRoot: false, readyRoot: "/a" });
  assert.deepEqual(readRoots("ready", "/b", "/a"), { sameRoot: false, readyRoot: "/b" });
});

test("readRoots: an error in the remembered repo keeps it and publishes nothing", () => {
  assert.deepEqual(readRoots("error", "/a", "/a"), { sameRoot: true, readyRoot: "/a" });
});

test("readRoots: an error elsewhere or with no known repo publishes 0 and forgets the repo", () => {
  assert.deepEqual(readRoots("error", "/b", "/a"), { sameRoot: false, readyRoot: null });
  assert.deepEqual(readRoots("error", null, null), { sameRoot: false, readyRoot: null });
  assert.deepEqual(readRoots("error", "/a", null), { sameRoot: false, readyRoot: null });
});

test("readRoots: no folder or no repo forgets the repo; loading and unknown change nothing", () => {
  for (const state of ["nofolder", "norepo"]) assert.deepEqual(readRoots(state, null, "/a"), { sameRoot: false, readyRoot: null }, state);
  for (const state of ["loading", "unknown"]) assert.deepEqual(readRoots(state, null, "/a"), { sameRoot: false, readyRoot: "/a" }, state);
});

test("a root on stdout with exit 0 is a repo", () => {
  assert.deepEqual(classifyTop({ code: 0, stdout: "/work/repo\n" }), { kind: "repo", root: "/work/repo" });
});

test("a non-zero exit is a real non-repo", () => {
  assert.deepEqual(classifyTop({ code: 128, stdout: "" }), { kind: "norepo" });
  assert.deepEqual(classifyTop({ code: 1, stdout: "ignored" }), { kind: "norepo" });
});

test("exit 0 with empty stdout is no valid answer", () => {
  assert.deepEqual(classifyTop({ code: 0, stdout: "" }), { kind: "unknown" });
  assert.deepEqual(classifyTop({ code: 0, stdout: " \n" }), { kind: "unknown" });
  assert.deepEqual(classifyTop({ code: 0 }), { kind: "unknown" });
});

test("a command that could not run is no valid answer either", () => {
  assert.deepEqual(classifyTop(null), { kind: "unknown" });
  assert.deepEqual(classifyTop(undefined), { kind: "unknown" });
});

test("a repo publishes its count and no repo publishes 0; unknown and loading publish nothing", () => {
  for (const state of ["ready", "norepo", "nofolder", "error"]) assert.equal(publishes(state), true, state);
  for (const state of ["unknown", "loading"]) assert.equal(publishes(state), false, state);
});
