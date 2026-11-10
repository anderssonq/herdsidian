// Runs the real scripts/grok-status-line.sh (AC 17-23). macOS only: it uses /usr/bin/plutil.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = new URL("../scripts/grok-status-line.sh", import.meta.url).pathname;
const skip = process.platform !== "darwin";

const payload = (over = {}) => ({
  session_id: "sess-1",
  cwd: "/top/level",
  workspace: { current_dir: "/work/demo" },
  model: { id: "grok-4.5-id", display_name: "Grok 4.5" },
  cost: { total_cost_usd: 1.25 },
  context_window: {
    context_window_size: 256000,
    context_tokens: 30720,
    used_percentage: 12,
    session_input_tokens: 900000,
    session_output_tokens: 34567,
  },
  ...over,
});

function run(input, state = mkdtempSync(join(tmpdir(), "hs-grok-"))) {
  const r = spawnSync("/bin/sh", [SCRIPT], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    env: { PATH: "/usr/bin:/bin", HOME: state, XDG_STATE_HOME: state },
    encoding: "utf8",
  });
  const dir = join(state, "herdsidian", "grok");
  return { r, state, dir, file: (id) => join(dir, `${id}.json`) };
}

function allFiles(root) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p);
    }
  };
  walk(root);
  return out;
}

test("AC17: prints the line and writes the eleven keys", { skip }, () => {
  const { r, file } = run(payload());
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "Grok 4.5 · 12% ctx\n");
  const got = JSON.parse(readFileSync(file("sess-1"), "utf8"));
  assert.deepEqual(Object.keys(got).sort(), [
    "context_tokens", "context_window_size", "cost_usd", "cwd", "model", "session_id",
    "session_input_tokens", "session_output_tokens", "updated_at", "used_percentage", "v",
  ]);
  const { updated_at, ...rest } = got;
  assert.deepEqual(rest, {
    v: 1, session_id: "sess-1", cwd: "/work/demo", model: "grok-4.5-id", cost_usd: 1.25,
    context_window_size: 256000, context_tokens: 30720, used_percentage: 12,
    session_input_tokens: 900000, session_output_tokens: 34567,
  });
  assert.ok(Number.isInteger(updated_at));
  assert.ok(Math.abs(Date.now() - updated_at) < 60000);
});

test("AC17: cwd falls back to the top-level cwd; absent values are null", { skip }, () => {
  const { r, file } = run({ session_id: "s2", cwd: "/top/level" });
  assert.equal(r.status, 0);
  const got = JSON.parse(readFileSync(file("s2"), "utf8"));
  assert.equal(got.cwd, "/top/level");
  for (const k of ["model", "cost_usd", "context_window_size", "context_tokens",
    "used_percentage", "session_input_tokens", "session_output_tokens"]) {
    assert.equal(got[k], null, k);
  }
  assert.equal(Object.keys(got).length, 11);
});

test("AC18: nothing but the contract keys is written", { skip }, () => {
  const m = "SECRET-MARKER";
  const p = payload({
    session_name: m, transcript_path: m, prompt_id: m,
    workspace: { current_dir: "/work/demo", branch: m, repo: { host: m, owner: m, name: m } },
  });
  const { r, state } = run(p);
  assert.equal(r.status, 0);
  const files = allFiles(state);
  assert.ok(files.length > 0);
  for (const f of files) assert.ok(!readFileSync(f, "utf8").includes(m), f);
});

test("AC19: awkward cwd survives as valid JSON", { skip }, () => {
  const cwd = '/tmp/a b"c\\d/ñandú é';
  const { r, file } = run(payload({ workspace: { current_dir: cwd } }));
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(readFileSync(file("sess-1"), "utf8")).cwd, cwd);
});

test("AC20: a bad session_id writes nothing but still prints and exits 0", { skip }, () => {
  for (const id of ["../x", "a/b", "", "x".repeat(200), ".", ".."]) {
    const { r, state } = run(payload({ session_id: id }));
    assert.equal(r.status, 0, JSON.stringify(id));
    assert.equal(r.stdout, "Grok 4.5 · 12% ctx\n", JSON.stringify(id));
    assert.deepEqual(allFiles(state).filter((f) => !f.endsWith("/grok")), [], JSON.stringify(id));
  }
});

test("AC21: modes, no temp file left, second run replaces values", { skip }, () => {
  const state = mkdtempSync(join(tmpdir(), "hs-grok-"));
  const first = run(payload(), state);
  assert.equal(statSync(first.dir).mode & 0o777, 0o700);
  assert.equal(statSync(first.file("sess-1")).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(first.dir, { encoding: "utf8" }).sort(), ["sess-1.json"]);
  const p = payload();
  p.context_window.used_percentage = 40;
  p.cost.total_cost_usd = 2.5;
  const second = run(p, state);
  assert.equal(second.r.stdout, "Grok 4.5 · 40% ctx\n");
  const got = JSON.parse(readFileSync(second.file("sess-1"), "utf8"));
  assert.equal(got.used_percentage, 40);
  assert.equal(got.cost_usd, 2.5);
  assert.deepEqual(readdirSync(second.dir), ["sess-1.json"]);
  assert.equal(statSync(second.file("sess-1")).mode & 0o777, 0o600);
});

test("AC22: empty or non-JSON stdin prints Grok and writes nothing", { skip }, () => {
  for (const input of ["", "not json"]) {
    const { r, state } = run(input);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "Grok\n");
    assert.ok(!existsSync(join(state, "herdsidian", "grok")) ||
      readdirSync(join(state, "herdsidian", "grok")).length === 0);
  }
});

test("AC22: missing display_name or used_percentage", { skip }, () => {
  const noName = payload({ model: { id: "m" } });
  assert.equal(run(noName).r.stdout, "Grok · 12% ctx\n");
  const noPct = payload();
  delete noPct.context_window.used_percentage;
  assert.equal(run(noPct).r.stdout, "Grok 4.5\n");
  const neither = payload({ model: {} });
  delete neither.context_window.used_percentage;
  assert.equal(run(neither).r.stdout, "Grok\n");
});

test("AC20/spec: an unwritable state folder still prints and exits 0", { skip }, () => {
  const r = spawnSync("/bin/sh", [SCRIPT], {
    input: JSON.stringify(payload()),
    env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", XDG_STATE_HOME: "/dev/null/x" },
    encoding: "utf8",
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "Grok 4.5 · 12% ctx\n");
});

test("AC23: the script names no forbidden program and writes only in its folder", () => {
  const text = readFileSync(SCRIPT, "utf8");
  assert.doesNotMatch(text, /\b(jq|python3?|node|curl|git|rm)\b|http/);
  assert.ok(text.includes("${XDG_STATE_HOME:-$HOME/.local/state}/herdsidian/grok"));
  for (const m of text.matchAll(/(?<![0-9&])>>?\s*("[^"]*"|\S+)/g)) {
    const target = m[1];
    assert.ok(target === "/dev/null" || target.startsWith('"$tmp'), `redirect to ${target}`);
  }
  for (const m of text.matchAll(/\/bin\/mv\s+(?:-f\s+)?(\S+)\s+(\S+)/g)) {
    assert.ok(m[1].startsWith('"$tmp'), `mv from ${m[1]}`);
    assert.ok(m[2].startsWith('"$dir'), `mv to ${m[2]}`);
  }
});
