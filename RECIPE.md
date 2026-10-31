# Herdsidian

Herdsidian puts an Obsidian vault inside Herdr, in its own layout: the
Graphite Glass look. Sidebars and bars are tinted glass over a gradient of the
active theme, and panes are solid cards. Every color comes from the theme, so
each of the four themes has its own tint. On the left, the spaces and agents
lists show the shortcut to each row. On the right, a Notes sidebar browses,
renders and edits the Markdown notes of an Obsidian vault.

<!-- ![Herdsidian](preview.png) pending -->

## What you see

Left to right:

Root row: `titlebar: "none"`, macOS `traffic_lights` at [16, 19],
`terminal_padding` [14, 12].

1. **Sidebar**, 248 px (min 44, max 480, not resizable): a 52 px `brand`
   block (`herdsidian-chrome`, `window_drag`), `guide-spaces` and
   `guide-agents` stacked with equal weight (min 90 each), and an 80 px
   `sidebar-footer` block (`herdsidian-chrome` with `props: { footer: true }`).
   `herdsidian-chrome` is a clone of Herdr's `workspace-chrome`. The header has
   no brand: only the hide-sidebar button (28 px), right-aligned over a
   neutral top sheen. On macOS the header leaves 84 px on the left for the traffic
   lights. The footer has two 32 px rows, Settings and Add machine.
   - Spaces header: 24 px high, `Spaces` (11 px semibold `muted`) + the hint
     `⌃ 1–9 · ⌘⌥[ ⌘⌥]`, then a 22 px `+` button. Each of the first 9 rows
     ends with a plain `⌃N` in 11 px `muted` text.
   - Agents header: `Agents` + `⌘⌥ 1–9 · ⌘[ ⌘]`. Each of the first 9 agent
     rows shows `⌘⌥N` in 11 px `muted` text, under the status pill or the
     duration.
   - Rows: spaces 32 px (28 px for a worktree), radius 8. Agent rows have 7 px
     of vertical padding, radius 8 and a status line (11.5 px `muted`). The
     selected row is an `accent` pill at 18 %. Hover is `foreground` at 6 %.
     Space avatars 20 px, radius 6, with the letter in black at 75 %
     (`#000000bf`).
   - Agent icon tile: 20 px, radius 6, `foreground` at 6 % (10 % on the
     focused row), with the 13 px program icon centered (tinted SVGs in
     `foreground`, pictures as is). No icon: the first letter of the program
     name (11 px semibold `muted`). The status is an 8 px `statusDot` badge at
     the tile's bottom-right corner (a 12 px badge at right/bottom -4, so the dot's edge sits at -2) inside a 2 px ring of
     `chrome`; working pulses, idle is a ring. Sub-agent rows and the wide
     rail (60 px or more) use a 16 px tile with an 11 px icon and no badge
     (their status shows at the right).
   - No border between the lists or above the footer.
2. **Work column**:
   - `herdsidian-tabs` toolbar (52 px, `window_drag`, `canvas` at 35 %): a
     rounded track holding the tabs as a segmented control (28 px tabs, radius
     7, the active one `raised` with a 1 px top highlight), a new-tab button,
     Files and Changes buttons, a 220 px Search box with `⌘K`, the Notes
     toggle and the window buttons. Buttons are 30 px, radius 8. A 14 px
     program icon leads each tab name (`foreground` on the selected tab,
     `muted` otherwise for tinted SVGs; pictures as is). The top sheen fills the whole
     toolbar (180°, `foreground` 5 % at the top to transparent at the bottom
     edge). The tab track shrinks and scrolls when there are many tabs.
   - The active tab's panes as solid cards (radius 12, gap 8, padding 8,
     `lone: true`, background `background`, 1 px hairline border, 1 px
     `accent` border on focus). No shadow.
   - Pane header `herdsidian-pane`: 34 px, always shown. It has the agent
     name or terminal title (`foreground`, medium) after a 14 px program icon
     (`muted`), the folder (`muted`), a
     6 px status dot for working and done, a "Needs you" chip for blocked
     (`foreground` text on `blockedSoft` with a 1 px `blocked` border; the
     compact "!" chip in the agents list is the same),
     and split, zoom and close buttons on hover.
   - The hidden Files/Changes panel (368 px, min 280, max 900).
   - `herdsidian-status` bar (28 px, `canvas` at 35 %): machine, branch, the
     agent count or "N working" (and "· N needs you"), and the name of the
     active theme on the right. `⌘⇧P` still opens commands.
