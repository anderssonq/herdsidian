# Herdsidian

Your Obsidian vault inside the [Herdr](https://herdr.dev) desktop app: a
**Notes** sidebar to browse, read and edit your Markdown notes next to your
terminals and agents. It comes as the **Herdsidian** layout: near-black and
glass-tinted, with the **Herdsidian Carbon** theme and a sidebar that shows the
shortcut to every space and agent.

<!-- preview.png: pending (take it with a demo vault and demo spaces) -->

## What you get

- **Four color themes**, picked in Settings → Look:
  - `herdsidian_carbon` (default): neutral blacks and greys, one blue accent
    (`#4c9df3`), in the style of the Cursor IDE.
  - `herdsidian_midnight`: Tokyo Night colors.
  - `herdsidian_catppuccin`: Catppuccin Mocha colors, mauve accent.
  - `herdsidian_nord`: Nord colors, frost cyan accent.
  The glass background is part of the layout, so it stays charcoal with
  every theme.
- **Glass look**: a charcoal-to-black gradient shows through the terminals,
  the sidebar, the tab bar and the status bar.
- **Notes sidebar** (`herdsidian` mod), on the right:
  - Browse the vault's folders and `.md` notes, or find a note by name.
  - Read a note rendered: frontmatter, headings, links. `[[wikilinks]]`
    (with `|alias` and `#heading`) open the linked note; web links open in
    the browser.
  - Edit and save it. A save never overwrites a note that changed outside
    Herdr (Obsidian, git, an agent) since you opened it: you choose Reload
    or Overwrite.
  - Collapse it to an icon rail and expand it back, like the left sidebar.
  - Works with any folder of Markdown notes, not only Obsidian vaults.
- **Shortcut guide** (`guide-spaces` and `guide-agents` mods): each space shows
  `⌃1…⌃9` and each agent `⌘⌥1…⌘⌥9`, and the list headers summarise the keys.

## Keys

| Keys | What it does |
|---|---|
| `⌘⇧O` | Show or hide the Notes sidebar |
| `⌘E` | In a note: switch between Read and Edit |
| `⌘S` | In a note: save |
| `⌃1` … `⌃9` | Go to space 1–9 |
| `⌘⌥[` / `⌘⌥]` | Previous / next space |
| `⌘⌥1` … `⌘⌥9` | Go to agent 1–9, in the order of the Agents list |
| `⌘[` / `⌘]` | Previous / next agent |

All of them live in the `layout:herdsidian` section, so they never change
your keys in other layouts.

## Install

Ask your agent, from a Herdr terminal:

> Add the Herdr layout at <this repo's URL> following ~/.config/herdr-app/AGENTS.md.

Or by hand:

1. Copy `layouts/herdsidian.json`, the four files in `themes/` and the four
   folders in `mods/` into `~/.config/herdr-app/` (same paths).
2. Merge `keys.json` into `~/.config/herdr-app/keys.json`: add its
   `layout:herdsidian` and `mod:herdsidian` sections. The keys only apply while
   the Herdsidian layout is shown, except `⌘S`/`⌘E`, which only apply while
   the Notes panel has the keyboard.
3. Check the mods:
   ```sh
   cd ~/.config/herdr-app/mods
   for m in herdsidian herdsidian-chrome guide-spaces guide-agents; do herdr-app check $m; done
   ```
4. Switch to it: `herdr-app do layout.switch '{"name":"herdsidian"}'`
   (or Settings → Look, or `⌘⇧L`).
5. Press `⌘⇧O`, then **Choose a vault**.

### Only the Notes sidebar, in your own layout

Copy `mods/herdsidian/` and add this block as the last child of your layout's root
row (Herdr's own layouts are read-only: clone one first with
`herdr-app do layout.clone '{"name":"main","as":"my-layout"}'`):

```json
{ "id": "herdsidian", "type": "block", "hidden": true, "size": { "px": 380 },
  "min": 44, "max": 720, "content": { "mod": "herdsidian" } }
```

Then bind a key to it in `keys.json`, for example
`"layout:my-layout": { "cmd-shift-o": "layout.toggle:herdsidian" }`, plus the
`mod:herdsidian` section.

## What it touches

- `herdsidian` reads and writes only inside the vault you choose. It runs `sh`
  and `find` to list notes, and `open` (macOS) or `xdg-open` (Linux) for
  web links.
- `guide-spaces` and `guide-agents` are Herdr's own `spaces` and `agents`
  with key caps added: like the originals, `guide-spaces` runs `git` and
  `hc machine ls` and watches your spaces' repo folders.
- `herdsidian-chrome` is Herdr's `workspace-chrome` (sidebar header and
  footer) with the name "Herdsidian" in the theme's accent color.
- None of them reaches the network.

## Limits

- No backlinks, tags, graph or image embeds (`![[image.png]]` shows its file
  name). Rename, delete and new folders are left to Obsidian.
- The note list and search cover up to 5,000 notes.
- Built and tested on macOS; the keys use `⌘`. Linux should work but is
  untested; Windows is not supported (folders are listed with `sh`).

See [RECIPE.md](RECIPE.md) for exactly what it does and how it is built.

## Development

The mod's pure logic (Markdown rendering, wikilink resolution, ignored
folders) lives in `mods/herdsidian/notes.js`, with no Herdr imports, so it
runs under Node:

```sh
npm test       # node --test, no dependencies
npm run lint   # JS syntax, JSON, theme format, mod references, no home paths
```

Changes to the mods themselves are checked in Herdr with `herdr-app check`.

## License

[MIT](LICENSE)
