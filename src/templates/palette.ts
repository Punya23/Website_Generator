import type { RecolorPalette } from "./types.js";

/** Named target palettes. `recolor-css.ts` remaps a source template's own colors onto whichever
 *  one is selected — see `templatePaletteId()` in `config.ts`. */
export const RECOLOR_PALETTES: Record<string, RecolorPalette> = {
  "all-black": {
    id: "all-black",
    name: "All black",
    // Lightest source background -> darkest slot here, preserving relative layering
    // (a template's "card sits on a slightly lighter panel" cue survives the recolor).
    backgroundRamp: ["#050505", "#0b0b0d", "#121214", "#1a1a1d", "#232326"],
    textOnDark: "#f5f5f4",
    textOnLight: "#0a0a0a",
    mutedOnDark: "#a3a3a3",
    mutedOnLight: "#525252",
    accentMinLightness: 0.45,
    accentMaxLightness: 0.72,
    borderOnDark: "#2a2a2e",
    borderOnLight: "#d4d4d4",
  },
};

export function getPalette(id: string): RecolorPalette {
  return RECOLOR_PALETTES[id] ?? RECOLOR_PALETTES["all-black"]!;
}
