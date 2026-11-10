// The theme rows of the palette's Settings tab (V4), as pure helpers with no Herdr or GPUI imports, so Node tests
// import it. A family is a pair: hs_<family> (dark) and hs_<family>_light. Colors come from themes() only.
// It also parses Herdr's appearance from its settings.json text.
export const FAMILIES = [
  { id: "carbon", label: "Carbon" },
  { id: "midnight", label: "Midnight" },
  { id: "catppuccin", label: "Catppuccin" },
  { id: "nord", label: "Nord" },
];

export const themeName = (family, light = false) => `hs_${family}${light ? "_light" : ""}`;

// app.theme sets the half that matches the name's lightness, so a pair of calls sets both halves.
// Only a half whose theme is in `themes` (themes()) is called; none without a list.
export const themeCalls = (family, themes) =>
  [themeName(family), themeName(family, true)]
    .filter((name) => themes?.some((th) => th.name === name))
    .map((name) => ["app.theme", { name }]);

// settings().theme is a name, or { light, dark }: the half in use is picked by settings().dark.
export function shownThemeName(herdr) {
  const theme = herdr?.theme;
  if (typeof theme === "string") return theme;
  if (theme && typeof theme === "object") {
    const name = herdr.dark ? theme.dark : theme.light;
    return typeof name === "string" ? name : null;
  }
  return null;
}

export function selectedFamily(herdr) {
  const name = shownThemeName(herdr);
  return FAMILIES.find((f) => name === themeName(f.id) || name === themeName(f.id, true))?.id ?? null;
}

// Herdr's settings() has no appearance, so it is read from Herdr's settings.json (never written).
// "dark" or "light" as set, "system" when absent, null when the text is unreadable or not an object.
export function parseAppearance(text) {
  let json;
  try { json = JSON.parse(text); } catch { return null; }
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  return json.appearance === "dark" || json.appearance === "light" ? json.appearance : "system";
}

// One half of a swatch: the canvas color and the accent dot. null without that theme.
function half(themes, name) {
  const colors = themes?.find((th) => th.name === name)?.colors;
  return colors ? { to: colors.canvas, dot: colors.accent } : null;
}

export const cardColors = (themes, family) => ({
  dark: half(themes, themeName(family)),
  light: half(themes, themeName(family, true)),
});
