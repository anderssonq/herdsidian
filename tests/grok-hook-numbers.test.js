// Grok status line: the six number fields of the payload go into the file as text, spliced in by
// the shell (only the JSON number grammar gets through, else null), and plutil only escapes the
// three string fields.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = new URL("../scripts/grok-status-line.sh", import.meta.url).pathname;
const skip = process.platform !== "darwin";

// The payload is a raw string so a number can be written exactly as Grok would print it.
const raw = (cost, size, tokens, pct, tin, tout) => `{"session_id":"s1","cwd":"/w","model":{"id":"m","display_name":"G"},`
  + `"cost":{"total_cost_usd":${cost}},"context_window":{"context_window_size":${size},"context_tokens":${tokens},`
  + `"used_percentage":${pct},"session_input_tokens":${tin},"session_output_tokens":${tout}}}`;

function written(input) {
  const state = mkdtempSync(join(tmpdir(), "hs-grok-num-"));
  const r = spawnSync("/bin/sh", [SCRIPT], { input, env: { PATH: "/usr/bin:/bin", HOME: state, XDG_STATE_HOME: state }, encoding: "utf8" });
  assert.equal(r.status, 0);
  return JSON.parse(readFileSync(join(state, "herdsidian", "grok", "s1.json"), "utf8"));
}

test("numbers: integers, decimals, negatives and exponents keep their value and type", { skip }, () => {
  const got = written(raw("0.5", "256000", "-3", "12.75", "1.5e3", "0"));
  assert.equal(got.cost_usd, 0.5);
  assert.equal(got.context_window_size, 256000);
  assert.equal(got.context_tokens, -3);
  assert.equal(got.used_percentage, 12.75);
  assert.equal(got.session_input_tokens, 1500);
  assert.equal(got.session_output_tokens, 0);
  assert.equal(got.v, 1);
});

test("numbers: a value outside the JSON number grammar becomes null and loses no other field", { skip }, () => {
  const got = written(raw('"abc"', '"007"', "true", '"1."', '".5"', "5"));
  assert.equal(got.cost_usd, null);
  assert.equal(got.context_window_size, null);
  assert.equal(got.context_tokens, null);
  assert.equal(got.used_percentage, null);
  assert.equal(got.session_input_tokens, null);
  assert.equal(got.session_output_tokens, 5);
  assert.equal(got.session_id, "s1");
  assert.equal(Object.keys(got).length, 11);
});

test("numbers: plutil only inserts strings, so the number fields cost no process", () => {
  const text = readFileSync(SCRIPT, "utf8");
  assert.doesNotMatch(text, /-json (?!null\b)/, "only -json null is used, for an empty string");
  const code = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.equal([...code.matchAll(/\|\s*ins_s\s+\w+/g)].length, 3, "three plutil insert call sites, comments not counted");
});
