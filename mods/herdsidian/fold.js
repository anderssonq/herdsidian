// When the Graph section folds (V6). Pure. `hidden` is the person's own saved choice (graph.hidden);
// the auto-fold while a note is open is never saved. `note` is the open note or null; `override` is the
// note for which the person unfolded the graph by a click (temporary: it holds for that note only).

// -> { folded, hideArea, hideStrip, detail }
//   folded: auto-folded for reading: the graph area hides, the context strip stays under the 32 px header;
//   hideArea / hideStrip: what is not drawn (the person's own "hidden" hides both: the header only);
//   detail: the muted text after "Graph" in the folded header, else null (count 0 = not known yet, left out).
export function graphFold({ hidden, note, override = null, count = 0 }) {
  const folded = Boolean(note) && !hidden && override !== note;
  const part = count > 0 ? ` · ${count} ${count === 1 ? "note" : "notes"}` : "";
  return { folded, hideArea: hidden || folded, hideStrip: hidden, detail: folded ? `${part} · folded while reading` : null };
}

// A click on the header -> { hidden, override }. Auto-folded: unfold for this note only, nothing saved.
// Reading with the override set (the person unfolded this note): a click only clears the override, it never writes hidden.
// Otherwise the explicit choice flips and a temporary override is dropped.
export function foldClick({ hidden, note, override = null }) {
  if (graphFold({ hidden, note, override }).folded) return { hidden, override: note };
  if (note && !hidden && override === note) return { hidden, override: null };
  return { hidden: !hidden, override: null };
}
