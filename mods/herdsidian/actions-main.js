// The Notes side of the tree's right-click actions. The overlay copies only post a request; this copy holds
// the open note, the unsaved state, the open folders and the recents, so it checks again and does the work.
// A rename follows plan Decision 4 in its exact order: the move comes first, and links are written only after it.

import { notify, openOverlay, settings, shared } from "herdr";
import { dirOf, leafOf } from "./notes.js";
import { ACTION_KEY, isSameItem, menuItems, movePath, movedState, pendingAction, placeMenu, removedState, resultMessage,
  safeRel, takenName, under, validateName } from "./actions.js";
import { listNotes, recentOf, saveContext, stateDir, storeRecent } from "./io.js";
import { updateReferences } from "./ref-update.js";
import { exists, listNames, makeFolder, makeNote, moveItem, moveSameItem, snapshotFiles, trashItem, why } from "./vault-io.js";

const absOf = (vault, rel) => (rel ? `${vault}/${rel}` : vault);
const joinRel = (dir, name) => (dir ? `${dir}/${name}` : name);
// A vault the view left has its recents only in localStorage: a moved or removed path must not stay there.
const changeStoredRecent = (vault, change) => storeRecent(vault, change(recentOf(vault)));
const failed = (verb, path, reason) => notify({ title: `Cannot ${verb} ${path || "the vault root"}`, body: reason, level: "error" });
const taken = (name) => notify({ title: `"${name}" already exists in this folder`, level: "warning" });
// A request for a vault the view has left runs nothing, and says so.
const dropped = (vault) => notify({ title: `Nothing changed: the vault is no longer ${leafOf(vault ?? "")}`, level: "warning" });
const pathsOf =(v) => ({ note: v.note, selected: v.selected, folders: v.folders, entries: v.entries, all: v.all, recent: v.recent });

export class VaultActions {
  constructor(view) {
    this.view = view;
    this.busy = false; // a rename or a delete runs; a create may still start (AC39)
    // shared() is persisted: a request found at start is old, and must not replay a delete.
    this.handled = shared(ACTION_KEY)?.id ?? null;
  }

  // The right-click handler of a row, or of the tree's empty space with kind "root". It changes no view state (AC4).
  rowMenu(path, kind) {
    return (event, cx) => {
      cx.stop_propagation();
      const place = placeMenu(event.position, menuItems(kind).length, globalThis.window?.viewport_size?.(), settings()?.zoom);
      openOverlay({ mod: "herdsidian", kind: "popup", frame: "none", ...place, props: { vaultSurface: "menu", vault: this.view.vault, target: { path, kind } } });
    };
  }

  // What a surface asked for through shared(). Called from render, so the work runs in a spawn after it.
  consume(cx) {
    const request = shared(ACTION_KEY);
    const { action, id } = pendingAction(request, this.handled, this.view.vault, Date.now());
    if (action === "none") return;
    this.handled = id;
    cx.spawn(async (cx) => {
      await cx.sleep(0);
      // The vault may have changed since render compared it, and a request must never run in another vault.
      if (action === "other-vault" || request.vault !== this.view.vault) dropped(request.vault);
      else this.start(request, cx);
      cx.notify();
    });
  }

  start({ vault, op, path, kind, name }, cx) {
    if (op === "new-note") this.createNote(path, cx, vault);
    else if (op === "new-folder") this.newFolder(path, name, cx, vault);
    else if (op === "rename") this.rename(path, kind, name, cx, vault);
    else this.remove(path, cx, vault);
  }

  // Only one rename or delete at a time; the message is all that a second one does (AC39).
  refusedBusy() {
    if (this.busy) notify({ title: "Wait for the current rename or delete to finish", level: "warning" });
    return this.busy;
  }

