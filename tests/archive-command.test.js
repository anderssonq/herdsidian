// Archive and restore from the ⌘K palette: pure command list (AC-1 to AC-6) and the lint guard (AC-15).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandList, rankCommands, buildList } from "../mods/herdsidian/palette.js";

const SPACE = { id: "s1", name: "work", folder: "/r/work" };
const STARTER = { name: "Claude Code", run: ["claude"] };
const AGENT = { address: "t1", space: "s1", pane: "p1", program: { key: "claude", name: "Claude Code" } };
const BASE = { vault: "/v", sidebarHidden: false, sidebarTab: "notes", space: SPACE, starter: STARTER, bindings: [], layoutName: "herdsidian" };
const list = (store, over = {}, agent = null) => commandList({ ...BASE, archive: { store, agent }, ...over });
const find = (commands, id) => commands.find((c) => c.id === id);
const ids = (commands) => commands.map((c) => c.id);
const ARCHIVE_IDS = ["archive-space", "restore-space", "archive-agent", "restore-agent"];
const archiveIds = (commands) => ids(commands).filter((id) => ARCHIVE_IDS.includes(id));

test("AC-1: a target space with an empty store lists Archive space, with no hint and no Restore", () => {
  const commands = list({ spaces: [], agents: [] });
  const row = find(commands, "archive-space");
  assert.equal(row.label, "Archive space: work");
  assert.equal(row.hint, null);
  assert.equal(find(commands, "restore-space"), undefined);
});

test("AC-2: an archived target space lists Restore space only; a missing or malformed store reads as empty", () => {
  const commands = list({ spaces: ["s1"], agents: [] });
  assert.equal(find(commands, "restore-space").label, "Restore space: work");
  assert.equal(find(commands, "archive-space"), undefined);
  for (const bad of [undefined, null, "x", [], { spaces: "s1" }, { spaces: [1] }]) {
    const rows = list(bad);
    assert.equal(find(rows, "archive-space")?.label, "Archive space: work", JSON.stringify(bad));
    assert.equal(find(rows, "restore-space"), undefined);
  }
});

test("AC-3: the agent command follows the agent's own archived state and is hidden through its space", () => {
  const label = (id, store, agent = AGENT) => find(list(store, {}, agent), id)?.label;
  assert.equal(label("archive-agent", { spaces: [], agents: [] }), "Archive agent: Claude Code in work");
  assert.equal(label("restore-agent", { spaces: [], agents: [] }), undefined);
  assert.equal(label("restore-agent", { spaces: [], agents: ["t1"] }), "Restore agent: Claude Code in work");
  assert.equal(label("archive-agent", { spaces: [], agents: ["t1"] }), undefined);
  for (const store of [{ spaces: ["s1"], agents: [] }, { spaces: ["s1"], agents: ["t1"] }]) {
    assert.equal(label("archive-agent", store), undefined);
    assert.equal(label("restore-agent", store), undefined);
  }
  assert.deepEqual(archiveIds(list({ spaces: [], agents: [] }, {}, null)), ["archive-space"]);
  const app = { ...AGENT, program: undefined, app: "node" };
  assert.equal(label("archive-agent", { spaces: [], agents: [] }, app), "Archive agent: node in work");
  assert.equal(label("archive-agent", { spaces: [], agents: [] }, { ...AGENT, program: undefined }), "Archive agent: Agent in work");
});

test("AC-4: with no target space no archive or restore command is listed", () => {
  assert.deepEqual(archiveIds(list({ spaces: [], agents: [] }, { space: null }, AGENT)), []);
  assert.deepEqual(archiveIds(list({ spaces: ["s1"], agents: ["t1"] }, { space: null })), []);
});

