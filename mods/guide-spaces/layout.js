// Layout tree helper. Canonical copy: lib/layout.js.
// Each mod that uses it carries a byte-identical copy as mods/<mod>/layout.js (`npm run lint` checks it).
// Pure: no gpui-kit / herdr imports.

// The node with this id in a layout tree (depth first), or null.
export function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}
