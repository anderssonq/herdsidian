// The Git tab, ref pills (AC32): the HEAD pill of a detached HEAD, the icon and colors of each kind, the outline of the
// current branch, and the one pill plus "+N" a row with several refs shows.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { reset, mountGit, fakeRepo, fakeCx, findById, walk, texts, has } from "./support/git-kit.js";
import { gitTokens } from "../mods/herdsidian/tokens.js";

const THEME = { foreground: "#eeeeee", background: "#111111", chrome: "#222222", canvas: "#333333", raised: "#2a2a2a", accent: "#ff00aa",
  muted: "#999999", dim: "#555555", hover: "#444444", blocked: "#ffaa00", ansi1: "#ff0001", ansi2: "#00ff02",
  ansi3: "#ffff03", ansi4: "#0000ff", ansi5: "#ff00ff", ansi6: "#00ffff" };
const gk = gitTokens(THEME);

beforeEach(reset);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, what) {
  for (let i = 0; i < 60; i++) {
    const value = await check();
    if (value) return value;
    await sleep(15);
  }
  assert.fail(`timed out waiting for ${what}`);
}

const HEX = (n) => String(n).padStart(6, "0").padEnd(40, "f");
const commit = (n, parents, subject = `commit ${n}`) => ({ hash: HEX(n), parents: parents.map(HEX), author: "Ada Lovelace",
  email: "ada@example.com", at: Date.now() - 330000 - n * 60000, subject });
// Three tips (A, B, E) over one base C: A takes lane 0, B lane 1, E lane 2, and C comes back on lane 0.
const FORK = () => [commit(1, [4]), commit(2, [4]), commit(3, [4]), commit(4, [])];
const LINE = () => [commit(1, [2]), commit(2, [3]), commit(3, [])];

const vlist = (tree) => walk(tree).find((n) => n.kind === "vlist" && (n.arg.id === "git-rows" || n.nodeId === "git-rows"));
const keysOf = (tree) => { const l = vlist(tree); return l ? Array.from({ length: l.arg.count }, (_, i) => l.arg.key(i)) : []; };
const rowOf = (tree, key) => { const l = vlist(tree); return l.arg.render({ start: 0, end: l.arg.count }, fakeCx())[keysOf(tree).indexOf(key)]; };
const filterInput = (tree) => walk(findById(tree, "git-filter")).find((n) => n.kind === "input").arg;

async function open(spec) {
  const repo = fakeRepo({ remotes: ["origin"], ...spec });
  const m = mountGit({ theme: THEME });
  const tree = await until(() => { const t = m.render(); return vlist(t) && t; }, "the graph");
  return { repo, m, tree };
}

// The pill that shows `name` in lane `lane`'s colors, or undefined.
const pillOf = (node, name, lane) => walk(node).find((n) => has(n, "bg", gk.lanes[lane].pillBg) && texts(n).includes(name));
const outlined = (pill, lane) => has(pill, "border", 1) && has(pill, "border_color", gk.lanes[lane].pillText);
const iconOf = (pill) => walk(pill).find((n) => n.kind === "svg")?.arg ?? "";

test("AC32: a detached HEAD shows a HEAD pill with the 1 px outline on the HEAD row", async () => {
  const { tree } = await open({ branch: null, commits: LINE(), refs: [{ kind: "local", name: "main", sha: HEX(3) }] });
  const pill = pillOf(rowOf(tree, HEX(1)), "HEAD", 0);
  assert.ok(pill, "a HEAD pill in the lane colors");
  assert.ok(has(pill, "text_color", gk.lanes[0].pillText));
  assert.ok(outlined(pill, 0), "the outline in the text color");
  assert.equal(pillOf(rowOf(tree, HEX(2)), "HEAD", 0), undefined, "only the HEAD row");
});

test("AC32: a detached HEAD shows the HEAD pill in the detail refs", async () => {
  const { tree } = await open({ branch: null, commits: LINE(), refs: [{ kind: "local", name: "main", sha: HEX(3) }] });
  const pill = pillOf(findById(tree, "git-detail-refs"), "HEAD", 0);
  assert.ok(pill, "a HEAD pill in git-detail-refs");
  assert.ok(outlined(pill, 0));
});

test("AC32: a branch pill has the branch icon and the lane pill colors, and only the current branch is outlined", async () => {
  const refs = [{ kind: "local", name: "main", sha: HEX(1) }, { kind: "local", name: "feature", sha: HEX(2) }];
  const { tree } = await open({ commits: FORK(), refs });
  const current = pillOf(rowOf(tree, HEX(1)), "main", 0);
  assert.ok(current, "main in lane 0 colors");
  assert.ok(has(current, "text_color", gk.lanes[0].pillText));
  assert.ok(iconOf(current).endsWith("git-branch.svg"), iconOf(current));
  assert.ok(outlined(current, 0), "the current branch is outlined");
  const other = pillOf(rowOf(tree, HEX(2)), "feature", 1);
  assert.ok(other, "feature in lane 1 colors");
  assert.ok(has(other, "text_color", gk.lanes[1].pillText));
  assert.ok(iconOf(other).endsWith("git-branch.svg"));
  assert.equal(has(other, "border", 1), false, "another local branch has no outline");
});