3. **Notes**, 380 px (min 44, max 720), hidden until `⌘⇧O`. Same glass as the
   sidebar.
   - Header 52 px: vault folder name (semibold), a `⌘⇧O` key cap, then 28 px
     icon buttons: search, new note, choose vault, collapse (`panel-right`).
   - No vault yet: the title is "Notes", the search button is hidden, and the
     body reads "Pick the folder of your Obsidian vault (or any folder of
     Markdown notes)." above a `solid` "Choose a vault" button (`pickFolder`).
   - Search box (when open): 30 px, radius 8, no border, `foreground` at 6 % fill.
   - Tree rows 28 px, radius 7, 16 px indent per level: chevron + a 16 px
     folder icon (`accent`, filled body), or a file icon and the note's name
     without `.md`. The selected note is an `accent` pill at 18 %, with an
     `accent` file icon.
   - Note view: back arrow, note name and its path (10.5 px `muted`); a bar
     with `Read` / `Edit` pills (22 px, radius 5), `⌘E` cap, a 7 px `working`
     dot when there are unsaved changes, `Save` and `⌘S` cap.
   - Rail (width under 160 px): expand, search and new-note icons in a column.

Look (layout root):
- Theme `herdsidian_carbon` (default): background `#181818`, foreground
  `#d6d6dd`, selection `#2f3a4a`, accent `#4c9df3`, canvas `#0e0e0e`, chrome
  `#121212`, border `#2a2a2a`, ANSI red `#f14c4c`, green `#3fbf8f`, yellow
  `#e5b95c`, blue `#4c9df3`.
- Root `background`: `{ "gradient": ["chrome", "canvas"], "angle": 160 }`.
  The gradient uses theme color names, so it follows the theme: carbon is
  charcoal to black, nord is blue-grey, catppuccin is violet-black.
- The layout has no `colors` block. The glass is painted by the mods:
  sidebars and Notes use `chrome` at 55 %, the toolbar and status bar use
  `canvas` at 35 %.
- `terminal_opacity` 1. The pane background is the theme's `background`, so
  terminals read as solid cards on the glass.
- Pane border and root divider: `#ffffff12`. Pane focus: `accent`.
- `ui_font`: `.AppleSystemUIFont` (the macOS system font).

## How it behaves

