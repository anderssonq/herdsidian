# Herdsidian

Herdsidian puts an Obsidian vault inside Herdr, in its own layout: a
near-black Herdr layout (theme Herdsidian Carbon) where terminals, sidebars and
bars are tinted glass over a charcoal gradient. On the left, the spaces and
agents lists show the shortcut to each row. On the right, a Notes sidebar
browses, renders and edits the Markdown notes of an Obsidian vault.

<!-- ![Herdsidian](preview.png) pending -->

## What you see

Left to right:

Root row: `titlebar: "none"`, macOS `traffic_lights` at [12, 16],
`terminal_padding` [14, 12].

1. **Sidebar**, 268 px (min 44, max 480, not resizable): a 46 px `brand`
   block (`herdsidian-chrome`, `window_drag`), `guide-spaces` and
   `guide-agents` stacked with equal weight (min 90 each), and a 69 px
   `sidebar-footer` block (`herdsidian-chrome` with `props: { footer: true }`).
   `herdsidian-chrome` is a clone of Herdr's `workspace-chrome` whose header
   reads "Herdsidian" (semibold, the theme's `accent`) next to Herdr's logo.
   - Spaces header: `Spaces` + `⌃ 1–9 · ⌘⌥[ ⌘⌥]` (10 px, `dim`). Each of the
     first 9 rows ends with a key cap `⌃N`.
   - Agents header: `Agents` + `⌘⌥ 1–9 · ⌘[ ⌘]`. Each of the first 9 agent
     rows shows a key cap `⌘⌥N` before its status.
   - Key cap: 16 px high, 4 px side padding, radius 4, 1 px `border`, 10 px
     `dim` text.
2. **Work column**: Herdr's `tabs` bar (42 px, `window_drag`), the active
   tab's panes as cards (radius 12, gap 2, padding 2, `lone: true`, pane
   header `pane` 30 px, always shown), the hidden
   Files/Changes panel, and the `workspace-status` bar (28 px).
3. **Notes**, 380 px (min 44, max 720), hidden until `⌘⇧O`.
   - Header 42 px: vault folder name (semibold), a `⌘⇧O` key cap, then 26 px
     icon buttons:
     search, new note, choose vault, collapse (`panel-right`).
   - No vault yet: the title is "Notes", the search button is hidden, and the
     body reads "Pick the folder of your Obsidian vault (or any folder of
     Markdown notes)." above a `solid` "Choose a vault" button (`pickFolder`).
   - Search box (when open): 30 px, radius 7, 1 px `border`, `background` fill.
   - Tree rows 28 px, radius 7, 16 px indent per level: chevron + folder
     icon, or a file icon and the note's name without `.md`.
   - Note view: back arrow, note name and its path (10.5 px `dim`); a bar
     with `Read` / `Edit` pills, `⌘E` cap, a 7 px `working` dot when there
     are unsaved changes, `Save` and `⌘S` cap.
   - Rail (width under 160 px): expand, search and new-note icons in a column.

Look (layout root):
- Theme `herdsidian_carbon`: background `#181818`, foreground `#d6d6dd`, selection
  `#2f3a4a`, accent `#4c9df3`, canvas `#0e0e0e`, chrome `#121212`,
  border `#2a2a2a`, ANSI red `#f14c4c`, green `#3fbf8f`, yellow `#e5b95c`,
  blue `#4c9df3`.
- Root `background`: gradient `#262626` → `#080808`, angle 160.
- Root `colors.chrome`: `#0e0e0e8c`, so every bar and sidebar that paints
  `chrome` is 55 % opaque.
- `terminal_opacity` 0.6. Pane background `#18181840`, border `#ffffff1a`,
  focus `#4c9df399`. Root divider `#ffffff14`.

## How it behaves

- Agent statuses are Herdr's own (`guide-agents` is a clone of `agents`):
  working spinner, blocked "Needs you", done dot, idle ring.
- `⌘⌥N` focuses the N-th agent of the list as shown (pinned first, then the
  sort order). Numbers follow the whole list, so folding a group hides rows
  but keeps the numbering.
- Notes:
  - Click a folder to fold or unfold it. Click a note to read it.
  - Search filters every note in the vault by name (up to 200 hits, with the
    folder beside each).
  - Read mode renders Markdown. Frontmatter shows as a `yaml` code block.
    `[[note]]`, `[[note|alias]]` and `[[note#heading]]` become links that
    open the note: same folder first, then a path ending in it, then any
    note with that name. `http(s)` and `mailto` links open with `open`
    (macOS) or `xdg-open`.
  - Edit mode: Markdown editor, soft wrap, no line numbers.
  - Save (`⌘S` or the button) writes only if the file still has the text it
    had when opened. If not: a red banner "Changed outside Herdr since you
    opened it." with Reload and Overwrite.
  - Leaving a note with unsaved changes (back, another note, a wikilink)
    asks Save / Discard / Cancel.
  - Changes on disk (Obsidian, git) refresh the tree; the open note takes
    the new text when it has no unsaved edits. Writes under `.obsidian`,
    `.git`, `.trash` and `node_modules` are ignored.
  - New note: `Untitled.md` (or `Untitled N.md`) at the vault root, opened
    in Edit.
  - Collapse: resizes the block to 44 px and remembers the width it had.

