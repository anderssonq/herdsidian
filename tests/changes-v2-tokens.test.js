import { test } from "node:test";
import assert from "node:assert/strict";
import * as lib from "../lib/tokens.js";
import { themeOf } from "./support/themes.js";

// Expected values are worked out by hand (alpha level = round(a * 255)); no alpha() call.
// carbon is dark: a = 0.12 -> 31 = 1f; word 0.288 -> 73 = 49.
// nord_light is light: a = 0.16 -> 41 = 29; word 0.384 -> 98 = 62.
// hunk 0.04 -> 10 = 0a; well 0.6 -> 153 = 99. With the glass on, canvas decides the same way for both themes.
const EXPECTED = {
  carbon: {
    addLine: "#3fbf8f1f", delLine: "#f14c4c1f", addWord: "#3fbf8f49", delWord: "#f14c4c49",
    addMark: "#3fbf8f", delMark: "#f14c4c", hunk: "#d6d6dd0a", well: "#12121299",
  },
  nord_light: {
    addLine: "#5f7f4529", delLine: "#bf616a29", addWord: "#5f7f4562", delWord: "#bf616a62",
    addMark: "#5f7f45", delMark: "#bf616a", hunk: "#2e34400a", well: "#e5e9f099",
  },
};

const FIELDS = ["addLine", "delLine", "addWord", "delWord", "addMark", "delMark", "hunk", "well"];

test("diffTokens is exported", () => {
  assert.equal(typeof lib.diffTokens, "function");
});

for (const [name, expected] of Object.entries(EXPECTED)) {
  for (const glass of [false, true]) {
    test(`AC42 diffTokens gives the exact values for hs_${name}, glass ${glass ? "on" : "off"}`, () => {
      const d = lib.diffTokens(themeOf(name, { glass }));
      for (const field of FIELDS) {
        const want = field === "well" && !glass ? null : expected[field];
        assert.equal(d[field], want, field);
      }
    });
  }
}

test("AC42 diffTokens returns the four text colors as #rrggbb, and no other key", () => {
  const d = lib.diffTokens(themeOf("carbon"));
  assert.deepEqual(Object.keys(d).sort(), [...FIELDS, "text", "numText", "addText", "delText"].sort());
  for (const k of ["text", "numText", "addText", "delText"]) assert.match(d[k], /^#[0-9a-f]{6}$/, k);
});

test("AC42 diffTokens tints and marks are the same with the glass on and off", () => {
  for (const name of Object.keys(EXPECTED)) {
    const off = lib.diffTokens(themeOf(name));
    const on = lib.diffTokens(themeOf(name, { glass: true }));
    for (const k of ["addLine", "delLine", "addWord", "delWord", "addMark", "delMark", "hunk"]) assert.equal(on[k], off[k], `${name} ${k}`);
  }
});
