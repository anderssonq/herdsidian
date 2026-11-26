// Right sidebar state shared by the sidebar, the toolbar mod and the key router. Canonical copy:
// lib/sidebar.js. Pure (no Herdr or GPUI imports), so Node tests import it.
import { SIDEBAR_TABS } from "./keys.js";

// shared() key holding { tab }: shared (not localStorage) because several mods read it.
export const SIDEBAR_STORE = "herdsidian.sidebar";

export const readSidebar = (raw) => ({ tab: SIDEBAR_TABS.includes(raw?.tab) ? raw.tab : "notes" });

// A key or toolbar click that asks for tab `want`. `hidden` is the herdsidian block's hidden flag.
// Shown on that tab: hide. Hidden: show. Shown on another tab: only switch.
export function routeTab({ hidden, tab }, want) {
  const id = { id: "herdsidian" };
  if (!hidden && tab === want) return { tab, commands: [["layout.hide", id]] };
  return { tab: want, commands: hidden ? [["layout.show", id]] : [] };
}

// shared() key holding { order, split, splitTop }: the tab order, the split pair and the divider height.
export const SIDEBAR_LAYOUT_STORE = "herdsidian.sidebar-layout";

export const SIDEBAR_WIDTH = { rail: 44, narrow: 160, start: 380, max: 760, minPanel: 120 };

// A permutation of SIDEBAR_TABS: unknown and repeated ids dropped, missing ones appended in canonical order.
export function readOrder(value) {
  const kept = Array.isArray(value)
    ? value.filter((id, i) => SIDEBAR_TABS.includes(id) && value.indexOf(id) === i)
    : [];
  return [...kept, ...SIDEBAR_TABS.filter((id) => !kept.includes(id))];
}

const readSplit = (split) =>
  SIDEBAR_TABS.includes(split?.top) &&
  SIDEBAR_TABS.includes(split?.below) &&
  split.top !== split.below
    ? { top: split.top, below: split.below }
    : null;

export const readSidebarLayout = (raw) => ({
  order: readOrder(raw?.order),
  split: readSplit(raw?.split),
  splitTop:
    Number.isFinite(raw?.splitTop) && raw.splitTop >= SIDEBAR_WIDTH.minPanel ? raw.splitTop : null,
});

// `from` removed, then put at the index `to` had. Same or unknown ids give the same order.
export function moveTab(order, from, to) {
  const at = order.indexOf(to);
  if (from === to || !order.includes(from) || at < 0) return [...order];
  const next = order.filter((id) => id !== from);
  next.splice(at, 0, from);
  return next;
}

// The two drawn tabs from the stored top tab and the pair; `fix` is the pair to store when it differs.
export function resolveSplit(tab, split) {
  const pair = readSplit(split);
  if (!pair) return { top: tab, bottom: null, fix: undefined };
  if (tab === pair.top) return { top: tab, bottom: pair.below, fix: undefined };
  const bottom = tab === pair.below ? pair.top : pair.below;
  return { top: tab, bottom, fix: { top: tab, below: bottom } };
}

// The tabs whose body is shown: [top] or [top, bottom].
export function shownTabs(sidebarRaw, layoutRaw) {
  const { top, bottom } = resolveSplit(readSidebar(sidebarRaw).tab, readSidebarLayout(layoutRaw).split);
  return bottom ? [top, bottom] : [top];
}

// The right-click menu row of a tab, or null on the top tab.
export function splitMenu(tab, top, bottom) {
  if (tab === top) return null;
  return tab === bottom
    ? { op: "close-below", label: "Close below" }
    : { op: "open-below", label: "Open below" };
}

export function restoreWidth(stored) {
  const n = stored === null || stored === undefined || stored === "" ? NaN : Number(stored);
  return Number.isFinite(n) && n >= SIDEBAR_WIDTH.narrow && n <= SIDEBAR_WIDTH.max
    ? n
    : SIDEBAR_WIDTH.start;
}