test("AC-5: the archive commands come after every existing command and change none of them", () => {
  const plain = commandList(BASE);
  assert.deepEqual(archiveIds(plain), []);
  const withArchive = list({ spaces: [], agents: [] }, {}, AGENT);
  assert.deepEqual(ids(withArchive).slice(0, plain.length), ids(plain));
  assert.deepEqual(ids(withArchive).slice(plain.length), ["archive-space", "archive-agent"]);
  assert.deepEqual(withArchive.slice(0, plain.length), plain);
  const view = { query: "", tab: "all", vault: "/v", notes: [], notesError: null, linked: new Set(), contextPaths: [], agents: [], hintFor: () => null };
  const first = (commands) => buildList({ ...view, commands }).sections.find((s) => s.kind === "commands").rows.map((r) => r.command.id);
  assert.deepEqual(first(withArchive), first(plain));
  assert.equal(first(withArchive).length, 4);
});

test("AC-6: 'arch' finds the archive commands by prefix and 'restore' only the restore ones", () => {
  const empty = list({ spaces: [], agents: [] }, {}, AGENT);
  const arch = rankCommands(empty, "arch");
  assert.deepEqual(arch.map((r) => r.command.id).sort(), ["archive-agent", "archive-space"]);
  assert.ok(arch.every((r) => r.tier === 1));
  assert.deepEqual(rankCommands(empty, "restore"), []);
  const ownSpace = rankCommands(list({ spaces: ["s1"], agents: [] }, {}, AGENT), "restore");
  assert.deepEqual(ownSpace.map((r) => r.command.id), ["restore-space"]);
  const ownAgent = rankCommands(list({ spaces: [], agents: ["t1"] }, {}, AGENT), "restore");
  assert.deepEqual(ownAgent.map((r) => r.command.id), ["restore-agent"]);
  assert.deepEqual(rankCommands(list({ spaces: ["s1"], agents: [] }, {}, AGENT), "arch"), []);
});

// AC-15: the lint copy guard and the pure-file guard cover mods/herdsidian/archive.js.

const repo = new URL("..", import.meta.url).pathname;
const copies = [];
const copyRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), "herdsidian-archive-"));
  copies.push(dir);
  cpSync(repo, dir, { recursive: true, filter: (src) => !/(^|\/)(\.git|node_modules)$/.test(src) });
  return dir;
};
const lint = (cwd) => {
  const r = spawnSync(process.execPath, ["scripts/lint.js"], { cwd, encoding: "utf8" });
  return { code: r.status, stderr: r.stderr };
};
const COPY = "mods/herdsidian/archive.js";

after(() => {
  for (const dir of copies) rmSync(dir, { recursive: true, force: true });
});

test("AC-15: the palette's archive.js is a byte-identical copy of lib/archive.js", () => {
  assert.ok(existsSync(join(repo, COPY)), `${COPY} exists`);
  assert.equal(readFileSync(join(repo, COPY), "utf8"), readFileSync(join(repo, "lib/archive.js"), "utf8"));
});

test("AC-15: lint fails when the palette's archive.js differs from lib/archive.js", () => {
  const dir = copyRepo();
  assert.ok(existsSync(join(dir, COPY)), `${COPY} exists`);
  appendFileSync(join(dir, COPY), "\nexport const probe = 1;\n");
  const r = lint(dir);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /mods\/herdsidian\/archive\.js: differs from lib\/archive\.js/);
});

test("AC-15: lint fails when the palette's archive.js imports herdr, gpui-kit or gpui-base", () => {
  for (const runtime of ["herdr", "gpui-kit", "gpui-base"]) {
    const dir = copyRepo();
    assert.ok(existsSync(join(dir, COPY)), `${COPY} exists`);
    // The same line in lib and every copy, so the copy guard stays quiet and only the pure guard speaks.
    const files = ["lib/archive.js", ...readdirSync(join(dir, "mods")).map((m) => `mods/${m}/archive.js`).filter((f) => existsSync(join(dir, f)))];
    for (const f of files) appendFileSync(join(dir, f), `\nimport { x } from "${runtime}";\n`);
    const r = lint(dir);
    assert.equal(r.code, 1, runtime);
    assert.match(r.stderr, /mods\/herdsidian\/archive\.js: line \d+: pure file must not import herdr, gpui-kit or gpui-base/, runtime);
    assert.doesNotMatch(r.stderr, /differs from lib/);
  }
});
