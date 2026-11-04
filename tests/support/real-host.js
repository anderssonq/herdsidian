// Real file operations for the temp-folder tests: exec, readTextFile and writeTextFile as Herdr gives
// them, on a real disk. Safety is in code: root must be under the temp folder, and /usr/bin/trash is
// never run. A fake moves the item into <root>/FakeTrash. Only one opt-in path reaches the real Trash.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, lstatSync, realpathSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, resolve, sep } from "node:path";

const run = promisify(execFile);
const MAX_OUTPUT = 8 * 1024 * 1024 - 1024;
const MAX_TEXT = 1024 * 1024;
export const FAKE_TRASH = "FakeTrash";

const inside = (path, base) => path !== base && path.startsWith(base + sep);

// The one place a path is checked against root: lexical and real, so a link cannot lead out.
function assertUnder(path, root, what) {
  if (typeof path !== "string" || path !== resolve(path)) throw new Error(`${what}: not a clean absolute path: ${path}`);
  if (!inside(path, root)) throw new Error(`${what}: outside the test root: ${path}`);
  const parent = realpathSync(dirname(path));
  if (!(parent === realpathSync(root) || inside(parent, realpathSync(root)))) throw new Error(`${what}: leads outside the test root: ${path}`);
}

function assertRoot(root) {
  if (typeof root !== "string" || root !== resolve(root)) throw new Error(`realHost: root is not a clean absolute path: ${root}`);
  const base = realpathSync(tmpdir());
  if (!inside(root, tmpdir()) && !inside(root, base)) throw new Error(`realHost: root is not under the temp folder: ${root}`);
  if (!inside(realpathSync(root), base)) throw new Error(`realHost: root leads outside the temp folder: ${root}`);
}

// options.trash: "ok" moves into FakeTrash; "fail" exits 1; "stuck" exits 0 and leaves the item; "missing"
// exits 1 as if it was never there. options.realTrash needs HERDSIDIAN_REAL_TRASH=1 on darwin.
export function realHost({ root, trash = "ok", realTrash = false } = {}) {
  assertRoot(root);
  if (realTrash && (process.env.HERDSIDIAN_REAL_TRASH !== "1" || process.platform !== "darwin")) {
    throw new Error("realHost: the real Trash needs HERDSIDIAN_REAL_TRASH=1 on darwin");
  }
  const calls = [];
  let n = 0;

  function checkTrash(args) {
    if (args.length !== 2 || args[0] !== "-s") throw new Error(`trash: arguments must be exactly ["-s", abs]: ${JSON.stringify(args)}`);
    assertUnder(args[1], root, "trash");
    if (inside(args[1], resolve(root, FAKE_TRASH))) throw new Error("trash: the item is already in FakeTrash");
    return args[1];
  }

  async function fakeTrash(args) {
    const abs = checkTrash(args);
    calls.push(["trash", ...args]);
    if (trash === "fail") return { code: 1, stdout: "", stderr: "trash: failed" };
    if (trash === "missing") return { code: 1, stdout: "", stderr: "trash: no such file" };
    if (trash === "stuck") return { code: 0, stdout: "", stderr: "" };
    if (!existsSync(abs) && !isLink(abs)) return { code: 1, stdout: "", stderr: "trash: no such file" };
    const dir = resolve(root, FAKE_TRASH);
    mkdirSync(dir, { recursive: true });
    return exec("/bin/mv", [abs, `${dir}/${n++}-${basename(abs)}`]);
  }

  // One temp file named herdsidian-test-*, nothing else, and only when opted in.
  async function realTrashCall(args) {
    const abs = checkTrash(args);
    if (!basename(abs).startsWith("herdsidian-test-") || !lstatSync(abs).isFile()) {
      throw new Error("trash: the real Trash takes one herdsidian-test-* file only");
    }
    calls.push(["real-trash", ...args]);
    return run("/usr/bin/trash", args).then(done, failed);
  }

  const done = ({ stdout, stderr }) => ({ code: 0, stdout, stderr });
  const failed = (e) => {
    if (typeof e.code !== "number") throw e;
    return { code: e.code, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  };

  async function exec(cmd, args = [], opts = {}) {
    if (basename(cmd) === "trash") return realTrash ? realTrashCall(args) : fakeTrash(args);
    // No shell may reach the Trash behind the guard.
    if (["sh", "bash", "zsh"].includes(basename(cmd)) && args.some((a) => /\btrash\b/.test(a))) throw new Error("exec: a shell may not call trash");
    return run(cmd, args, { cwd: opts.cwd, maxBuffer: MAX_OUTPUT, encoding: "utf8" }).then(done, failed);
  }

  // As Herdr: a missing file resolves null; a file too large or not UTF-8 rejects.
  async function readTextFile(path) {
    if (!existsSync(path)) return null;
    if (statSync(path).size > MAX_TEXT) throw new Error("Text file exceeds 1 MiB");
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
    } catch {
      throw new Error("stream did not contain valid UTF-8");
    }
  }

  // Compare-and-swap: null creates and fails if the file exists; a string must equal what is on disk.
  async function writeTextFile(path, text, previous) {
    assertUnder(path, root, "write");
    if (previous === null) {
      writeFileSync(path, text, { flag: "wx" });
      return;
    }
    let current = null;
    try { current = await readTextFile(path); } catch { /* unreadable counts as changed, like missing */ }
    if (current !== previous) throw new Error("The file changed outside Herdr");
    writeFileSync(path, text);
  }

  return { exec, readTextFile, writeTextFile, root, calls };
}

function isLink(path) {
  try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}