- Agent statuses are Herdr's own (`guide-agents` is a clone of `agents`):
  working spinner, blocked "Needs you", done dot, idle ring (1.5 px, in the
  theme's `idle`).
- `⌘⌥N` focuses the N-th agent of the list as shown (pinned first, then the
  sort order). Numbers follow the whole list, so folding a group hides rows
  but keeps the numbering.
- `⌘K` opens the picker (the same as the toolbar's Search box).
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
  foreground `#c0caf5`, accent `#7aa2f7`),
  `themes/herdsidian_catppuccin.json` (Catppuccin Mocha: background `#1e1e2e`,
  foreground `#cdd6f4`, accent `#cba6f7`) and `themes/herdsidian_nord.json`
  (Nord: background `#2e3440`, foreground `#d8dee9`, accent `#88c0d0`) as
  alternatives in Settings → Look, the seven mods, `lib/tokens.js`, and
  `keys.json` to merge into the person's.
- Themes: Nord's `chrome`, `muted` and `blocked` were adjusted so text and
  dots pass contrast on the glass. `idle` is lighter in all four themes so
  the idle ring reads on the selected row. The ANSI colors are untouched.
- Layout: a clone of Herdr's `main` with the root look above, `spaces` →
  `guide-spaces`, `agents` → `guide-agents`, `tabs` → `herdsidian-tabs`, the
  pane header → `herdsidian-pane`, `workspace-status` → `herdsidian-status`,
  and a last root child
  `{ "id": "herdsidian", "type": "block", "hidden": true, "size": { "px": 380 },
  "min": 44, "max": 720, "content": { "mod": "herdsidian" } }`.
- The seven mods:

  | Mod | Role |
  |---|---|
  | `herdsidian` | The Notes sidebar. |
  | `herdsidian-chrome` | Sidebar header (hide button over the top sheen) and footer. Clone of `workspace-chrome`. |
  | `guide-spaces` | Spaces list with `⌃N` hints. Clone of `spaces`. |
  | `guide-agents` | Agents list with `⌘⌥N` hints. Clone of `agents`. |
  | `herdsidian-tabs` | The toolbar. Clone of `tabs`. |
  | `herdsidian-pane` | The pane header. Clone of `pane`. |
  | `herdsidian-status` | The status bar. Clone of `workspace-status`. |

- `guide-agents` stores the shown list in `this.order` and reads
  `nextCommand()` for `focus-N`.
- `herdsidian`: `main.js` (the View) and `notes.js` (pure helpers: `render`,
  `resolve`, `linkTarget`, `hidden`, `base`, `HIDDEN`, tested by `tests/notes.test.js`).
  From `herdr`: `exec` (`sh` to list a folder, `find` for every note,
  `open` for web links), `readTextFile`, `writeTextFile(path, text,
  expected)` for conflict-safe saves, `watchFolder`, `pickFolder`,
  `localStorage` (`vault`, `width`), `nextCommand`, `run("layout.resize")`,
  `layout()`. From `gpui-base`: `TextView.markdown(...).on_link_click`,
  `EditorState` + `Editor`, `InputState` + `Input`.
- `lib/tokens.js`: the one place where theme colors get their alpha.
  `alpha(color, a)` takes `#rrggbb` or `#rrggbbaa` and returns a full
  `#rrggbbaa` color. `tokens(theme())` returns these full colors:
  `glass` (`chrome` 55 %), `mainGlass` (`canvas` 35 %), `line` (`foreground`
  7 %), `pill` (`foreground` 6 %, also hover), `accentSoft` (`accent` 18 %),
  `glow` (`foreground` 5 %, the top sheen), `glowEnd` (`foreground` 0 %), `blockedSoft` (`blocked`
  15 %). Constants: `HIGHLIGHT` (`#ffffff0d`), `PULSE` and `GLOW_ANGLE`
  (180). `HAIRLINE`, `tokens().workingLine` and `tokens().highlight` were
  removed (nothing used them; mods import `HIGHLIGHT` directly).
  `statusDot(theme, status)` gives the dot recipe (fill or ring, pulse).
  Tests: `tests/tokens.test.js`.
- `lib/ui.js`: `icon(p, size, color)`, a program's icon (a tinted SVG in
  `color`, else the picture as is; null without one), used by `guide-agents`,
  `herdsidian-tabs` and `herdsidian-pane`. And `glow(k)`, the top sheen shared
  by `herdsidian-chrome` and `herdsidian-tabs`. It paints the full size of its block with
  `GLOW_ANGLE` from `k.glow` (top) to `k.glowEnd` (bottom edge, fully
  transparent). Both blocks are 52 px high, so the halves meet at the
  divider. It uses the global gpui `window`, not herdr's `window` import.
  It imports `gpui-kit`, so Node tests do not import it.
- `lib/layout.js`: `find(node, id)`, a pure tree search used by `herdsidian`,
  `herdsidian-chrome`, `herdsidian-tabs`, `guide-agents` and `guide-spaces`.
- Copy rule: `lib/tokens.js`, `lib/ui.js` and `lib/layout.js` are the
  canonical files. Each mod that uses one carries a byte-identical
  `mods/<mod>/<name>.js`, because a mod folder is installed on its own. After
  you edit a canonical file, copy it into every mod that has it
  (`cp lib/tokens.js mods/<mod>/tokens.js`; `ui.js` lives in
  `herdsidian-chrome`, `herdsidian-tabs`, `herdsidian-pane` and `guide-agents`). `npm run lint` fails if a copy
  differs.
- Icons: Herdr's `mods/workspace-chrome/*.svg` and `mods/files/*.svg`, plus
  the SVGs inside `herdsidian`, `herdsidian-tabs` and `herdsidian-pane`.
- Keys: `layout:herdsidian` (`cmd-shift-o` → `layout.toggle:herdsidian`,
  `cmd-k` → `mod.open:picker`, `cmd-alt-1..9` → `guide-agents.focus-N`,
  `ctrl-1..9` → `space.select:N`, `cmd-alt-[`/`]` → `space.prev`/`next`,
  `cmd-[`/`]` → `agent.prev`/`next`, so every shortcut the sidebar shows
  works) and `mod:herdsidian` (`cmd-s` → `herdsidian.save`, `cmd-e` →
  `herdsidian.mode`).

