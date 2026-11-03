<p align="center">
  <img src="docs/hero.jpg" width="760" alt="Herdsidian banner: the title over a violet and blue aurora, the tagline &quot;Your vault is your agents' memory. Now it sits right next to them.&quot;, and the Herdr window with a Claude Code agent and the Notes sidebar" />
</p>

<p align="center"><i>‹ your vault, next to your agents ›</i></p>

<p align="center">
  <a href="https://herdr.dev"><img src="https://img.shields.io/badge/Herdr-layout-7aa2f7" alt="Herdr layout" /></a>
  <img src="https://img.shields.io/badge/Obsidian-vault-7C3AED?logo=obsidian&logoColor=white" alt="Obsidian vault" />
  <img src="https://img.shields.io/badge/Claude%20Code-ready-D97757?logo=claude&logoColor=white" alt="Claude Code ready" />
  <img src="https://img.shields.io/badge/macOS-tested-000000?logo=apple&logoColor=white" alt="Tested on macOS" />
  <img src="https://img.shields.io/badge/tests-node%20--test-5FA04E?logo=nodedotjs&logoColor=white" alt="Tests with node --test" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-78a9ff" alt="MIT license" /></a>
</p>

<p align="center">
  <img src="docs/demo.gif" width="760" alt="Herdsidian demo: the Notes sidebar, the local graph, linking a note to the agent's space, Send to agent pasting @paths into Claude Code, and the themes" />
</p>

<p align="center"><sub>20-second cut, demo data. <a href="docs/film.mp4">Full film (MP4, 43 s)</a></sub></p>

---

**Your Obsidian vault is your agents' memory. Herdsidian puts it next to them.**

