// The herdsidian-toast "+N more" row takes its height from the model (A.more), the same value
// windowSpec counts, so the row and the window cannot drift apart.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../mods/herdsidian-toast/card-view.js", import.meta.url), "utf8");

test("moreRow sizes itself with A.more, not a literal height", () => {
  const row = source.slice(source.indexOf("export const moreRow"));
  assert.match(row, /\.h\(A\.more\)/);
  assert.doesNotMatch(row, /\.h\(\d+\)/);
});
