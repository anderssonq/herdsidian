import { test } from "node:test";
import assert from "node:assert/strict";
import { PASTE_WAIT_MS, sendToasts, sendText } from "../mods/herdsidian/send.js";

const msg = { text: "/v/a.md", address: "t1", name: "claude", more: "" };

// Fake runtime: `log` records every call in order; spawn keeps the body's promise in `cx.running`.
function fakes({ focusedTo = "t1", clipboardThrows = false, spawnThrows = false, runThrows = false } = {}) {
  const log = [], toasts = [];
  const inner = { sleep: async (ms) => { log.push(["sleep", ms]); }, notify: () => log.push(["cx.notify"]) };
  const cx = {
    notify: () => log.push(["cx.notify"]),
    write_to_clipboard: (text) => { if (clipboardThrows) throw new Error("clipboard"); log.push(["clipboard", text]); },
    spawn: (fn) => {
      if (spawnThrows) throw new Error("spawn");
      cx.running = fn(inner);
    },
  };
  const deps = {
    run: (action, args) => { log.push(["run", action, args]); if (runThrows) throw new Error("run"); },
    focused: () => { log.push(["focused"]); return focusedTo ? { terminal: focusedTo } : null; },
    notify: (t) => toasts.push(t),
  };
  return { cx, deps, log, toasts };
}

test("sendText pastes when the focus reached the agent", async () => {
  const f = fakes(), guard = { sending: false };
  assert.equal(sendText(f.cx, guard, msg, f.deps), true);
  assert.equal(guard.sending, true);
  await f.cx.running;
  assert.deepEqual(f.log.filter(([k]) => k === "run"), [["run", "pane.focus", { terminal: "t1" }], ["run", "terminal.paste", undefined]]);
  assert.deepEqual(f.toasts, [{ title: "Pasted into claude. Review and press Enter.", level: "success" }]);
  assert.equal(guard.sending, false);
});

test("sendText writes the clipboard before it focuses the agent", async () => {
  const f = fakes(), guard = { sending: false };
  sendText(f.cx, guard, msg, f.deps);
  await f.cx.running;
  const at = (pred) => f.log.findIndex(pred);
  const copied = at(([k]) => k === "clipboard"), focus = at(([k, a]) => k === "run" && a === "pane.focus");
  assert.ok(copied >= 0 && focus >= 0);
  assert.ok(copied < focus);
});

test("sendText copies without pasting when the focus does not arrive", async () => {
  for (const focusedTo of ["other", null]) {
    const f = fakes({ focusedTo }), guard = { sending: false };
    sendText(f.cx, guard, msg, f.deps);
    await f.cx.running;
    assert.equal(f.log.some(([, a]) => a === "terminal.paste"), false);
    assert.deepEqual(f.log.find(([k]) => k === "clipboard"), ["clipboard", "/v/a.md"]);
    assert.deepEqual(f.toasts, [{ title: "Copied. Press ⌘V in the agent.", level: "info" }]);
    assert.equal(guard.sending, false);
  }
});

test("sendText never pastes before the focus check", async () => {
  const f = fakes();
  sendText(f.cx, { sending: false }, msg, f.deps);
  await f.cx.running;
  const order = f.log.map(([k, a]) => (k === "run" ? a : k));
  assert.deepEqual(order.slice(order.indexOf("pane.focus"), order.indexOf("terminal.paste") + 1), ["pane.focus", "sleep", "focused", "terminal.paste"]);
  assert.deepEqual(f.log.find(([k]) => k === "sleep"), ["sleep", PASTE_WAIT_MS]);
  assert.equal(PASTE_WAIT_MS, 50);
});

test("a second sendText while one runs returns false and copies nothing", async () => {
  const f = fakes(), guard = { sending: false };
  assert.equal(sendText(f.cx, guard, msg, f.deps), true);
  const second = fakes();
  assert.equal(sendText(second.cx, guard, { ...msg, text: "/v/b.md" }, second.deps), false);
  assert.deepEqual(second.log, []);
  await f.cx.running;
  assert.equal(f.log.filter(([k]) => k === "clipboard").length, 1);
});

test("the guard is reset and the error rethrown after a throwing clipboard", () => {
  const f = fakes({ clipboardThrows: true }), guard = { sending: false };
  assert.throws(() => sendText(f.cx, guard, msg, f.deps), /clipboard/);
  assert.equal(guard.sending, false);
  assert.equal(f.cx.running, undefined);
});

test("the guard is reset after a throwing spawn", () => {
  const f = fakes({ spawnThrows: true }), guard = { sending: false };
  assert.throws(() => sendText(f.cx, guard, msg, f.deps), /spawn/);
  assert.equal(guard.sending, false);
});

test("the guard is reset after a throwing spawn body and the text stays copied", async () => {
  const f = fakes({ runThrows: true }), guard = { sending: false };
  sendText(f.cx, guard, msg, f.deps);
  await f.cx.running;
  assert.equal(guard.sending, false);
  assert.equal(f.log.some(([, a]) => a === "terminal.paste"), false);
  assert.deepEqual(f.toasts, [{ title: "Copied. Press ⌘V in the agent.", level: "info" }]);
});

test("the toast texts carry ` +N not sent`", async () => {
  const t = sendToasts("claude", 1, 2);
  assert.equal(t.more, " +3 not sent");
  assert.equal(t.pasted, "Pasted into claude. Review and press Enter. +3 not sent");
  assert.equal(t.copied, "Copied. Press ⌘V in the agent. +3 not sent");
  assert.equal(t.nothing, "Nothing to send +3 not sent");
  assert.equal(sendToasts("claude", 0).more, "");
  assert.equal(sendToasts("claude", 0).nothing, "Nothing to send");
  const f = fakes();
  sendText(f.cx, { sending: false }, { ...msg, more: t.more }, f.deps);
  await f.cx.running;
  assert.equal(f.toasts[0].title, t.pasted);
});

test("onDone(pasted) is called once", async () => {
  for (const [focusedTo, want] of [["t1", true], ["other", false]]) {
    const f = fakes({ focusedTo }), done = [];
    sendText(f.cx, { sending: false }, msg, f.deps, (p) => done.push(p));
    await f.cx.running;
    assert.deepEqual(done, [want]);
  }
});

test("the run log never has terminal.send, terminal.keys or an Enter", async () => {
  const f = fakes();
  sendText(f.cx, { sending: false }, msg, f.deps);
  await f.cx.running;
  const actions = f.log.filter(([k]) => k === "run").map(([, a]) => a);
  assert.deepEqual(actions, ["pane.focus", "terminal.paste"]);
  assert.equal(JSON.stringify(f.log).toLowerCase().includes("enter"), false);
});
