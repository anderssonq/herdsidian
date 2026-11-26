// The centered empty state of the Changes and Git tabs (E2): one tile, a title, an optional folder and an optional hint,
// in the middle of the tab body. Both tabs call it, so the same state looks the same in each. Pure view: no command.
import { div, svg } from "gpui-kit";
import { v_flex } from "gpui-base";
import { RADIUS } from "./tokens.js";

const MONO = "Menlo";
const TILE = 40;

const ICON = "mods/herdsidian/git-branch.svg";
const TEXTS = {
  norepo: { title: "Not a git repository", hint: "Run git init in a terminal here to see changes and history." },
  nofolder: { title: "No folder", hint: "Focus a terminal pane that has a working folder." },
  unknown: { title: "Cannot read the git folder" },
};

// The block both tabs draw for a watch state, or null when the state has none (ready, loading, error).
// `dir`: the folder the watch checked, or null: the detail is left out then.
export function emptyFor(t, k, state, dir) {
  const text = TEXTS[state];
  return text ? emptyState(t, k, { icon: ICON, ...text, ...(state !== "nofolder" && dir ? { detail: dir } : {}) }) : null;
}

// -> Element. `t`: the theme, `k`: tokens(t). `icon`: an svg path, `title`: text; `detail` (a folder) and `hint` are drawn only when given.
export function emptyState(t, k, { icon, title, detail, hint }) {
  return v_flex().id("empty-state").flex_1().min_h(0).items_center().justify_center().gap(10).px(28).pb(24).text_center()
    .child(div().flex_none().size(TILE).rounded(RADIUS.card).bg(k.pill).border(1).border_color(t.border).flex().items_center().justify_center()
      .child(svg(icon).size(18).flex_none().text_color(t.muted)))
    .child(div().id("empty-state-title").text_size(13).font_weight(500).text_color(t.foreground).child(title))
    .when(Boolean(detail), (el) => el.child(div().id("empty-state-detail").min_w(0).font_family(MONO).text_size(11.5).text_color(t.muted).child(detail)))
    .when(Boolean(hint), (el) => el.child(div().id("empty-state-hint").text_size(12).line_height(1.45).text_color(t.muted).child(hint)));
}
