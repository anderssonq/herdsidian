// The Git tab's view model (git-model.js): initials, author slot, pills, filter, header, splitter clamp, refs key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { initialsOf, authorSlot, refsByCommit, refsKey, pickPill, matchCommits, headerOf, clampSplit } from "../mods/herdsidian/git-model.js";

const HASH = "abcdef0123456789abcdef0123456789abcdef01";
const HASH2 = "1234567890abcdef1234567890abcdef12345678";
const HASH3 = "fedcba9876543210fedcba9876543210fedcba98";

const ref = (kind, name, sha, current = false) => ({
  full: `refs/${kind === "local" ? "heads" : kind === "remote" ? "remotes" : "tags"}/${name}`, name, kind, sha, current,
});

// FNV-1a over the UTF-16 units, worked out here and not taken from the code under test.
const fnv = (key) => {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) % 6;
};

// ---- AC30: initialsOf
test("AC30 initialsOf: two words give the first letter of each", () => assert.equal(initialsOf("Ada Lovelace"), "AL"));
test("AC30 initialsOf: four words give the first and the last", () => assert.equal(initialsOf("Ada Augusta King Lovelace"), "AL"));
test("AC30 initialsOf: three words keep the first and the last, not the middle", () => assert.equal(initialsOf("Ada King Lovelace"), "AL"));
test("AC30 initialsOf: one word gives one letter", () => assert.equal(initialsOf("Ada"), "A"));
test("AC30 initialsOf: a lower-case name is uppercased", () => assert.equal(initialsOf("ada lovelace"), "AL"));
test("AC30 initialsOf: a word with no letter is dropped", () => {
  assert.equal(initialsOf("Ada - Lovelace"), "AL");
  assert.equal(initialsOf("Ada 42"), "A");
  assert.equal(initialsOf("42 Ada"), "A");
});
test("AC30 initialsOf: an empty name or a name with no letter gives ?", () => {
  assert.equal(initialsOf(""), "?");
  assert.equal(initialsOf("   "), "?");
  assert.equal(initialsOf("1234 --"), "?");
});
test("AC30 initialsOf: a letter of two UTF-16 units stays whole and is uppercased", () => {
  // U+10428 is a lower-case Deseret letter; its upper-case form is U+10400. Both are 2 UTF-16 units.
  const small = "\u{10428}", big = "\u{10400}";
  assert.equal(small.length, 2);
  assert.equal(initialsOf(`${small}vi Smith`), `${big}S`);
  assert.equal(initialsOf(`Ana ${small}vi`), `A${big}`);
  assert.equal(initialsOf(`${small}vi`), big);
});
test("AC30 initialsOf: white space of any kind splits words", () => assert.equal(initialsOf("  Ada\tLovelace \n"), "AL"));

// ---- AC30: authorSlot
test("AC30 authorSlot equals the FNV-1a value of the lower-cased email, worked out in the test", () => {
  for (const email of ["ada@example.com", "bob@example.com", "grace@navy.mil"]) assert.equal(authorSlot(email, "Anyone"), fnv(email));
  // The same three keys, written as plain numbers, so the reference above is itself checked.
  assert.deepEqual(["ada@example.com", "bob@example.com", "grace@navy.mil"].map((e) => authorSlot(e, "x")), [0, 3, 5]);
});
test("AC30 authorSlot is stable and in 0..5", () => {
  for (const email of ["a@b.c", "ünï@exämple.io", "zzz@zzz.zz", "x"]) {
    const slot = authorSlot(email, "n");
    assert.equal(authorSlot(email, "n"), slot);
    assert.ok(Number.isInteger(slot) && slot >= 0 && slot <= 5, String(slot));
  }
});
test("AC30 authorSlot ignores the case of the email", () => {
  assert.equal(authorSlot("Ada@Example.COM", "Ada"), authorSlot("ada@example.com", "Ada"));
  assert.equal(authorSlot("Ada@Example.COM", "Other Name"), 0);
});
test("AC30 authorSlot uses the lower-cased name when the email is empty", () => {
  assert.equal(authorSlot("", "ada"), fnv("ada"));
  assert.equal(authorSlot("", "ADA"), fnv("ada"));
  assert.equal(authorSlot("", "ada"), 1);
});
test("AC30 authorSlot does not use the name when there is an email", () => {
  assert.equal(authorSlot("bob@example.com", "ada"), 3);
  assert.equal(authorSlot("bob@example.com", "zed"), 3);
});

