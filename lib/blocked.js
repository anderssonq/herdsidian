// The next agent that needs you: after the focused one in the list's order, wrapping around.
// A focused agent that is itself blocked comes last, so it is chosen only when it is the only one.
// Not in the list (or nothing focused): the first blocked one. None blocked: null.
export function nextBlocked(order, focusedPane) {
  const at = order.findIndex((a) => a.pane === focusedPane);
  for (let step = 1; step <= order.length; step++) {
    const a = order[(at + step) % order.length];
    if (a.status === "blocked") return a;
  }
  return null;
}
