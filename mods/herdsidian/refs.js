// Rewrites the links in a note after a rename, with no Herdr or GPUI imports so it can be tested with node.
// It reads links as render() and follow() do, and a link only changes to a form the app opens at the new path.
import { bucketByBase, resolveIn } from "./graph.js";
import { FRONTMATTER, WIKILINK, base, dirOf, isFileEmbed, leafOf, linkTarget, mapProse, normKey } from "./notes.js";

// Only the `](dest "title")` part of a Markdown link, so the link text stays untouched and a reference
// definition, which has no `](`, never matches.
const MD_DEST = /\]\(([ \t]*)(<[^<>\n]*>|(?:[^\s()\\]|\\.|\([^\s()]*\))*)((?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t]*)\)/;
// The wikilink branch comes first, so `[[x]](y.md)` is one wikilink plus plain text.
const LINK = new RegExp(`${WIKILINK.source}|${MD_DEST.source}`, "g");
const ONE_WIKILINK = new RegExp(`^${WIKILINK.source}$`);
const ONE_MD_DEST = new RegExp(`^${MD_DEST.source}$`);
// The URLs follow() hands to the system. Any other scheme-like text goes to resolve(), so "v1: x" can be a note.
const EXTERNAL = /^https?:|^mailto:/;
// A real URL that resolve() can still match by name, such as ftp://x/Old.md: it is not ours to rewrite.
const URL_FORM = /^[a-z][a-z0-9+.-]*:\/\//i;
const MD_ENDING = /\.md$/i;
// What the app's scanners read across a link's edges: mapProse() pairs a backtick with another one on the
// line, and WIKILINK reads `[[` to the next `]]`, so a form that adds one may not read as itself in the note.
const SCANNED = ["`", "[[", "]]"];

