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
