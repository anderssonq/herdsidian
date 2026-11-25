// The Git tab's confirm card and result panel, drawn between the actions bar and the filter.
// Pure functions of a plain model `m` plus callbacks `on`; git-view.js owns the state and ActionGate. Plan: .spec/herdsidian-git-tab-plan.md.
import { div } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import { RADIUS, tokens } from "./tokens.js";
import { iconButton } from "./icon-button.js";

const panel = (k, id) => v_flex().id(id).flex_none().p(10).gap(8).rounded(RADIUS.card).bg(k.pill).border(1).border_color(k.line);

const textButton = (id, label, onClick, style) =>
  div().id(id).h(26).px(10).flex_none().flex().items_center().rounded(RADIUS.control).text_size(12).cursor_pointer().on_click(onClick)
    .when(style.solid, (el) => el.bg(style.bg).text_color(style.fg).font_semibold())
    .when(!style.solid, (el) => el.text_color(style.fg).hover((s) => s.bg(style.hover)))
    .child(label);

function confirm(t, k, gk, c, on) {
  return panel(k, "git-confirm")
    .child(div().id("git-confirm-text").text_size(12).text_color(t.foreground).child(c.text))
    .when(Boolean(c.input), (el) => el.child(h_flex().id("git-confirm-input").h(28).px(8).items_center().rounded(RADIUS.control).bg(t.raised)
      .child(Input.new(c.input).flex_1().text_size(12).text_color(t.foreground))))
    .when(Boolean(c.error), (el) => el.child(div().id("git-confirm-error").text_size(11.5).text_color(gk.errorText).child(c.error)))
    .child(h_flex().gap(6).items_center().justify_end()
      .child(textButton("git-confirm-no", "Cancel", (_e, cx) => on.cancel(cx), { solid: false, fg: t.muted, hover: k.pill }))
      .child(textButton("git-confirm-yes", c.yes, (_e, cx) => on.confirm(cx), { solid: true, bg: t.solid, fg: t.solid_foreground })));
}

function result(t, k, gk, r, on) {
  return panel(k, "git-result")
    .child(h_flex().gap(6).items_center()
      .child(div().id("git-result-title").flex_1().min_w(0).text_size(12).font_semibold().text_color(t.foreground).child(r.title))
      .when(Boolean(r.failed), (el) => el.child(textButton("git-result-copy", "Copy", (_e, cx) => on.copy(cx), { solid: false, fg: t.muted, hover: k.pill })))
      .child(iconButton("git-result-close", t, "x", "Close", (_e, cx) => on.close(cx))))
    .child(v_flex().id("git-result-lines").gap(2).children(r.lines.map((line) =>
      div().text_size(11.5).text_color(r.failed ? gk.errorText : t.muted).child(line))));
}

// -> Element: the confirm card (when `m.confirm`) and the result panel (when `m.result`), one under the other.
//   m.confirm: { text: confirmText(...), yes: the button label ("Pull", "Publish", "Create branch"...), input: InputState | null (Branch and Stash),
//                error: string | null (Branch: "Not a valid branch name") }
//   m.result: { title: "Pull done", lines: string[], failed: boolean (error color and the Copy button) }
//   on: confirm(cx) · cancel(cx) · copy(cx) · close(cx)
export function gitCard(t, gk, m, on) {
  const k = tokens(t);
  return v_flex().flex_none().px(8).pb(6).gap(6)
    .when(Boolean(m.confirm), (el) => el.child(confirm(t, k, gk, m.confirm, on)))
    .when(Boolean(m.result), (el) => el.child(result(t, k, gk, m.result, on)));
}
