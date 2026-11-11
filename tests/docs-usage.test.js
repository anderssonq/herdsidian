// Disclosure text for Kiro, Grok and the context window (AC 36, 37).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const README = read("README.md");
const RECIPE = read("RECIPE.md");

// A list item: from its first line to the next line that starts another item or a blank line.
const item = (text, start) => {
  const i = text.search(start);
  assert.ok(i >= 0, `no item matches ${start}`);
  const rest = text.slice(i);
  const end = rest.slice(1).search(/\n(?:- |\n)/);
  return end < 0 ? rest : rest.slice(0, end + 1);
};

const usageItems = () => ({
  "README.md": item(README, /^- \*\*Usage\*\*/m),
  "RECIPE.md": item(RECIPE, /^- Disclosure: `herdsidian-status`/m),
});
const contextItems = () => ({
  "README.md": item(README, /^- \*\*Context window\*\*/m),
  "RECIPE.md": item(RECIPE, /^- Disclosure: `guide-agents`/m),
});

test("AC36: the Usage disclosure names Kiro, Grok and both new paths", () => {
  for (const [name, text] of Object.entries(usageItems())) {
    for (const needle of ["Kiro", "Grok", "sessions/cli", "herdsidian/grok", "/bin/sh"]) {
      assert.ok(text.includes(needle), `${name}: ${needle}`);
    }
    assert.match(text, /KIRO_HOME/, name);
    assert.match(text, /read-only/i, name);
  }
});

test("AC36: the only network host is the Anthropic usage URL", () => {
  for (const [name, text] of Object.entries(usageItems())) {
    const hosts = [...text.matchAll(/https?:\/\/([^/\s`)]+)/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(hosts)], ["api.anthropic.com"], name);
    assert.ok(text.includes("https://api.anthropic.com/api/oauth/usage"), name);
    assert.match(text, /no (new )?network host/i, name);
    assert.match(text, /token is (read and sent[^.]*; )?(never|the mod never)/i, name);
  }
});

test("AC36: the guide-agents disclosure names the four session reads", () => {
  for (const [name, text] of Object.entries(contextItems())) {
    for (const needle of ["Claude", "Codex", "Kiro", "Grok", "~/.claude/projects",
      "~/.codex/sessions", "sessions/cli", "herdsidian/grok", "256 KiB"]) {
      assert.ok(text.includes(needle), `${name}: ${needle}`);
    }
  }
});

test("AC36: the README has the Grok install block and the never-edits rule", () => {
  assert.ok(README.includes("[ui.status_line]"));
  assert.ok(README.includes('type = "command"'));
  assert.ok(README.includes("scripts/grok-status-line.sh"));
  assert.match(README, /never edits `~\/\.grok\/config\.toml`/);
  assert.match(README, /replaces[^.]*status/i);
});

test("AC36: README and RECIPE cover the five CLIs", () => {
  assert.doesNotMatch(README, /Only Claude Code, Codex and opencode are covered/);
  assert.match(README, /Claude Code, Codex, opencode, Kiro and Grok/);
  assert.ok(RECIPE.includes("lib/agent-files.js"));
  assert.ok(RECIPE.includes("contextInSidebar"));
});

test("AC37: usage.js header comment lists every program and path", () => {
  const src = read("mods/herdsidian-status/usage.js");
  const header = src.split("\n").slice(0, 12).filter((l) => l.startsWith("//")).join("\n");
  for (const needle of ["/bin/sh", "find", "stat", "sessions/cli", "KIRO_HOME",
    "herdsidian/grok", "/usr/bin/security", "/usr/bin/curl", "opencode"]) {
    assert.ok(header.includes(needle), `header: ${needle}`);
  }
});