const isSkipped = ({ url, target }) => !target || EXTERNAL.test(url);
// CommonMark escapes only ASCII punctuation, so `\b` keeps its backslash, as in a note named with one.
const dropEscapes = (text) => text.replace(/\\([!-/:-@[-`{-~])/g, "$1");
const encodeSegment = (segment) => segment.replace(/[% ()<>]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

// Link parts as `before + path + after`, where `path` is the only part a rename may change, `url` is what
// follow() receives and `target` is what the app looks up. render() makes every wikilink a note: URL.
function parseWikilink(text) {
  const found = text.match(ONE_WIKILINK);
  if (!found) return null;
  const [, embed, raw] = found;
  const target = raw.trim();
  const start = embed.length + 2 + raw.indexOf(target);
  return { isWiki: true, embed, url: `note:${target}`, target, before: text.slice(0, start), path: target, after: text.slice(start + target.length) };
}

function parseMarkdown(text) {
  const found = text.match(ONE_MD_DEST);
  if (!found) return null;
  const [, lead, dest, title] = found;
  const isAngle = dest.startsWith("<");
  const inner = isAngle ? dest.slice(1, -1) : dest;
  // linkTarget() drops a leading note:, so it is not part of the path.
  const prefix = inner.startsWith("note:") ? "note:" : "";
  const path = inner.slice(prefix.length).match(/^(?:\\[^]|[^#])*/)[0];
  const url = dropEscapes(inner);
  return {
    isWiki: false, url, target: linkTarget(url), path,
    before: `](${lead}${isAngle ? "<" : ""}${prefix}`,
    after: `${inner.slice(prefix.length + path.length)}${isAngle ? ">" : ""}${title})`,
  };
}

const parseLink = (text) => (text.startsWith("]") ? parseMarkdown(text) : parseWikilink(text));

const countOf = (text, mark) => text.split(mark).length - 1;

// True when the form reads as itself: the same parts alone, and nothing new for the app's scanners in the note.
function readsAsItself(link, form, parsed) {
  return parsed && parsed.path === form && parsed.before === link.before && parsed.after === link.after
    && !SCANNED.some((mark) => countOf(form, mark) > countOf(link.path, mark));
}

// The first form that reads as itself and passes `opens`, or null.
function pick(link, forms, opens) {
  for (const form of forms) {
    const parsed = parseLink(`${link.before}${form}${link.after}`);
    if (!readsAsItself(link, form, parsed) || EXTERNAL.test(parsed.url)) continue;
    if (opens(parsed)) return `${link.before}${form}${link.after}`;
  }
  return null;
}

// Each written segment as the app reads it. linkTarget() decodes all or nothing, so one bad `%` keeps them all raw.
function plainSegments(link) {
  const parts = link.path.split("/");
  if (link.isWiki) return parts;
  const clean = parts.map(dropEscapes);
  try {
    decodeURIComponent(clean.join("/"));
  } catch {
    return clean;
  }
  return clean.map(decodeURIComponent);
}

const encoded = (link, segment) => (link.isWiki ? segment : encodeSegment(segment));
const writtenEnding = (plain) => plain[plain.length - 1].match(MD_ENDING)?.[0] ?? "";

// How many written segments name the real path, counted from the end; leading `.` and `..` never count.
function alignedCount(plain, segments, isNote) {
  const first = plain.findIndex((part) => part !== "." && part !== "..");
  if (first < 0) return 0;
  const key = isNote ? (part) => part.toLowerCase() : normKey;
  const same = (a, b, isLast) => (isLast && isNote ? key(a).replace(/\.md$/, "") === key(b).replace(/\.md$/, "") : key(a) === key(b));
  let count = 0;
  while (count < segments.length && plain.length - 1 - count >= first
    && same(plain[plain.length - 1 - count], segments[segments.length - 1 - count], count === 0)) count++;
  return count;
}

// The written path with only the renamed part replaced, so `[[F/F]]` and `a/F/F/x` change the right segment.
function keptForm(ctx, link, real, isNote) {
  const written = link.path.split("/");
  const plain = plainSegments(link);
  if (!ctx.isDir) {
    written[written.length - 1] = encoded(link, `${base(ctx.to)}${writtenEnding(plain)}`);
    return written.join("/");
  }
  const segments = real.split("/");
  const fromEnd = segments.length - ctx.from.split("/").length;
  if (fromEnd >= alignedCount(plain, segments, isNote)) return link.path;
  written[written.length - 1 - fromEnd] = encoded(link, leafOf(ctx.to));
  return written.join("/");
}

// The new path from the vault root; a note keeps the `.md` ending as written.
function rootForm(link, newPath, isNote) {
  const segments = newPath.split("/");
  if (isNote) segments[segments.length - 1] = `${base(newPath)}${writtenEnding(plainSegments(link))}`;
  return segments.map((segment) => encoded(link, segment)).join("/");
}

function settle(tally, text, next) {
  if (next === null) {
    tally.failed += 1;
    return text;
  }
  if (next !== text) tally.changed += 1;
  return next;
}

// AC32: the link stays, and it is counted when the renamed item now takes it from what it meant before.
function countCapture(ctx, holder, target, hit, tally) {
  const after = resolveIn(ctx.next.buckets, holder.next, target, ctx.next.memo);
  if (after && ctx.isAtNewPath(after) && after !== hit) tally.captured += 1;
}

function noteBranch(ctx, holder, text, link, hit, tally) {
  if (!ctx.moved(hit)) {
    countCapture(ctx, holder, link.target, hit, tally);
    return text;
  }
  if (URL_FORM.test(link.target)) return settle(tally, text, null);
  const goal = ctx.map(hit);
  const next = pick(link, [keptForm(ctx, link, hit, true), rootForm(link, goal, true)], (parsed) =>
    !isFileEmbed(link.embed, parsed.target)
    && resolveIn(ctx.next.buckets, holder.next, parsed.target, ctx.next.memo) === goal);
  return settle(tally, text, next);
}

// A form the rewrite leaves as written, such as [t](Old) or [a](/Old.md), though the app opens the moved note with
// it. Its note is reported, unless no written part names what moved and it still opens that note.
function countKept(ctx, holder, link, hit, tally) {
  const stillOpens = resolveIn(ctx.next.buckets, holder.next, link.target, ctx.next.memo) === ctx.map(hit);
  if (!stillOpens || keptForm(ctx, link, hit, true) !== link.path) tally.failed += 1;
}

function attachmentBranch(ctx, holder, text, link, tally) {
  if (!ctx.isDir || !ctx.files) return text;
  if (!link.target.replace(/^(?:\.\.?\/)+/, "").includes("/")) return text;
  const found = findAttachment(ctx.files.old, dirOf(holder.old), link.target);
  if (!found) return text;
  if (found.several) {
    if (found.several.some(ctx.moved)) tally.failed += 1;
    return text;
  }
  if (!ctx.moved(found.file)) return text;
  const goal = ctx.map(found.file);
  const next = pick(link, [keptForm(ctx, link, found.file, false), rootForm(link, goal, false)], (parsed) =>
    findAttachment(ctx.files.next, dirOf(holder.next), parsed.target)?.file === goal);
  return settle(tally, text, next);
}

function rewriteLink(ctx, holder, text, tally) {
  const link = parseLink(text);
  if (isSkipped(link)) return text;
  const isAbsolute = link.target.startsWith("/"); // stays as written (AC24, AC42)
  if (link.isWiki && isFileEmbed(link.embed, link.target)) return isAbsolute ? text : attachmentBranch(ctx, holder, text, link, tally);
  const hit = resolveIn(ctx.old.buckets, holder.old, link.target, ctx.old.memo);
  const isNoteLink = link.isWiki || MD_ENDING.test(link.target);
  if (hit && isNoteLink && !isAbsolute) return noteBranch(ctx, holder, text, link, hit, tally);
  if (hit) {
    if (ctx.moved(hit)) countKept(ctx, holder, link, hit, tally);
    return text;
  }
  if (isAbsolute) return text;
  const next = isNoteLink && !link.isWiki ? text : attachmentBranch(ctx, holder, text, link, tally);
  if (next === text) countCapture(ctx, holder, link.target, null, tally);
  return next;
}

const isEscaped = (text, at) => {
  let slashes = 0;
  while (at - slashes > 0 && text[at - slashes - 1] === "\\") slashes++;
  return slashes % 2 === 1;
};

// True when the newline at `at` ends a line with no text.
const endsBlankLine = (text, at) => {
  let i = at - 1;
  while (i >= 0 && " \t\r".includes(text[i])) i--;
  return i >= 0 && text[i] === "\n";
};

// A `](` is a link only with an unmatched `[` in its paragraph. `carried` holds the ones in earlier prose,
// because a code span in the link text splits the prose: [`code`](x.md). A fence ends the paragraph, as a blank line does.
function hasOpener(prose, end, carried) {
  let depth = 0;
  for (let i = end - 1; i >= 0; i--) {
    const ch = prose[i];
    if (ch === "\n" && endsBlankLine(prose, i)) return false;
    if ((ch !== "[" && ch !== "]") || isEscaped(prose, i)) continue;
    if (ch === "]") depth++;
    else if (depth === 0) return true;
    else depth--;
  }
  return carried > depth;
}

// The unmatched `[` still open at the end of this prose.
function openersAfter(prose, carried) {
  let open = carried;
  for (let i = 0; i < prose.length; i++) {
    const ch = prose[i];
    if (ch === "\n" && endsBlankLine(prose, i)) open = 0;
    else if (ch === "[" && !isEscaped(prose, i)) open++;
    else if (ch === "]" && !isEscaped(prose, i)) open = Math.max(0, open - 1);
  }
  return open;
}

// One note list's buckets and memo, the same answers as resolve() and fast at 5000 notes.
const lookup = (notes) => ({ buckets: bucketByBase(notes), memo: new Map() });

// The attachment index for findAttachment(), built once per file list.
export function indexFiles(files) {
  const paths = new Map();
  const leaves = new Map();
  const add = (map, key, file) => {
    const list = map.get(key);
    if (list) list.push(file);
    else map.set(key, [file]);
  };
  for (const file of files) {
    const key = normKey(file);
    add(paths, key, file);
    add(leaves, leafOf(key), file);
  }
  return { paths, leaves };
}

// The normalized path from `start`, or null when it goes above the vault root.
function joinPath(start, written) {
  const out = [];
  for (const part of `${start}/${written}`.split("/")) {
    if (part === "..") {
      if (!out.length) return null;
      out.pop();
    } else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

const oneOrSeveral = (files) => (files.length === 1 ? { file: files[0] } : { several: files });

// AC41: from the note's folder, then from the root, then by a path ending. -> { file } | { several: [] } | null
export function findAttachment(index, holderDir, written) {
  if (MD_ENDING.test(written)) return null;
  for (const start of [holderDir, ""]) {
    const path = joinPath(start, written);
    const hit = path === null ? null : index.paths.get(normKey(path));
    if (hit) return oneOrSeveral(hit);
  }
  const ending = normKey(written.replace(/^(?:\.\.?\/)+/, ""));
  const found = (index.leaves.get(leafOf(ending)) ?? []).filter((file) => {
    const key = normKey(file);
    return key === ending || key.endsWith(`/${ending}`);
  });
  return found.length ? oneOrSeveral(found) : null;
}

// One rename's lists and path rules, for all the notes it checks. files: string[] | null (attachments not checked).
export function buildRewrite({ from, to, isDir, notes, files }) {
  const under = (path, item) => path === item || (isDir && path.startsWith(`${item}/`));
  const moved = (path) => under(path, from);
  const map = (path) => (moved(path) ? `${to}${path.slice(from.length)}` : path);
  return {
    from, to, isDir, moved, map,
    isAtNewPath: (path) => under(path, to),
    // AC38: a same-name or case-only rename changes no other note.
    isSameItem: normKey(from) === normKey(to),
    old: lookup(notes),
    next: lookup(notes.map(map).sort()),
    files: isDir && files ? { old: indexFiles(files), next: indexFiles(files.map(map)) } : null,
  };
}

// The note's new text, and the count of links changed, links that could not change, and links captured.
// holderOld is the path before the rename; a note with no change returns the same string.
export function rewriteNote(ctx, holderOld, text) {
  const tally = { changed: 0, failed: 0, captured: 0 };
  if (ctx.isSameItem) return { text, ...tally };
  const holder = { old: holderOld, next: ctx.map(holderOld) };
  const front = text.match(FRONTMATTER)?.[0] ?? "";
  let carried = 0;
  const body = mapProse(text.slice(front.length), (prose, afterFence) => {
    if (afterFence) carried = 0;
    const out = prose.replace(LINK, (match, _embed, _target, _heading, _alias, _lead, _dest, _title, offset) => {
      if (match.startsWith("]") && (isEscaped(prose, offset) || !hasOpener(prose, offset, carried))) return match;
      return rewriteLink(ctx, holder, match, tally);
    });
    carried = openersAfter(prose, carried);
    return out;
  });
  return { text: `${front}${body}`, ...tally };
}

// The UTF-8 byte count of the text, because TextEncoder is not documented in the mod runtime.
export function utf8Length(text) {
  let bytes = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}
