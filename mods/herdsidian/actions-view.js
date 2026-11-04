// The tree's right-click surfaces: the menu, the name prompt and the delete confirmation. Notes (main.js)
// opens each as an overlay copy of this mod and renders VaultSurface in it. A surface never touches the
// disk to change it: it posts one request in shared(ACTION_KEY), and Notes does the work (plan, Decision 1).
// Every root has an explicit width and height: a size_full root paints nothing on a frame "none" surface.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, setShared, run, openOverlay, closeOverlay, props } from "herdr";
import { tokens } from "./tokens.js";
import { dirOf, leafOf } from "./notes.js";
import { MENU, ACTION_KEY, menuItems, menuSize, validateName, noteFileName, takenName, deleteDetail } from "./actions.js";
import { listNames, countFolder } from "./vault-io.js";

export const PROMPT = { width: 380, height: 210 };
export const CONFIRM = { width: 420, height: 230 };

const REFOCUS_MS = 600; // Herdr may take the keyboard back right after the dialog opens
const TITLES = { "new-folder": "New folder", rename: "Rename" };

export class VaultSurface {
  constructor(cx) {
    this.p = props() ?? {};
    this.target = this.p.target ?? { path: "", kind: "root" };
    this.dead = false; this.sent = false; this.busy = false;
    this.message = null; this.counts = null; this.counting = false; this.inputFocused = true;
    this.handle = cx.focus_handle();
    if (this.p.vaultSurface === "prompt") this.startPrompt(cx);
    else if (this.p.vaultSurface === "confirm") this.startConfirm(cx);
    else this.handle.focus();
  }

