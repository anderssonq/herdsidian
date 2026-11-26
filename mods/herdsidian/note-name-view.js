// The inline row of the New note name prompt, drawn at the top of the Notes tab. A pure function of a plain
// model plus callbacks; VaultActions owns the state. Plan: herdsidian-sidebar-motion-layout-plan.md, ### Name prompt.
import { div } from "gpui-kit";
import { h_flex, v_flex, Input } from "gpui-base";
import { RADIUS, gitTokens } from "./tokens.js";
import { iconButton } from "./icon-button.js";

// -> Element. m: { label: folderLabel(dir), input: InputState, message: string | null, busy: boolean }
//   on: cancel(cx) is the X · key(e, cx) gets every key pressed in the row (Escape is handled by the owner)
export function noteNameRow(t, k, m, on) {
  return v_flex().id("notes-new-name").flex_none().px(8).py(6).gap(4).on_key_down((e, cx) => on.key(e, cx))
    .child(h_flex().gap(6).items_center()
      .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.muted).child(m.label))
      .child(iconButton("notes-new-name-close", t, "x", "Close", (_e, cx) => on.cancel(cx))))
    .child(h_flex().h(28).px(8).items_center().rounded(RADIUS.control).bg(t.raised).border(1).border_color(k.line)
      .when(m.busy, (el) => el.opacity(0.6))
      .child(Input.new(m.input).flex_1().text_size(12).text_color(t.foreground)))
    .when(Boolean(m.message), (el) => el.child(div().id("notes-new-name-message").text_size(11.5)
      .text_color(gitTokens(t).errorText).child(m.message)));
}
