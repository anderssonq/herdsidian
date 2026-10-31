// The mod's pure logic, with no Herdr or GPUI imports so it can be tested with node.

export const HIDDEN = new Set([".obsidian", ".git", ".trash", "node_modules"]);

// A note's name: its file name without .md.
export const base = (path) => path.split("/").pop().replace(/\.md$/i, "");

// True when a changed path is inside a folder the panel never shows (.obsidian, .git, ...).
export const hidden = (vault, path) => path.slice(vault.length + 1).split("/").some((part) => HIDDEN.has(part));

// Obsidian Markdown to plain Markdown: frontmatter as a code block, wikilinks as note: links.
// Embeds of non-notes (![[shot.png]]) can't be shown: they stay as their file name.
export function render(text) {
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const body = front ? text.slice(front[0].length) : text;
  const linked = body.replace(/(!?)\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, embed, target, heading, alias) =>
    embed && /\.(?!md$)\w+$/i.test(target.trim()) ? `\`${target.trim()}\``
      : `[${alias || target + (heading ?? "")}](note:${encodeURIComponent(target.trim())})`);
  return (front ? "```yaml\n" + front[1] + "\n```\n\n" : "") + linked;
}

// The link target a note: link names, without its #heading; "" when there's none.
export function linkTarget(url) {
  let target = url.replace(/^note:/, "");
  try { target = decodeURIComponent(target); } catch {}
  return target.replace(/#.*$/, "");
}

// The note a link from `from` points to, like Obsidian: the same folder first, then a
// path ending in it, then any note with that name. `all`: every note, relative paths.
export function resolve(all, from, target) {
  const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
  const want = target.toLowerCase().replace(/\.md$/, "");
  return all.find((p) => p.toLowerCase() === `${dir}${want}.md`)
    ?? all.find((p) => p.toLowerCase().replace(/\.md$/, "").endsWith(`/${want}`) || p.toLowerCase() === `${want}.md`)
    ?? all.find((p) => base(p).toLowerCase() === base(want))
    ?? null;
}
