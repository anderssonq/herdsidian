// The Files tab preview: long lines wrap (no sideways scroll) and common web files get a grammar the editor has
// (Herdr's syntect set: Markdown, JavaScript, CSS, HTML, JSON, YAML; no TypeScript, SCSS or Vue).
import { test } from "node:test";
import assert from "node:assert/strict";
import { state, fakeCx } from "./support/mod-stubs.js";

const stubs = globalThis.__herdsidianStubs;
const { FilesTab, location } = await import("../mods/herdsidian/files-view.js");
const { languageOf } = await import("../mods/herdsidian/files-tree.js");

// Opens `path` in the preview and returns the options the editor state was made with.
async function previewOptions(path) {
  const made = [], original = stubs["gpui-base"].EditorState.new;
  stubs["gpui-base"].EditorState.new = (opts = {}) => { made.push(opts); return original(opts); };
  state.readTextFile = async () => "x".repeat(500) + "\n";
  try {
    const tab = new FilesTab({});
    tab.context = { key: JSON.stringify(location()) };
    tab.root = "/r";
    await tab.show(path, fakeCx());
    for (let i = 0; i < 5 && !made.length; i++) await new Promise((r) => setImmediate(r));
  } finally { stubs["gpui-base"].EditorState.new = original; }
  assert.equal(made.length, 1, "one editor state for the preview");
  return made[0];
}

test("Files preview: long lines wrap instead of scrolling sideways", async () => {
  const opts = await previewOptions("long.md");
  assert.equal(opts.soft_wrap, true);
  assert.equal(opts.readonly, true);
});

test("Files preview: the editor gets every semantic color, not only the basic seven", async () => {
  const { syntax } = await previewOptions("a.js");
  for (const k of ["keyword", "string", "comment", "function", "type", "number", "constant", "variable", "operator", "punctuation", "boolean", "string.escape"])
    assert.ok(syntax[k], `syntax.${k} is set`);
});

test("Files preview: web files map to a grammar the editor has", () => {
  const cases = {
    "README.md": "md", "notes.markdown": "md", "page.mdx": "md",
    "a.js": "js", "a.mjs": "js", "a.cjs": "js", "a.jsx": "js", "a.ts": "js", "a.tsx": "js", "a.mts": "js", "a.cts": "js",
    "App.vue": "html", "App.svelte": "html", "index.html": "html", "index.htm": "html",
    "a.css": "css", "a.scss": "css", "a.sass": "css", "a.less": "css",
    "a.json": "json", "a.jsonc": "json", "a.yml": "yml", "a.toml": "yaml",
  };
  for (const [path, lang] of Object.entries(cases)) assert.equal(languageOf(path), lang, path);
});