  // AC60: the item is on disk, or the person is told and the tree reloads. Nothing is created. Throws if it cannot tell.
  async present(vault, rel, cx) {
    if (await exists(absOf(vault, rel))) return true;
    notify({ title: `${rel || "The vault"} no longer exists`, level: "warning" });
    if (this.view.vault === vault) this.view.load(cx);
    return false;
  }

  // Opens a folder and its parents so that a new item shows. Other open folders stay (AC14).
  showFolder(dir) {
    const parts = dir ? dir.split("/") : [];
    parts.forEach((_part, i) => this.view.folders.add(parts.slice(0, i + 1).join("/")));
  }

  // The new paths, all in one tick with the file operation's result, so no render or load sees a mix.
  setPaths(vault, next) {
    const view = this.view;
    Object.assign(view, next);
    storeRecent(vault, view.recent);
    view.liveNotes = null; view.hover = null; view.pathEpoch++;
  }

  // The file operation stays done when this fails: only the agent-context error shows (AC59).
  saveChange(change, cx) {
    const view = this.view;
    cx.spawn(async (cx) => {
      try {
        view.stateDir ??= await stateDir();
        view.ctx = { status: "ok", doc: await saveContext(view.stateDir, change, null, []) };
        view.ctxError = null;
      } catch (e) { view.ctxError = String(e); }
      cx.notify();
    });
  }

  // An empty Untitled note in `dir` ("" is the root), opened in edit mode (AC9, AC11, AC15).
  createNote(dir, cx, vault = this.view.vault) {
    const view = this.view;
    const safe = safeRel(dir, { allowRoot: true });
    if (!safe.ok) return failed("create a note in", dir, safe.reason);
    cx.spawn(async (cx) => {
      try {
        if (!(await this.present(vault, dir, cx))) return;
        const made = await makeNote(absOf(vault, dir));
        if (!made.ok) return failed("create a note in", dir, made.reason);
        if (view.vault !== vault) return;
        const path = joinRel(dir, made.name);
        view.all = [...view.all, path]; view.liveNotes = null;
        this.showFolder(dir);
        view.open(path, cx, "edit");
        view.load(cx);
      } catch (e) { failed("create a note in", dir, why(e)); } finally { cx.notify(); }
    });
  }

  newFolder(dir, name, cx, vault) {
    const view = this.view;
    const safe = safeRel(dir, { allowRoot: true }), checked = validateName(name);
    if (!safe.ok) return failed("create a folder in", dir, safe.reason);
    if (!checked.ok) return failed("create a folder in", dir, checked.reason);
    cx.spawn(async (cx) => {
      try {
        if (!(await this.present(vault, dir, cx))) return;
        if (takenName(await listNames(absOf(vault, dir)), checked.name)) return taken(checked.name);
        const made = await makeFolder(`${absOf(vault, dir)}/${checked.name}`);
        if (!made.ok) return failed("create a folder in", dir, made.reason);
        if (view.vault !== vault) return;
        this.showFolder(dir);
        view.load(cx);
      } catch (e) { failed("create a folder in", dir, why(e)); } finally { cx.notify(); }
    });
  }

  rename(path, kind, name, cx, vault) {
    if (this.refusedBusy()) return;
    const safe = safeRel(path);
    if (!safe.ok) return failed("rename", path, safe.reason);
    if (name === leafOf(path)) return; // no disk change and no message (AC20, AC38)
    const checked = validateName(name);
    if (!checked.ok) return failed("rename", path, checked.reason);
    this.busy = true;
    cx.spawn(async (cx) => {
      try { await this.renameSteps(vault, path, joinRel(dirOf(path), checked.name), kind === "dir", cx); }
      catch (e) { failed("rename", path, why(e)); }
      this.busy = false;
      cx.notify();
    });
  }