// ---- AC32 / A: refsByCommit and pickPill
test("refsByCommit groups the refs by commit hash", () => {
  const a = ref("local", "main", HASH, true), b = ref("remote", "origin/main", HASH), c = ref("tag", "v1", HASH2);
  const map = refsByCommit([a, b, c]);
  assert.deepEqual(map.get(HASH), [a, b]);
  assert.deepEqual(map.get(HASH2), [c]);
  assert.equal(map.get(HASH3), undefined);
});

test("AC29 pickPill: no ref gives null", () => assert.equal(pickPill([]), null));
test("AC29 pickPill: one ref gives it with more 0", () => {
  const r = ref("tag", "v1", HASH);
  assert.deepEqual(pickPill([r]), { ref: r, more: 0 });
});
test("AC29 pickPill: the current branch wins over a local branch that sorts first", () => {
  const alpha = ref("local", "alpha", HASH), main = ref("local", "main", HASH, true);
  const origin = ref("remote", "origin/main", HASH), tag = ref("tag", "v1", HASH);
  assert.deepEqual(pickPill([alpha, origin, main, tag]), { ref: main, more: 3 });
});
test("AC29 pickPill: with no current branch the first local branch in name order wins", () => {
  const zeta = ref("local", "zeta", HASH), alpha = ref("local", "alpha", HASH);
  const origin = ref("remote", "origin/aaa", HASH), tag = ref("tag", "a-tag", HASH);
  assert.deepEqual(pickPill([zeta, tag, origin, alpha]), { ref: alpha, more: 3 });
});
test("AC29 pickPill: with no local branch the first remote branch in name order wins over a tag", () => {
  const zeta = ref("remote", "origin/zeta", HASH), alpha = ref("remote", "origin/alpha", HASH), tag = ref("tag", "a-tag", HASH);
  assert.deepEqual(pickPill([tag, zeta, alpha]), { ref: alpha, more: 2 });
});
test("AC29 pickPill: with only tags the first tag in name order wins", () => {
  const v2 = ref("tag", "v2", HASH), v1 = ref("tag", "v1", HASH);
  assert.deepEqual(pickPill([v2, v1]), { ref: v1, more: 1 });
});

// ---- AC36: matchCommits
const commit = (hash, subject, author, email) => ({ hash, parents: [], author, email, at: 0, subject });
const C1 = commit(HASH, "Fix the login redirect", "Ada Lovelace", "ada@example.com");
const C2 = commit(HASH2, "Add a settings page", "Bob Stone", "bob@work.org");
const C3 = commit(HASH3, "Refactor the parser", "Grace Hopper", "grace@navy.mil");
const COMMITS = [C1, C2, C3];
const BY = refsByCommit([ref("local", "feature/Billing", HASH2), ref("tag", "v2.0", HASH3)]);

