// The Notes side of the right-click menu on text. Notes, Files, Changes and Git open it through open(); the popup
// copies text itself and posts the rest to shared(TEXT_ACTION_KEY), which consume() runs once, in this copy, after
// checking that the request still names what is shown (the same editor, note or file).

import { notify, openOverlay, run, focused, settings, shared } from "herdr";
import { placeMenu } from "./actions.js";
import { sendText } from "./send.js";
import { TEXT_ACTION_KEY, pendingTextAction, textMenuSize } from "./text-menu.js";

export class TextMenus {
  constructor(view) {
    this.view = view;
    // shared() is persisted: a request found at start is old and must not run again.
    this.handled = shared(TEXT_ACTION_KEY)?.id ?? null;
  }

  // `model`: { items, texts, target } from text-menu.js; `target` names what the rows act on.
  open(event, cx, model) {
    cx.stop_propagation();
    if (!model?.items?.length) return;
    const place = placeMenu(event?.position, 0, globalThis.window?.viewport_size?.(), settings()?.zoom, textMenuSize(model.items));
    openOverlay({ mod: "herdsidian", kind: "popup", frame: "none", ...place, props: { textMenu: model } });
  }

  // Called from render, so the work runs in a spawn after it.
  consume(cx) {
    const request = shared(TEXT_ACTION_KEY);
    const { run: go, id } = pendingTextAction(request, this.handled, Date.now());
    if (id === this.handled) return;
    this.handled = id;
    if (!go) return;
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      this.start(request, cx);
      cx.notify();
    });
  }

  // The editor a request names, while it is still the one shown (same note, or same folder and file); else null.
  editorOf(target) {
    const view = this.view;
    if (target?.surface === "edit") return view.mode === "edit" && view.note === target.note ? view.editor : null;
    if (target?.surface === "file") {
      const files = view.filesTab;
      return files?.root === target.root && files.file === target.file && files.full === target.full ? files.code : null;
    }
    return null;
  }

  start({ op, target }, cx) {
    const view = this.view;
    if (op === "send") return this.send(cx);
    if (op === "edit") { if (view.note && view.note === target?.note) view.setMode("edit"); return; }
    if (op === "open-files") { if (target?.root && target.path) view.tabBody("changes").open(target.root, target.path, cx); return; }
    const editor = this.editorOf(target);
    const gone = () => notify({ title: "Nothing changed: the text is no longer open", level: "warning" });
    if (!editor) return gone();
    if (op === "cut" && target.surface === "edit") {
      // Cut removes the range the popup copied, and only while that range still holds the copied text (an outside
      // write of the same length, like [ ] → [x], must not be deleted unseen).
      const value = editor.value(), r = target.range;
      const changed = () => notify({ title: "Nothing cut: the note changed since the menu opened", level: "warning" });
      if (!r || value.length !== target.length) return changed();
      if (value.slice(Math.min(r.start, r.end), Math.max(r.start, r.end)) !== cx.read_from_clipboard()) return changed();
      editor.set_selected_range(target.range);
      editor.replace("");
    }
    else if (op === "paste" && target.surface === "edit") {
      const pasted = cx.read_from_clipboard();
      if (typeof pasted === "string" && pasted) editor.replace(pasted);
    } else if (op === "select-all") editor.set_selected_range({ start: 0, end: editor.value().length });
    editor.focus();
  }

  // The popup copied the selection: paste it into the focused agent's terminal, never submitted (ADR-0002).
  // It stays copied when there is no agent or another send runs.
  send(cx) {
    const view = this.view, text = cx.read_from_clipboard();
    if (typeof text !== "string" || !text) return;
    const agent = view.scene(cx).agent;
    if (!agent) return notify({ title: "No agent focused. Copied: press ⌘V in the agent.", level: "info" });
    const name = agent.program?.name ?? agent.app ?? "the agent";
    if (!sendText(cx, view, { text, address: agent.address, name }, { run, focused, notify })) {
      notify({ title: "Wait for the current send. Copied: press ⌘V in the agent.", level: "info" });
    }
  }
}
