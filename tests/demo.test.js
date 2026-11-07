// scripts/demo.sh's is_demo_pid: which processes count as the demo's. It runs the function
// from the script itself (zsh, ps, lsof) against real processes. Skipped where zsh or lsof is missing.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = readFileSync(new URL("../scripts/demo.sh", import.meta.url), "utf8");
const fn = /^is_demo_pid\(\) \{\n[\s\S]*?^\}$/m.exec(script)?.[0];
const has = (cmd) => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;
const skip = !has("zsh") || !has("lsof") ? "needs zsh and lsof" : false;
// Recent macOS no longer prints another process's environment with `ps eww`; there only the
// lsof check can tell, which is why the script gained it.
const psShowsEnv = spawnSync("sh", ["-c", "DEMO_TEST_PROBE=1 sleep 2 & ps eww -p $!; kill $!"])
  .stdout.toString().includes("DEMO_TEST_PROBE=1");

const root = realpathSync(mkdtempSync(join(tmpdir(), "demo-test-")));
const dir = join(root, "hsd"), outside = join(root, "other");
mkdirSync(dir); mkdirSync(outside);
const children = [];
after(() => { for (const c of children) c.kill(); rmSync(root, { recursive: true, force: true }); });

// A process that keeps `file` open (as the core keeps its socket, log and lock), with extra env.
async function holding(file, env = {}) {
  const child = spawn("zsh", ["-c", 'exec 3>"$1"; sleep 30', "holder", file], { env: { ...process.env, ...env }, stdio: "ignore" });
  children.push(child);
  for (let i = 0; i < 50; i++) {
    if (spawnSync("lsof", ["-p", String(child.pid), "-Fn"]).stdout.toString().includes(file)) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return child.pid;
}

const isDemo = (pid) => spawnSync("zsh", ["-c", `dir=${JSON.stringify(dir)}\n${fn}\nis_demo_pid "$1"`, "t", String(pid ?? "")]).status === 0;

test("the script still defines is_demo_pid", { skip }, () => {
  assert.ok(fn, "is_demo_pid() { ... } in scripts/demo.sh");
});

test("a process holding a file inside the demo folder is the demo's (a launchd core)", { skip }, async () => {
  assert.equal(isDemo(await holding(join(dir, "core.lock"))), true);
});

test("a process whose files live elsewhere is not the demo's (the person's own core)", { skip }, async () => {
  assert.equal(isDemo(await holding(join(outside, "core.lock"))), false);
});

test("a process with the demo's HERDR_APP_HOME is the demo's (the window)", { skip: skip || (!psShowsEnv && "ps does not show environments here") }, async () => {
  assert.equal(isDemo(await holding(join(outside, "app.log"), { HERDR_APP_HOME: `${dir}/app` })), true);
});

test("no pid is never the demo's", { skip }, () => {
  assert.equal(isDemo(""), false);
});