test("AC36 matchCommits: an empty or blank query gives every commit", () => {
  assert.deepEqual(matchCommits(COMMITS, BY, ""), COMMITS);
  assert.deepEqual(matchCommits(COMMITS, BY, "   "), COMMITS);
});
test("AC36 matchCommits: a subject substring, case-insensitive", () => {
  assert.deepEqual(matchCommits(COMMITS, BY, "LOGIN"), [C1]);
  assert.deepEqual(matchCommits(COMMITS, BY, "the"), [C1, C3]);
});
test("AC36 matchCommits: the author name", () => assert.deepEqual(matchCommits(COMMITS, BY, "hopper"), [C3]));
test("AC36 matchCommits: the author email", () => assert.deepEqual(matchCommits(COMMITS, BY, "WORK.org"), [C2]));
test("AC36 matchCommits: a ref name of that commit, case-insensitive", () => {
  assert.deepEqual(matchCommits(COMMITS, BY, "billing"), [C2]);
  assert.deepEqual(matchCommits(COMMITS, BY, "v2.0"), [C3]);
});
test("AC36 matchCommits: a hash prefix", () => {
  assert.deepEqual(matchCommits(COMMITS, BY, "abcdef0"), [C1]);
  assert.deepEqual(matchCommits(COMMITS, BY, "ABCDEF0"), [C1]);
  assert.deepEqual(matchCommits(COMMITS, BY, "1234"), [C2]);
});
test("AC36 matchCommits: a hash substring that is not a prefix does not match", () => {
  assert.deepEqual(matchCommits(COMMITS, BY, "cdef0123"), []);
  assert.deepEqual(matchCommits(COMMITS, BY, "567890ab"), []);
});
test("AC36 matchCommits: no match gives an empty list, and the order of the input is kept", () => {
  assert.deepEqual(matchCommits(COMMITS, BY, "zzzz"), []);
  assert.deepEqual(matchCommits([C3, C1, C2], BY, "the"), [C3, C1]);
});

// ---- AC28: headerOf
test("AC28 headerOf: a branch with an upstream", () => {
  const h = headerOf({ branch: "main", head: HASH, upstream: { remote: "origin", ref: "refs/heads/main", short: "origin/main" }, ahead: 2, behind: 1 });
  assert.equal(h.label, "main");
  assert.equal(h.ahead, 2);
  assert.equal(h.behind, 1);
  assert.equal(h.noUpstream, false);
});
test("AC28 headerOf: a detached HEAD shows the 7-character hash", () => {
  const h = headerOf({ branch: null, head: HASH, upstream: null, ahead: null, behind: null });
  assert.equal(h.label, "detached HEAD abcdef0");
  assert.equal(h.noUpstream, false);
});
test("AC28 headerOf: a branch with no upstream", () => {
  const h = headerOf({ branch: "feat/x", head: HASH, upstream: null, ahead: null, behind: null });
  assert.equal(h.label, "feat/x");
  assert.equal(h.noUpstream, true);
});

// ---- AC37: clampSplit
test("AC37 clampSplit: a value in the middle is kept", () => assert.equal(clampSplit(300, 700), 300));
test("AC37 clampSplit: the detail is at least 120", () => {
  assert.equal(clampSplit(50, 700), 120);
  assert.equal(clampSplit(120, 700), 120);
});
test("AC37 clampSplit: the graph keeps at least 96", () => {
  assert.equal(clampSplit(900, 700), 604);
  assert.equal(clampSplit(604, 700), 604);
});
test("AC37 clampSplit: with a small total the graph keeps its 96 first", () => {
  assert.equal(clampSplit(150, 200), 104);
  assert.equal(clampSplit(50, 200), 104);
});

// ---- AC17: refsKey
const SNAP = () => ({ head: HASH, branch: "main", refs: [ref("local", "main", HASH, true), ref("remote", "origin/main", HASH2), ref("tag", "v1", HASH3)] });

test("refsKey is a string and is the same for the same snapshot", () => {
  assert.equal(typeof refsKey(SNAP()), "string");
  assert.equal(refsKey(SNAP()), refsKey(SNAP()));
});
test("refsKey changes when a ref moves", () => {
  const moved = SNAP();
  moved.refs[1] = ref("remote", "origin/main", HASH3);
  assert.notEqual(refsKey(moved), refsKey(SNAP()));
});
test("refsKey changes when HEAD moves", () => {
  const moved = SNAP();
  moved.head = HASH2;
  assert.notEqual(refsKey(moved), refsKey(SNAP()));
});
test("refsKey changes when a ref is added", () => {
  const added = SNAP();
  added.refs.push(ref("local", "dev", HASH2));
  assert.notEqual(refsKey(added), refsKey(SNAP()));
});
test("refsKey is the same for the same refs in another order", () => {
  const shuffled = SNAP();
  shuffled.refs.reverse();
  assert.equal(refsKey(shuffled), refsKey(SNAP()));
});