## Watch out

- `TextView` is exported by `gpui-base`, not `gpui-kit`.
- Theme files want `#rrggbb` (no alpha). Layout colors such as the pane
  border and the divider accept `#rrggbbaa`. The glass comes from the mods,
  which add alpha with `lib/tokens.js`.
- A theme name in the JSON cannot carry alpha. Use a name alone (`"accent"`,
  `"background"`, or in a gradient `["chrome", "canvas"]`) or a full hex.
  For a transparent theme color, add the alpha in the mod with `alpha()`.
- Gradient stops accept theme color names: the root `background` uses
  `["chrome", "canvas"]` at angle 160, and it follows the active theme.
- There is no blur API, so the glass is transparency only (a color with alpha
  over the gradient).
- `shadow` on the pane frame shows nothing, so the cards have no shadow.
- `bg()` takes a plain color, not a gradient. The top sheen is painted with
  `window.paint_path(..., Background.linear_gradient(...))`, in
  `herdsidian-chrome` (sidebar header) and `herdsidian-tabs` (toolbar), both
  through `glow()` in `lib/ui.js`. It runs at 180° over the full block and ends
  fully transparent at the bottom edge (at 160° a faint band was left there).
  Use the gpui global `window`, never herdr's `window` import.
- `ui_font` is `.AppleSystemUIFont`. It loads with no error. Its visual
  effect on the UI text is still to be confirmed.
- `dim` is never used as text color (it fails contrast on the glass). Text
  uses `muted` or `foreground`. `dim` is only a dot or an icon color.
- `herdsidian-tabs`, `herdsidian-pane` and `herdsidian-status` are frozen
  copies of Herdr's `tabs`, `pane` and `workspace-status` at version 0.1.10
  (`cloned_from` in each `mod.json`). Fixes in newer Herdr versions do not
  reach them: when Herdr updates, diff each clone with the shipped mod.
- Never hard-code a color in a mod. `npm run lint` rejects any hex literal
  (3, 4, 6 or 8 digits) in `mods/**/*.js`, and alpha glued to a string
  (`+ "26"`, `` `${c}2e` ``). The only exception is the six space avatar
  colors and the avatar letter (`#000000bf`), and only in
  `mods/guide-spaces/main.js`. The `tokens.js`, `ui.js` and `layout.js`
  copies must equal `lib/`, and mods named by the layout and keys must exist
  in `mods/` or ship with Herdr (`workspace-chrome`, `files`, `changes`).
- The sidebar toggle writes `sidebar.collapsed` as well as the width: Herdr's
  own `agents` and `workspace-chrome` mods still read that flag. Both
  `herdsidian-chrome` and `guide-agents` restore to 248 px.
- `watchFolder` reports `.obsidian/workspace.json` writes all the time:
  filter them, or the open note reloads and the editor loses its cursor.
- Never reopen the note after your own save; compare with the saved text.
- Callbacks run later (after Save/Discard) must take their own `cx`.
- `writeTextFile` rejects for any failure; re-read the file to tell a stale
  snapshot (conflict) from another error.
- `<mod>.<command>` keys reach shown copies only: `⌘S`/`⌘E` do nothing while
  Notes is hidden.
- Clicks in Settings → Look are saved in `layouts/.state/` and win over the
  layout file. If `terminal_opacity` or the pane look is not what the file
  says, check `herdr-app status` and re-save the layout file.

## Done when

- The four `themes/herdsidian_*.json` are in `~/.config/herdr-app/themes/`
  and show in Settings → Look.
- `herdr-app check` passes for all seven mods: `herdsidian`,
  `herdsidian-chrome`, `guide-spaces`, `guide-agents`, `herdsidian-tabs`,
  `herdsidian-pane` and `herdsidian-status`.
- `layout.switch herdsidian` shows the glass look, hints on spaces and
  agents, and no errors in `herdr-app status`.
- Each theme gives the glass its own tint (`app.theme` with each name).
- `⌘⇧O` shows Notes; a first run offers Choose a vault. `⌘K` opens the picker.
- A note opens in Read, a `[[wikilink]]` opens its target, `⌘E` edits,
  `⌘S` saves to disk.
- Editing the file from a shell while it has unsaved edits, then `⌘S`,
  shows the conflict banner and leaves the file untouched.
- Collapse makes a 44 px rail; expand brings back the previous width.