## Built from

- Files: `layouts/herdsidian.json`, `themes/herdsidian_carbon.json` (the layout's
  `"theme"`: copy it too, or the theme doesn't resolve),
  `themes/herdsidian_midnight.json` (Tokyo Night: background `#1a1b26`,
  foreground `#c0caf5`, accent `#7aa2f7`) and
  `themes/herdsidian_catppuccin.json` (Catppuccin Mocha: background `#1e1e2e`,
  foreground `#cdd6f4`, accent `#cba6f7`) and `themes/herdsidian_nord.json`
  (Nord: background `#2e3440`, foreground `#d8dee9`, accent `#88c0d0`) as
  alternatives in Settings → Look, the four mods, and
  `keys.json` to merge into the person's.
- Layout: a clone of Herdr's `main` with the root look above, `spaces` →
  `guide-spaces`, `agents` → `guide-agents`, and a last root child
  `{ "id": "herdsidian", "type": "block", "hidden": true, "size": { "px": 380 },
  "min": 44, "max": 720, "content": { "mod": "herdsidian" } }`.
- `guide-spaces`, `guide-agents`: clones of the shipped `spaces` and
  `agents` with a `keycap` helper; `guide-agents` stores the shown list in
  `this.order` and reads `nextCommand()` for `focus-N`.
- `herdsidian`: `main.js` (the View) and `notes.js` (pure helpers: `render`,
  `resolve`, `linkTarget`, `hidden`, `base`, `HIDDEN`, tested by `tests/notes.test.js`).
  From `herdr`: `exec` (`sh` to list a folder, `find` for every note,
  `open` for web links), `readTextFile`, `writeTextFile(path, text,
  expected)` for conflict-safe saves, `watchFolder`, `pickFolder`,
  `localStorage` (`vault`, `width`), `nextCommand`, `run("layout.resize")`,
  `layout()`. From `gpui-base`: `TextView.markdown(...).on_link_click`,
  `EditorState` + `Editor`, `InputState` + `Input`.
- Icons: Herdr's `mods/workspace-chrome/*.svg` and `mods/files/*.svg`.
- Keys: `layout:herdsidian` (`cmd-shift-o` → `layout.toggle:herdsidian`,
  `cmd-alt-1..9` → `guide-agents.focus-N`, `ctrl-1..9` → `space.select:N`,
  `cmd-alt-[`/`]` → `space.prev`/`next`, `cmd-[`/`]` → `agent.prev`/`next`,
  so every key cap the sidebar shows works) and `mod:herdsidian` (`cmd-s` →
  `herdsidian.save`, `cmd-e` → `herdsidian.mode`).

## Watch out

- `TextView` is exported by `gpui-base`, not `gpui-kit`.
- Layout `colors` accept `#rrggbbaa`; theme files want `#rrggbb`. The glass
  comes from the layout, not the theme.
- `watchFolder` reports `.obsidian/workspace.json` writes all the time:
  filter them, or the open note reloads and the editor loses its cursor.
- Never reopen the note after your own save; compare with the saved text.
- Callbacks run later (after Save/Discard) must take their own `cx`.
- `writeTextFile` rejects for any failure; re-read the file to tell a stale
  snapshot (conflict) from another error.
- `<mod>.<command>` keys reach shown copies only: `⌘S`/`⌘E` do nothing while
  Notes is hidden.

## Done when

- The four `themes/herdsidian_*.json` are in `~/.config/herdr-app/themes/`
  and show in Settings → Look.
- `herdr-app check` passes for `herdsidian`, `herdsidian-chrome`, `guide-spaces` and
  `guide-agents`.
- `layout.switch herdsidian` shows the glass look, key caps on spaces and
  agents, and no errors in `herdr-app status`.
- `⌘⇧O` shows Notes; a first run offers Choose a vault.
- A note opens in Read, a `[[wikilink]]` opens its target, `⌘E` edits,
  `⌘S` saves to disk.
- Editing the file from a shell while it has unsaved edits, then `⌘S`,
  shows the conflict banner and leaves the file untouched.
- Collapse makes a 44 px rail; expand brings back the previous width.
