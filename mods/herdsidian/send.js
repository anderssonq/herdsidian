// Send to agent, once for Notes and the palette (ADR-0002): copy the text, focus the agent's
// terminal, paste only when the focus really arrived. Paste only, the user reviews and submits.
// Pure: no imports. The caller gives `deps` = { run, focused, notify } from the herdr runtime.

export const PASTE_WAIT_MS = 50;

// The three toast titles of a send; `skipped + overflow` is the count left out.
export function sendToasts(name, skipped, overflow = 0) {
  const left = skipped + overflow, more = left ? ` +${left} not sent` : "";
  return titles(name, more);
}

const titles = (name, more) => ({
  more,
  pasted: `Pasted into ${name}. Review and press Enter.${more}`,
  copied: `Copied. Press ⌘V in the agent.${more}`,
  nothing: `Nothing to send${more}`,
});

// run() returns before the focus moves: wait a moment, and paste only when the focus reached
// the agent's terminal; otherwise the text stays copied. Never throws.
async function pasteWhenFocused(cx, address, { run, focused }) {
  try {
    run("pane.focus", { terminal: address });
    await cx.sleep(PASTE_WAIT_MS);
    if (focused()?.terminal !== address) return false;
    run("terminal.paste");
    return true;
  } catch {
    return false;
  }
}

// Copies `text`, then pastes it into the agent's terminal when it can. `guard.sending` blocks a
// second send while one runs (returns false). Returns true when the send started.
export function sendText(cx, guard, { text, address, name, more = "" }, deps, onDone = () => {}) {
  if (guard.sending) return false;
  guard.sending = true;
  try {
    cx.notify();
    cx.write_to_clipboard(text);
  } catch (e) {
    guard.sending = false; // Never leave Send stuck on "Sending…".
    throw e;
  }
  try {
    cx.spawn(async (cx) => {
      let pasted = false;
      try {
        pasted = await pasteWhenFocused(cx, address, deps);
      } finally {
        guard.sending = false;
        try { cx.notify(); } catch {}
      }
      const t = titles(name, more);
      if (pasted) deps.notify({ title: t.pasted, level: "success" });
      else deps.notify({ title: t.copied, level: "info" });
      onDone(pasted);
    });
  } catch (e) {
    guard.sending = false;
    throw e;
  }
  return true;
}
