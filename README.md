# Herdsidian

Your Obsidian vault inside the [Herdr](https://herdr.dev) desktop app: a
**Notes** sidebar to browse, read and edit your Markdown notes next to your
terminals and agents. It comes as the **Herdsidian** layout: tinted glass over
a gradient of the active theme (near-black with the default **Herdsidian
Carbon** theme), and a sidebar that shows the shortcut to every space and agent.

<!-- preview.png: pending (take it with a demo vault and demo spaces) -->

## What you get

- **Eight color themes** (four dark, four light), picked in Settings → Look:
  - `hs_carbon` (default): neutral blacks and greys, one blue accent
    (`#4c9df3`), in the style of the Cursor IDE.
  - `hs_midnight`: Tokyo Night colors.
  - `hs_catppuccin`: Catppuccin Mocha colors, mauve accent.
  - `hs_nord`: Nord colors, frost cyan accent.
  - `hs_carbon_light`: neutral whites and greys, blue accent (`#005fb8`), in
    the style of VS Code Light Modern.
  - `hs_midnight_light`: Tokyo Night Day colors.
  - `hs_catppuccin_light`: Catppuccin Latte colors, mauve accent.
  - `hs_nord_light`: Nord Snow Storm background, frost blue accent.
  The glass follows the theme: every color of the layout comes from it.
- **Glass look**: a gradient of the theme's colors shows through the sidebar,
  the toolbar, the status bar and the Notes sidebar. Terminals are solid cards
  on top of it. The glass is transparency only (Herdr has no blur).
- **Restyled toolbar, pane headers and status bar**: tabs as a segmented
  control, a Search box, and the theme name in the status bar. Program icons
  show in agent rows (on a small tile with the status dot as a badge), in tabs
  and in the pane header.
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
- **Graph** (bottom of the Notes panel): the local graph of the open note (or
  of the first context note) at 1 or 2 hops, up to 40 nodes, with "+N more"
  for the rest. Drag to pan, scroll to zoom, click a node to open the note.
  Hop-2 labels show on hover or at zoom 1.5 or more. Labels are placed by
  priority, hidden when they would overlap, and cut at 90 px with an
  ellipsis. You can hide it. The hidden state and the hop count are
  remembered.
- **Agent context**: link notes to a space, with extras for one agent.
  - Link with `⌘L` (the open note, or the picker when no note is open), with
    "Add current note", or with the picker. With no note open, `⌘L` opens the
    picker without moving the keyboard focus; a click focuses it.
    Suggestions show faded: one click pins them.
  - A context file from a newer Herdsidian is shown in the strip and never
    overwritten.
  - The optional frontmatter key `herdsidian: <path or list>` links a note
    automatically when an agent works in that folder.
  - **Send to agent** pastes the paths into the agent's prompt, only after
    the focus has reached the agent's terminal; otherwise it only copies. It
    never presses Enter. Claude Code gets `@path`, other agents get the plain path,
    and a path with spaces goes in double quotes. It sends at most 600
    characters, the center note first; "+N not sent" counts the rest. The
    paths stay on the clipboard. If pasting fails it only copies and says
    "press ⌘V". It is off for remote spaces.
- **Shortcut guide** (`guide-spaces` and `guide-agents` mods): each space shows
  `⌃1…⌃9` and each agent `⌘⌥1…⌘⌥9`, and the list headers summarise the keys.

## Keys

| Keys | What it does |
|---|---|
| `⌘⇧O` | Show or hide the Notes sidebar |
| `⌘K` | Open the search picker |
| `⌘E` | In a note: switch between Read and Edit |
| `⌘S` | In a note: save |
| `⌘L` | Link the open note to the focused agent's space (Notes must be shown) |
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

1. Copy `layouts/herdsidian.json`, the eight files in `themes/` and the seven
   folders in `mods/` into `~/.config/herdr-app/` (same paths). Themes were
   renamed from `herdsidian_*` to `hs_*`: remove the old
   `themes/herdsidian_*.json` files if you installed an earlier version.
2. Merge `keys.json` into `~/.config/herdr-app/keys.json`: add its
   `layout:herdsidian` and `mod:herdsidian` sections. The keys only apply while
   the Herdsidian layout is shown, except `⌘S`/`⌘E`, which only apply while
   the Notes panel has the keyboard.
3. Check the mods:
   ```sh
   cd ~/.config/herdr-app/mods
   for m in herdsidian herdsidian-chrome guide-spaces guide-agents herdsidian-tabs herdsidian-pane herdsidian-status; do herdr-app check $m; done
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
  and `find` to list notes, `awk` to read their links, `git` to find an
  agent's repo folder, and `open` (macOS) or `xdg-open` (Linux) for web
  links.
- It also writes `${XDG_STATE_HOME:-~/.local/state}/herdsidian/context.json`
  (the context links; machine-local, not in the vault). Send to agent puts
  paths on the clipboard and pastes them into the agent's terminal.
- `guide-spaces` and `guide-agents` are Herdr's own `spaces` and `agents`
  with shortcut hints added: like the originals, `guide-spaces` runs `git` and
  `hc machine ls` and watches your spaces' repo folders.
- `herdsidian-chrome` is Herdr's `workspace-chrome` (sidebar header and
  footer), restyled as glass with a neutral top sheen.
- `herdsidian-tabs`, `herdsidian-pane` and `herdsidian-status` are restyled
  copies of Herdr's `tabs`, `pane` and `workspace-status` (version 0.1.10),
  with the same behavior. `herdsidian-status` reads Herdr's settings only, to
  show the theme name.
- None of them reaches the network.

## Limits

- No tags, no whole-vault graph and no image embeds (`![[image.png]]` shows
  its file name). Rename, delete and new folders are left to Obsidian.
- The context file is not reloaded live: a change from another Herdr window
  shows after you relink or reopen.
- The note list and search cover up to 5,000 notes.
- Built and tested on macOS; the keys use `⌘`. Linux should work but is
  untested; Windows is not supported (folders are listed with `sh`).

See [RECIPE.md](RECIPE.md) for exactly what it does and how it is built.

## Development

The mod's pure logic lives in `mods/herdsidian/notes.js` (Markdown rendering,
wikilink resolution, ignored folders), `graph.js` (link index, neighborhood,
layout, zoom) and `context.js` (context links, suggestions, Send text), with
no Herdr imports, so it runs under Node. `io.js` and `graph-view.js` need
Herdr. Tests: `tests/notes.test.js`, `graph.test.js`, `context.test.js`.
Building the index of 5,000 notes takes about 70 ms in the tests.

```sh
npm test       # node --test, no dependencies
npm run lint   # JS syntax, JSON, theme format, mod references, shared-file copies, no hard-coded colors (3-, 4-, 6-, 8-digit hex or alpha glued to a string), no home paths
```

Theme colors with alpha come from `lib/tokens.js`. Three files in `lib/` are
canonical: `tokens.js`, `ui.js` (the shared top sheen, 180° over the full
block, and the program `icon` helper) and `layout.js` (the `find` tree helper). Each mod that uses one carries
a byte-identical copy as `mods/<mod>/<name>.js`, because a mod folder is
installed on its own. After you edit one, copy it into every mod that has it:

```sh
cp lib/tokens.js mods/<mod>/tokens.js
cp lib/ui.js mods/<mod>/ui.js          # herdsidian-chrome, herdsidian-tabs, herdsidian-pane, guide-agents
cp lib/layout.js mods/<mod>/layout.js  # herdsidian, herdsidian-chrome, herdsidian-tabs, guide-agents, guide-spaces
```

`npm run lint` fails if a copy differs.

The "Needs you" chip (pane header and agents list) uses `foreground` text on
`blockedSoft` with a 1 px `blocked` border, so it passes contrast (4.5:1) in
seven of the eight themes. In `hs_midnight_light` it is 3.34:1, because Tokyo
Night Day's own text color is only 4.5:1 on its background.

Changes to the mods themselves are checked in Herdr with `herdr-app check`.

## License

[MIT](LICENSE)
