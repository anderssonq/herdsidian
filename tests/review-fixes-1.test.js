// Four minor review findings of the sidebar motion and layout work: the docs width, a switch that snaps when the
// width or order changed, a menu write for an unknown tab, and a typed note name that is not a plain leaf.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { state, fakeCx, findById, STORE, LAYOUT_STORE } from "./support/sidebar-kit.js";
import { realHost } from "./support/real-host.js";

const { TabMenu } = await import("../mods/herdsidian/sidebar-menu-view.js");
const { stepMotion } = await import("../mods/herdsidian/sidebar-motion.js");
const { makeNamedNote } = await import("../mods/herdsidian/vault-io.js");

const ORDER = ["notes", "files", "changes", "git"];
const SWAPPED = ["files", "notes", "changes", "git"];

test("finding 1 the README and RECIPE layout examples say max 760", () => {
  for (const file of ["README.md", "RECIPE.md"]) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.ok(text.includes('"max": 760'), `${file} shows max 760`);
    assert.ok(!text.includes('"max": 720'), `${file} no longer shows max 720`);
  }
});

const at = (top, extra = {}) => ({ top, shown: [top], order: ORDER, wide: true, width: 380, ...extra });

test("finding 2 a tab switch with a changed width or order does not slide the pill", () => {
  const widthNew = stepMotion(at("notes"), at("files", { width: 420 }));
  assert.equal(widthNew.slide, false, "a new body and a new width");
  const orderNew = stepMotion(at("notes"), at("files", { order: SWAPPED }));
  assert.equal(orderNew.slide, false, "a new body and a new order");
  const swapPrev = at("notes", { shown: ["notes", "files"] });
  const swap = stepMotion(swapPrev, at("files", { shown: ["notes", "files"], width: 420 }));
  assert.equal(swap.slide, false, "a split swap and a new width");
  assert.equal(stepMotion(at("notes"), at("files")).slide, true, "control: a plain switch still slides");
});

for (const tab of ["bogus", undefined]) {
  test(`finding 3 Open below for an unknown tab (${tab}) writes nothing and closes`, () => {
    Object.assign(state, { shared: { [STORE]: { tab: "files" }, [LAYOUT_STORE]: { order: ORDER } }, closed: [] });
    state.props = { overlay: "menu-1", sidebarMenu: { tab, op: "open-below" } };
    const cx = fakeCx();
    const menu = new TabMenu(cx);
    state.props = { overlay: "menu-1" };
    findById(menu.render(), "sidebar-menu-open-below").onClick({}, cx);
    assert.deepEqual(state.shared[LAYOUT_STORE], { order: ORDER });
    assert.deepEqual(state.closed, ["menu-1"]);
  });
}

let root, vault, host;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "herdsidian-fix-"));
  vault = `${root}/vault`;
  mkdirSync(vault);
  host = realHost({ root });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

for (const name of ["../x.md", "a/b.md"]) {
  test(`finding 4 makeNamedNote refuses ${JSON.stringify(name)} and writes nothing`, async () => {
    const writes = [];
    const deps = {
      exec: (...a) => host.exec(...a),
      writeTextFile: (...a) => {
        writes.push(a);
        return host.writeTextFile(...a);
      },
    };
    const r = await makeNamedNote(vault, name, { deps });
    assert.equal(r.ok, false);
    assert.equal(typeof r.reason, "string");
    assert.deepEqual(writes, [], "no write was asked for");
    assert.deepEqual(readdirSync(vault), [], "nothing inside the vault");
    assert.deepEqual(readdirSync(root), ["vault"], "nothing outside the vault");
    assert.equal(existsSync(join(root, "x.md")), false);
  });
}
