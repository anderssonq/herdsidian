// Owns the motion of the sidebar tab switch: a pure two-render step (no timer, no gpui).
// The first render of a switch draws the old pill slot and a new body at its start values; every later one draws the end values.

export const PILL_MOTION = { duration: 180, easing: "ease-out" };
export const BODY_MOTION = { duration: 160, easing: "ease-out" };
export const BODY_SHIFT = 8;

const IDLE = { slide: false, body: null, again: false };

// prev: the last returned `state` or null. now: { top, shown, order, wide, width }.
// Returns { state, pillTab, slide, body, again }; see the plan, "sidebar-motion.js".
export function stepMotion(prev, now) {
  const state = { top: now.top, shown: now.shown, order: now.order, wide: now.wide, width: now.width };
  const still = (extra) => ({ state, pillTab: now.top, ...IDLE, ...extra });
  // Mount, rail and rail to wide: no motion, the pill snaps.
  if (!prev || !now.wide || !prev.wide) return still();
  const changed = prev.width !== now.width || prev.order.join() !== now.order.join();
  if (prev.top === now.top) return still({ slide: !changed });
  // A swap in a split: both bodies were already shown, so only the pill moves.
  if (prev.shown.includes(now.top)) return still({ slide: !changed });
  const forward = now.order.indexOf(now.top) > now.order.indexOf(prev.top);
  return {
    state,
    pillTab: prev.top,
    slide: !changed,
    body: { tab: now.top, opacity: 0, left: forward ? BODY_SHIFT : -BODY_SHIFT },
    again: true,
  };
}