  startPrompt(cx) {
    const { path, kind } = this.target;
    const leaf = leafOf(path);
    // A note shows its name without the extension (AC16).
    const text = this.p.op === "rename" ? (kind === "note" ? leaf.replace(/\.md$/i, "") : leaf) : "";
    this.input = InputState.new({ value: text });
    if (text) this.input.set_selected_range({ start: 0, end: text.length });
    this.input.on("change", (_e, cx) => { this.message = null; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(REFOCUS_MS, () => { if (!this.dead) this.input.focus(); });
  }

  startConfirm(cx) {
    this.handle.focus();
    if (this.target.kind !== "dir") return;
    this.counting = true;
    const abs = `${this.p.vault}/${this.target.path}`;
    cx.spawn(async (cx) => {
      // A failed count is null: the dialog says so and delete stays possible (AC48).
      const counts = await countFolder(abs).catch(() => null);
      this.counting = false;
      if (this.dead) return;
      this.counts = counts;
      cx.notify();
    });
  }

  close() {
    this.dead = true;
    closeOverlay(props().overlay);
  }

  // Herdr's close hook (forwarded by Notes): pending checks must not send after the dialog is gone.
  closed() {
    this.dead = true;
  }

  // The one request for the Notes copy, then Notes is shown (a hidden one starts and reads it), then close.
  send(op, name) {
    if (this.sent) return;
    this.sent = true;
    const { path, kind } = this.target;
    const id = `v${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setShared(ACTION_KEY, { id, at: Date.now(), vault: this.p.vault, op, path, kind, ...(name !== undefined && { name }) });
    run("layout.show", { id: "herdsidian" });
    this.close();
  }

  choose(op) {
    if (op === "new-note") return this.send("new-note");
    const { vault, target } = this.p;
    closeOverlay(props().overlay);
    const confirm = op === "delete";
    openOverlay({
      mod: "herdsidian", kind: "dialog", frame: "none", ...(confirm ? CONFIRM : PROMPT),
      props: { vaultSurface: confirm ? "confirm" : "prompt", vault, target, op },
    });
  }

  submit(cx) {
    if (this.busy || this.sent) return;
    const { op, vault } = this.p;
    const { path, kind } = this.target;
    const leaf = leafOf(path);
    const note = kind === "note";
    const typed = this.input.value().trim();
    // The same name closes with no request, before validateName, so ".foo" to ".foo" is not refused (AC20).
    if (op === "rename" && (note ? noteFileName(leaf, typed) : typed) === leaf) return this.close();
    const checked = validateName(typed);
    if (!checked.ok) { this.message = checked.reason; return cx.notify(); }
    const name = op === "rename" && note ? noteFileName(leaf, checked.name) : checked.name;
    const parent = op === "rename" ? dirOf(path) : path;
    const dir = parent ? `${vault}/${parent}` : vault;
    this.busy = true;
    this.message = null;
    cx.notify();
    cx.spawn(async (cx) => {
      let names = null;
      try { names = await listNames(dir); } catch {} // Notes reports a real failure
      this.busy = false;
      if (this.dead) return;
      if (names && takenName(names, name, op === "rename" ? leaf : null)) {
        this.message = `"${name}" already exists in this folder`;
        return cx.notify();
      }
      this.send(op, name);
    });
  }

  key(e, cx) {
    if (e.key !== "escape") return;
    this.close();
    cx.stop_propagation();
  }

  render(cx) {
    const t = theme();
    const kind = this.p.vaultSurface;
    return kind === "prompt" ? this.promptCard(t) : kind === "confirm" ? this.confirmCard(t) : this.menuCard(t);
  }

  menuCard(t) {
    const { width, height } = menuSize(this.target.kind);
    const row = ({ id, label }) => h_flex().id(`vault-menu-${id}`).h(MENU.row).px(10).items_center().rounded(6)
      .text_size(12.5).text_color(t.foreground).cursor_pointer()
      .hover((s) => s.bg(tokens(t).pill)).on_click(() => this.choose(id)).child(label);
    return v_flex().id("vault-menu").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .w(width).h(height).p(MENU.pad / 2).rounded(8).border_1().border_color(t.border).bg(t.popover)
      .children(menuItems(this.target.kind).map(row));
  }

  button(t, id, text, primary, action) {
    return h_flex().id(id).h(32).px(14).items_center().rounded(8)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click(action).child(text);
  }

  promptCard(t) {
    const save = this.busy ? "Checking…" : "Save";
    return v_flex().id("vault-prompt").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .w(PROMPT.width).h(PROMPT.height).p(16).rounded(10).border_1().border_color(t.border).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(TITLES[this.p.op] ?? "Name"))
        .child(div().text_size(11).text_color(t.muted).child("Esc")))
      .child(div().pt(12).pb(6).text_size(11.5).text_color(t.muted).child("Name"))
      .child(Input.new(this.input).h(36).px(10).rounded(9).border_1().border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(div().id("vault-prompt-message").h(34).pt(6).text_size(11.5).text_color(t.blocked).child(this.message ?? ""))
      .child(h_flex().pt(8).gap(8).justify_end()
        .child(this.button(t, "vault-prompt-cancel", "Cancel", false, () => this.close()))
        .child(this.button(t, "vault-prompt-save", save, true, (_e, cx) => this.submit(cx))));
  }

  confirmCard(t) {
    const { path, kind } = this.target;
    const name = leafOf(path);
    const detail = this.counting ? "Counting…" : deleteDetail(name, kind, this.counts);
    return v_flex().id("vault-confirm").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .w(CONFIRM.width).h(CONFIRM.height).p(16).gap(10).rounded(10).border_1().border_color(t.border).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().child(`Delete "${name}"?`))
        .child(div().text_size(11).text_color(t.muted).child("Esc")))
      .child(div().id("vault-confirm-detail").flex_1().min_h(0).text_size(12.5).text_color(t.muted).child(detail))
      .child(h_flex().gap(8).justify_end()
        .child(this.button(t, "vault-confirm-cancel", "Cancel", false, () => this.close()))
        .child(this.button(t, "vault-confirm-delete", "Move to Trash", true, () => this.send("delete"))));
  }
}