A [Herdr](https://herdr.dev) layout for people who run their coding agents from an
Obsidian vault: agent briefs, standards, project notes and daily logs in Markdown, read by
the agents and written back by them. Herdsidian opens that vault in a **Notes** sidebar
beside your terminals. You read and edit notes while the agents work, link the right notes
to each space, and hand them to an agent with one click.

![Herdsidian: a Claude Code agent at work, with the vault, the local graph and the notes linked to its space in the Notes sidebar](preview.png)

---

## Who it's for

- Your agent setup lives in a vault: `CLAUDE.md`-style briefs, agent definitions,
  standards, one note per project, a daily log the agents append to.
- You take notes all day, while the agents work, and want them one key away, not one
  app away.
- You want the agent to start from the right notes, and the notes to keep up with what the
  agents learn.

---

## The loop

```mermaid
flowchart LR
  A[Open the project note] --> B["⌘L: link it to the agent's space"]
  B --> C[Graph shows its neighbors: standards, traps, agents]
  C --> D["Send to agent: @paths in its prompt"]
  D --> E[The agent works and writes back to the vault]
  E --> F[Notes reload; a save never overwrites the agent's edit]
  F --> A
```

1. **Open the note.** Browse the vault or find a note by name. `[[Wikilinks]]` (with
   `|alias` and `#heading`) open the linked note.
2. **Link it to the space.** `⌘L` links the open note to the focused agent's space.
   Linked notes stay in a strip, per space, across restarts. A note's pin switches it
   between "Whole space" and "This agent only".
3. **See what it touches.** The local graph shows the note's neighbors at 1 or 2 hops:
   the standards it cites, the traps it warns about, the agents that use it.
4. **Send it.** **Send to agent** pastes the linked paths into the agent's prompt:
   `@path` for Claude Code, the plain path for other agents. It never presses Enter.
5. **Let it write back.** When an agent (or Obsidian, or git) changes a note you have
   open, your save asks first: Reload or Overwrite.

![Send to agent: the space's linked notes land in Claude Code's prompt as @paths, waiting for Enter](docs/send.png)

**Link notes to a folder once, in the note itself.** A `herdsidian:` key in the
frontmatter links the note whenever an agent works in that folder or below it:

```yaml
---
herdsidian: ~/code/acme-api
---
# Acme API
```

---

## Features

- **Notes sidebar.** Folders, notes and search on the right. Read mode renders
  frontmatter, headings and links; `⌘E` switches to Edit and `⌘S` saves. A button copies the
  note's full path. Collapses to an icon rail. Any folder of Markdown files works; Obsidian is not needed.
- **Agent context.** Notes linked per space, with extras for one agent. Suggestions (the
  space's repo name, recent notes, alias or tag matches) show faded; one click pins them.
- **Local graph.** The open note (or the first linked note) at 1 or 2 hops, up to 40
  nodes. Drag to pan, scroll to zoom, click to open. Hide it if you don't need it.
- **⌘K palette.** One search for notes, agents and commands, in a popup at the top.
  Tabs: All, Notes, Agents, Commands, Settings. `↵` opens a note, focuses an agent or runs a
  command. `⌘↵` pastes the selected note's path into the agent you were working with.
  It never presses Enter. `⇥` previews the note.
- **Shortcut guide.** Each space shows `⌃1…⌃9` and each agent `⌘⌥1…⌘⌥9`, so you
  jump between agents without the mouse.
- **Graphite glass look.** Tinted glass over a gradient of the theme, terminals as solid
  cards. Eight themes, every color derived from the theme:
  `hs_carbon` (default), `hs_midnight` (Tokyo Night), `hs_catppuccin` (Mocha),
  `hs_nord`, and a light version of each.

![The eight themes](docs/themes.png)

---

## Install

Ask your agent, from a Herdr terminal:

> Read ~/.config/herdr-app/AGENTS.md, then add this layout: herdr.dev/layouts/anderssonq/herdsidian

Or clone it and ask the agent to add it from the clone:

```sh
git clone https://github.com/anderssonq/herdsidian.git herdsidian
```

> Read ~/.config/herdr-app/AGENTS.md, then add the Herdr layout in ./herdsidian.

Then press `⌘⇧O` and **Choose a vault**.

<details>
<summary>By hand</summary>

1. Copy `layouts/herdsidian.json` and `layouts/herdsidian.svg` (its picture in
   Settings → Look), the eight files in `themes/` and the seven folders in
   `mods/` into `~/.config/herdr-app/` (same paths). If you installed an earlier
   version, remove the old `themes/herdsidian_*.json` files.
2. Merge the `layout:herdsidian` and `mod:herdsidian` sections of `keys.json` into
   `~/.config/herdr-app/keys.json`.
3. Check the mods:
   ```sh
   cd ~/.config/herdr-app/mods
   for m in herdsidian herdsidian-chrome guide-spaces guide-agents herdsidian-tabs herdsidian-pane herdsidian-status; do herdr-app check $m; done
   ```
4. Switch to it: `herdr-app do layout.switch '{"name":"herdsidian"}'`, or Settings →
   Look, or Herdr's default `⌃⇧L`, which cycles layouts.

</details>

<details>
<summary>Only the Notes sidebar, in your own layout</summary>

Copy `mods/herdsidian/` and add this block as the last child of your layout's root row.
Herdr's own layouts are read-only, so clone one first:
`herdr-app do layout.clone '{"name":"main","as":"my-layout"}'`.

```json
{ "id": "herdsidian", "type": "block", "hidden": true, "size": { "px": 380 },
  "min": 44, "max": 720, "content": { "mod": "herdsidian" } }
```

Then bind a key in `keys.json`, for example
`"layout:my-layout": { "cmd-shift-o": "layout.toggle:herdsidian" }`, and add the
`mod:herdsidian` section.

</details>

---

## Keys

| Keys | What it does |
|---|---|
| `⌘⇧O` | Show or hide the Notes sidebar |
| `⌘⇧E` / `⌘⇧G` | Show or hide the Files / Changes panel |
| `⌘L` | Link the open note to the focused agent's space (no note open: open the picker) |
| `⌘K` | Open the Herdsidian palette (the toolbar's Search box does the same) |
| `↵` | In the palette: open the note, focus the agent or run the command |
| `⌘↵` | In the palette: paste the selected note's path into the agent that was focused when you pressed `⌘K` (no Enter) |
| `⇥` | In the palette: preview the selected note |
| `↑` / `↓` | In the palette: move the selection |
| `Esc` | Close the palette |
| `⌘E` / `⌘S` | In a note: switch Read and Edit / save |
| `⌘/` | Herdr's list of every shortcut (`app.help`) |
| `⌃1` … `⌃9` | Go to space 1–9 |
| `⌘⌥[` / `⌘⌥]` | Previous / next space |
| `⌘⌥1` … `⌘⌥9` | Go to agent 1–9 |
| `⌘[` / `⌘]` | Previous / next agent |

`⌘E` and `⌘S` live in the `mod:herdsidian` section and work only while the Notes panel
has the keyboard. The rest live in `layout:herdsidian`, so your keys in other layouts
don't change.

---

## The ⌘K palette

`⌘K` (or the toolbar's Search box) opens a popup at the top of the window, 680 px wide,
in the theme's opaque `popover` color. `⌘K` again closes it.

- **Tabs.** All, Notes, Agents, Commands. With text typed, All shows the best match as the
  Top hit (a note shows its folder, "linked to <space>" and when it was edited), then up
  to 4 agents, 6 notes and 4 commands. A single tab shows up to 50.
- **Settings.** The Settings tab changes Herdsidian's look in place (the palette stays
  open). General: **Key hints** On / Off shows or hides the keys beside tabs, toolbar
  buttons, Search and the sidebar rows. Layout: **Notes panel** Shown / Hidden and, while
  shown, **Notes width** Expanded / Rail. The values live in one store,
  `herdsidian.settings`, that every mod reads.
- **Search.** A note matches when its name contains the text; an exact name, then a
  prefix, then a word start rank first, and notes linked to the space win ties. Agents
  match on program, space, tab or title. Commands match on their label.
- **Empty search.** The agents, the space's linked notes and the commands.
- **Keys.** `↵` opens the note (Notes is shown if hidden, and expanded if it was a rail),
  focuses the agent or runs the command. A note of another vault is not opened: a toast
  says "Note is in another vault: <name>". `⌘↵` sends the note's path to the target agent: the agent that had focus when
  you pressed `⌘K`. Moving over another agent does not change it. `⌘↵` pastes only after
  the focus has reached the agent's terminal and never presses Enter. Otherwise it only
  copies and says "Copied. Press ⌘V in the agent." `⇥` shows the first 2 KB of the note.
  `↑` `↓` move, `Esc` closes. A key that does nothing for the selected row is faded in
  the footer, with its reason as a tooltip.
- **`⌥⌘N` hints.** An agent row shows its key only when it is the Nth agent of the agents
  list and that key is bound. Otherwise there is no hint.
- **Commands.** "Link note to current agent…" (`⌘L`), "New <agent> in <space>" (no key),
  "Show Notes" / "Hide Notes" (`⇧⌘O`), "Choose vault…" (only with no vault) and
  "All Herdr commands… `⇧⌘P`".
- **Link mode.** "Link note to current agent…" turns the palette into a note finder for
  the space. `↵` links the note, as `⌘L` does, and closes.
- **No vault.** Agents and commands still work. The palette says "Open Notes once (⌘⇧O)
  to choose a vault".
- **Missing vault.** If the vault folder is gone or cannot be listed, the Notes section
  shows the error instead of an empty list.

---

## What it isn't

- **Not an Obsidian replacement.** No tags view, no whole-vault graph, no image embeds
  (`![[image.png]]` shows its file name). Rename, delete and new folders stay in Obsidian.
- **Not a sync tool.** It reads and writes the files in place. Obsidian, git and your
  agents see the same files.
- **Not online.** Nothing reaches the network.

---

## What it runs and stores

- `herdsidian` reads and writes only inside the vault you choose. It runs `find` and `sh`
  to list notes, `awk` to read their links, `git` to find an agent's repo folder, and
  `open` (macOS) or `xdg-open` (Linux) for web links.
- Context links live in `${XDG_STATE_HOME:-~/.local/state}/herdsidian/context.json`:
  machine-local, never in the vault. A file written by a newer Herdsidian is shown and
  never overwritten.
- **Send to agent** puts the paths on the clipboard and pastes them only after the focus
  has reached the agent's terminal ("Pasted into <agent>. Review and press Enter.");
  otherwise it only copies and says "Copied. Press ⌘V in the agent." It never presses
  Enter. At most 600 characters, the center note first;
  "+N not sent" counts the rest. The button shows "Sending…" while a send runs. It is off
  for remote spaces.
- **The palette** is a second copy of the `herdsidian` mod that Herdr opens as a popup. It
  lists notes with one `find` per open (up to 5,000) and reads the context file. It does
  not build the link index. `⌘↵` uses the same paste as **Send to agent**, with one path.
  The clipboard keeps that path. The two copies talk through these shared keys, each
  written only when its value changes: `herdsidian.vault`, `herdsidian.auto` (notes with a
  `herdsidian:` key, at most 200), `herdsidian.memory` (the remembered agent per space),
  `herdsidian.request` (open a note, choose a vault), `herdsidian.context-rev` (the
  palette changed the context file) and `guide-agents.order` (the first 9 agent
  addresses, for the `⌥⌘N` hints).
- `guide-spaces`, `guide-agents`, `herdsidian-chrome`, `herdsidian-tabs`, `herdsidian-pane`
  and `herdsidian-status` are restyled copies of Herdr's `spaces`, `agents`,
  `workspace-chrome`, `tabs`, `pane` and `workspace-status` (0.1.10), with the same
  behavior. `guide-spaces` runs `git` and `hc machine ls` like the original.

---

## Known gaps

- The context file is not reloaded live: a change from another Herdr window shows after
  you relink or reopen.
- The note list and search cover up to 5,000 notes.
- The palette finds your vault only after Notes was shown once (`⌘⇧O`) since the install.
- Built and tested on macOS (the keys use `⌘`). Linux should work but is untested.
  Windows is not supported.

[RECIPE.md](RECIPE.md) describes exactly what it does and how it is built.

<details>
<summary>Development</summary>

`tests/mods-ui.test.js` also renders the real toolbar and Notes mods, with the Herdr runtimes
stubbed in `tests/support/mod-stubs.js`. The pure logic runs under Node with no Herdr imports: `mods/herdsidian/notes.js`
(Markdown, wikilinks; wikilinks inside code are ignored), `graph.js` (link index, neighborhood, layout) and `context.js`
(context links, suggestions, Send text). The palette adds `palette.js` (ranking, key
hints, lists) and `send.js` (the paste sequence), also pure. `io.js`, `graph-view.js`,
`palette-main.js` and `palette-view.js` need Herdr.

```sh
npm test            # node --test, no dependencies
npm run lint        # syntax, JSON, themes, mod references, `mod.open:` targets, shared-file copies, pure files import no Herdr, no hard-coded colors or home paths
scripts/demo.sh     # a separate Herdr window with a demo vault and demo agents (stop: scripts/demo.sh stop)
```

The demo runs with its own HOME, Herdr home, state folder and herdr-core session, and it
checks that the core it talks to is its own before it starts any agent, so your spaces,
settings and vault stay out of it. The README images come from it.

Three files in `lib/` are canonical: `tokens.js` (theme colors with alpha), `ui.js` (top
sheen, program icons, status dot) and `layout.js` (the `find` tree helper and the sidebar
rail helpers `narrow` and `toggleSidebar`; it imports Herdr). A mod folder installs on
its own, so each mod that uses one carries a byte-identical copy. After editing one, copy
it into every mod that has it; `npm run lint` fails if a copy differs.

```sh
cp lib/tokens.js mods/<mod>/tokens.js
cp lib/ui.js mods/<mod>/ui.js          # herdsidian, herdsidian-chrome, herdsidian-tabs, herdsidian-pane, guide-agents
cp lib/layout.js mods/<mod>/layout.js  # herdsidian, herdsidian-chrome, herdsidian-tabs, guide-agents, guide-spaces
cp lib/keys.js mods/<mod>/keys.js      # herdsidian, herdsidian-tabs, guide-agents, guide-spaces
cp lib/settings.js mods/<mod>/settings.js  # herdsidian, herdsidian-tabs, guide-agents, guide-spaces
```

Check mod changes in Herdr with `herdr-app check`. The "Needs you" chip (`foreground` on
`blockedSoft`, 1 px `blocked` border) passes 4.5:1 contrast in all eight themes.

</details>

---

## License

[MIT](LICENSE)