  // Steps 1 to 10 of plan Decision 4; rename() only checks the request before them. Do not reorder them.
  async renameSteps(vault, from, to, isDir, cx) {
    const view = this.view, leaf = leafOf(from), name = leafOf(to);
    // 1. The item exists, and the name is free on disk now, not only when the dialog checked (AC60, AC61).
    if (!(await this.present(vault, from, cx))) return;
    if (takenName(await listNames(absOf(vault, dirOf(from))), name, leaf)) return taken(name);
    // 2. What the update needs, read before the move. If this fails, nothing has moved (AC58).
    const same = isSameItem(leaf, name);
    const list = await listNotes(vault);
    const files = isDir && !same ? await snapshotFiles(vault) : null;
    if (view.vault !== vault) return dropped(vault);
    // 3. The move.
    view.moving = true;
    const moved = await (same ? moveSameItem : moveItem)(`${vault}/${from}`, `${vault}/${to}`);
    view.moving = false;
    // 4. A failed move changes no state (AC58). A missing item also reloads the tree (AC60).
    if (!moved.ok) {
      if (moved.code === 4) return taken(name);
      failed("rename", from, moved.reason);
      if (moved.code === 3 && view.vault === vault) view.load(cx);
      return;
    }
    // 5. The view follows, with no await since the move's result. Another vault's view has none of these paths.
    const here = view.vault === vault;
    if (here) this.setPaths(vault, movedState(pathsOf(view), from, to));
    else changeStoredRecent(vault, (list) => list.map((p) => movePath(p, from, to)));
    // 6. The context file, in its own spawn.
    this.saveChange({ type: "rename-paths", from, to, vault }, cx);
    // 7. The tree shows the new name now, not when the watcher reports it.
    if (here) view.load(cx);
    // 8. A case-only rename resolves as before, so no other note changes (AC38).
    if (same) {
      notify(resultMessage({}));
      return;
    }
    // 9. The links. isDirty is sync: the update asks it right before each write (AC33).
    const isDirty = (path) => view.vault === vault && view.note === path && Boolean(view.dirty);
    const result = await updateReferences({ vault, from, to, isDir, list, files, isDirty });
    // 10. A clean open note shows its new text (AC34), and the one message (AC36).
    if (view.vault === vault) {
      view.refreshNote(cx);
      view.load(cx);
    }
    notify(resultMessage(result));
  }

  remove(path, cx, vault) {
    if (this.refusedBusy()) return;
    const safe = safeRel(path);
    if (!safe.ok) return failed("delete", path, safe.reason);
    const view = this.view;
    this.busy = true;
    cx.spawn(async (cx) => {
      let there = false;
      try { there = await this.present(vault, path, cx); } catch (e) { failed("delete", path, why(e)); }
      // Free while the banner waits: its Cancel must not leave every later rename refused.
      this.busy = false;
      if (there && view.vault !== vault) dropped(vault);
      else if (there) {
        const next = (cx) => this.trash(vault, path, cx);
        // Unsaved edits in the item ask first: Save, Discard or Cancel (AC57).
        if (view.note && under(view.note, path)) view.leave(next, cx);
        else next(cx);
      }
      cx.notify();
    });
  }

  trash(vault, path, cx) {
    const view = this.view;
    // Discard already cleared the mark; a delete that does not happen must put it back (AC50).
    const unsaved = () => { if (view.editor) view.dirty = view.editor.value() !== view.loaded; };
    if (this.refusedBusy()) return unsaved();
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        view.moving = true;
        const done = await trashItem(`${vault}/${path}`);
        const here = view.vault === vault;
        if (done.ok) {
          if (here) {
            if (view.note && under(view.note, path)) view.close();
            this.setPaths(vault, removedState(pathsOf(view), path));
          } else changeStoredRecent(vault, (list) => list.filter((p) => !under(p, path)));
          this.saveChange({ type: "remove-paths", path, vault }, cx);
          notify({ title: `Moved ${path} to the Trash`, level: "success" });
        } else {
          unsaved();
          failed("delete", path, done.reason);
        }
        if (here) view.load(cx);
      } finally {
        view.moving = false;
        this.busy = false;
        cx.notify();
      }
    });
  }
}
