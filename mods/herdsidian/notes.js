// The mod's pure logic, with no Herdr or GPUI imports so it can be tested with node.

export const HIDDEN = new Set([".obsidian", ".git", ".trash", "node_modules"]);

// A note's name: its file name without .md.
export const base = (path) => path.split("/").pop().replace(/\.md$/i, "");

// True when a changed path is inside a folder the panel never shows (.obsidian, .git, ...).
export const hidden = (vault, path) => path.slice(vault.length + 1).split("/").some((part) => HIDDEN.has(part));

// The one wikilink pattern: groups are embed "!", target, #heading, alias. The graph reads links with it too.
export const WIKILINK = /(!?)\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

// True for an embed of a file that is not a note (![[shot.png]]); `name` is the trimmed target.
export const isFileEmbed = (embed, name) => Boolean(embed) && /\.(?!md$)\w+$/i.test(name);

// Applies `fn` to the text outside code (fenced blocks and inline spans) and keeps code as written.
export function mapProse(text, fn) {
  const parts = [];
  let prose = "";
  let fence = null; // { ch, len } while inside a fenced block
  for (const line of text.match(/[^\n]*\n|[^\n]+/g) ?? []) {
    if (fence) {
      const close = line.match(/^ {0,3}(`+|~+)[ \t]*\r?\n?$/);
      if (close && close[1][0] === fence.ch && close[1].length >= fence.len) fence = null;
      parts.push(line);
      continue;
    }
    // A backtick fence's info string can't hold a backtick: "```npm i``` x" is a code span, not a fence.
    const open = line.match(/^ {0,3}(`{3,}(?![^\n]*`)|~{3,})/);
    if (open) {
      fence = { ch: open[1][0], len: open[1].length };
      if (prose) parts.push(fn(prose));
      prose = "";
      parts.push(line);
      continue;
    }
    // Inline spans: a run of n backticks up to the next run of exactly n.
    let i = 0;
    while (i < line.length) {
      const start = line.indexOf("`", i);
      if (start < 0) break;
      let n = 1;
      while (line[start + n] === "`") n++;
      let end = start + n, found = -1;
      while ((end = line.indexOf("`", end)) >= 0) {
        let m = 1;
        while (line[end + m] === "`") m++;
        if (m === n) { found = end; break; }
        end += m;
      }
      if (found < 0) { prose += line.slice(i, start + n); i = start + n; continue; }
      prose += line.slice(i, start);
      if (prose) parts.push(fn(prose));
      prose = "";
      parts.push(line.slice(start, found + n));
      i = found + n;
    }
    prose += line.slice(i);
  }
  if (prose) parts.push(fn(prose));
  return parts.join("");
}

// Obsidian Markdown to plain Markdown: frontmatter as a code block, wikilinks as note: links.
// Embeds of non-notes (![[shot.png]]) can't be shown: they stay as their file name.
// Code stays as written. ( and ) are escaped in the link so a Markdown parser reads it whole.
export function render(text) {
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const body = front ? text.slice(front[0].length) : text;
  const linked = mapProse(body, (prose) => prose.replace(WIKILINK, (_m, embed, target, heading, alias) =>
    isFileEmbed(embed, target.trim()) ? `\`${target.trim()}\``
      : `[${alias || target + (heading ?? "")}](note:${encodeURIComponent(target.trim()).replace(/\(/g, "%28").replace(/\)/g, "%29")})`));
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