test("AC32: a remote pill has the cloud icon and the colors of the row's lane, with no outline", async () => {
  const refs = [{ kind: "local", name: "main", sha: HEX(1) }, { kind: "remote", name: "origin/other", sha: HEX(3) }];
  const { tree } = await open({ commits: FORK(), refs });
  const pill = pillOf(rowOf(tree, HEX(3)), "origin/other", 2);
  assert.ok(pill, "origin/other in lane 2 colors");
  assert.ok(has(pill, "text_color", gk.lanes[2].pillText));
  assert.ok(iconOf(pill).endsWith("cloud.svg"), iconOf(pill));
  assert.equal(has(pill, "border", 1), false);
});

test("AC32: a tag pill has the tag icon and always the lane 3 colors, even on lane 0", async () => {
  const refs = [{ kind: "local", name: "main", sha: HEX(1) }, { kind: "tag", name: "v1", sha: HEX(4) }];
  const { tree } = await open({ commits: FORK(), refs });
  const pill = pillOf(rowOf(tree, HEX(4)), "v1", 3);
  assert.ok(pill, "v1 in lane 3 colors on a lane 0 row");
  assert.ok(has(pill, "text_color", gk.lanes[3].pillText));
  assert.ok(iconOf(pill).endsWith("tag.svg"), iconOf(pill));
  assert.equal(has(pill, "border", 1), false);
});

test("AC32: under a filter the lane is 0 for a branch or remote pill, and a tag keeps lane 3", async () => {
  const refs = [{ kind: "local", name: "main", sha: HEX(1) }, { kind: "local", name: "feature", sha: HEX(2) },
    { kind: "remote", name: "origin/other", sha: HEX(3) }, { kind: "tag", name: "v1", sha: HEX(4) }];
  const { m, tree } = await open({ commits: FORK(), refs });
  m.type(filterInput(tree), "feature");
  assert.ok(pillOf(rowOf(m.render(), HEX(2)), "feature", 0), "branch in lane 0 colors");
  m.type(filterInput(m.render()), "other");
  assert.ok(pillOf(rowOf(m.render(), HEX(3)), "origin/other", 0), "remote in lane 0 colors");
  m.type(filterInput(m.render()), "v1");
  assert.ok(pillOf(rowOf(m.render(), HEX(4)), "v1", 3), "tag in lane 3 colors");
});

test("AC32: a row with three refs shows the current branch and +2", async () => {
  const refs = [{ kind: "remote", name: "origin/main", sha: HEX(1) }, { kind: "tag", name: "v1", sha: HEX(1) }, { kind: "local", name: "main", sha: HEX(1) }];
  const { tree } = await open({ commits: LINE(), refs });
  const row = rowOf(tree, HEX(1));
  assert.ok(pillOf(row, "main", 0));
  assert.equal(pillOf(row, "origin/main", 0), undefined);
  assert.equal(pillOf(row, "v1", 3), undefined);
  assert.ok(texts(row).includes("+2"));
});

test("AC32: with no current branch the first local branch wins over a remote and a tag", async () => {
  const refs = [{ kind: "remote", name: "origin/zed", sha: HEX(2) }, { kind: "tag", name: "v1", sha: HEX(2) }, { kind: "local", name: "feature", sha: HEX(2) }];
  const { tree } = await open({ commits: LINE(), refs });
  const row = rowOf(tree, HEX(2));
  assert.ok(pillOf(row, "feature", 0));
  assert.equal(pillOf(row, "origin/zed", 0), undefined);
  assert.equal(pillOf(row, "v1", 3), undefined);
  assert.ok(texts(row).includes("+2"));
});

test("AC32: with no branch the remote wins over a tag", async () => {
  const refs = [{ kind: "tag", name: "v1", sha: HEX(2) }, { kind: "remote", name: "origin/zed", sha: HEX(2) }, { kind: "remote", name: "origin/abc", sha: HEX(2) }];
  const { tree } = await open({ commits: LINE(), refs });
  const row = rowOf(tree, HEX(2));
  assert.ok(pillOf(row, "origin/abc", 0), "the first remote by name");
  assert.equal(pillOf(row, "v1", 3), undefined);
  assert.ok(texts(row).includes("+2"));
});
