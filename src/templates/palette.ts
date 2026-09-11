import { colord } from "colord";
import type { RecolorPalette } from "./types.js";

/** Named target palettes. `recolor-css.ts` remaps a source template's own colors onto whichever
 *  one is selected — see `templatePaletteId()` in `config.ts` for the corpus-wide ingest default,
 *  and `getPalette()` below for per-site overrides (the preview color picker). */
export const RECOLOR_PALETTES: Record<string, RecolorPalette> = {
  "all-black": {
    id: "all-black",
    name: "Midnight",
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
  ocean: {
    id: "ocean",
    name: "Ocean",
    backgroundRamp: ["#040810", "#081020", "#0e1a30", "#16274a", "#203968"],
    textOnDark: "#eef4fc",
    textOnLight: "#08111f",
    mutedOnDark: "#9db4d6",
    mutedOnLight: "#3f5578",
    accentMinLightness: 0.5,
    accentMaxLightness: 0.72,
    borderOnDark: "#233a5c",
    borderOnLight: "#c7d6ec",
  },
  forest: {
    id: "forest",
    name: "Forest",
    backgroundRamp: ["#040a06", "#08130c", "#0f2016", "#173224", "#224835"],
    textOnDark: "#eef8f0",
    textOnLight: "#08150d",
    mutedOnDark: "#a3c2ae",
    mutedOnLight: "#3c5b47",
    accentMinLightness: 0.45,
    accentMaxLightness: 0.68,
    borderOnDark: "#274a37",
    borderOnLight: "#c9e0d0",
  },
  sunset: {
    id: "sunset",
    name: "Sunset",
    backgroundRamp: ["#0b0705", "#160b08", "#28130d", "#3f1d12", "#5c2a18"],
    textOnDark: "#fdf3ee",
    textOnLight: "#1c0d07",
    mutedOnDark: "#dcb3a2",
    mutedOnLight: "#6b4436",
    accentMinLightness: 0.5,
    accentMaxLightness: 0.74,
    borderOnDark: "#4a2a1c",
    borderOnLight: "#ecd2c4",
  },
  royal: {
    id: "royal",
    name: "Royal",
    backgroundRamp: ["#08050f", "#100a1e", "#1c1233", "#2b1c4e", "#3d2970"],
    textOnDark: "#f4f0fb",
    textOnLight: "#12081f",
    mutedOnDark: "#c0aee0",
    mutedOnLight: "#4f3b73",
    accentMinLightness: 0.5,
    accentMaxLightness: 0.75,
    borderOnDark: "#3a2a5c",
    borderOnLight: "#dccff0",
  },
  slate: {
    id: "slate",
    name: "Slate",
    backgroundRamp: ["#08090a", "#101214", "#191c1f", "#25282c", "#33373c"],
    textOnDark: "#f2f4f5",
    textOnLight: "#0b0d0e",
    mutedOnDark: "#a9b0b6",
    mutedOnLight: "#4a5158",
    accentMinLightness: 0.5,
    accentMaxLightness: 0.72,
    borderOnDark: "#3a3f45",
    borderOnLight: "#d6dade",
  },
};

/** A user-chosen brand color, not one of the named presets — built on Midnight's neutral ramp
 *  (this corpus's best-tuned dark scale) with every template's accent forced onto the chosen hue
 *  instead of kept as each template's own. `getPalette` resolves the `custom:#rrggbb` id this
 *  produces back into one of these on every recompose. */
export function customPalette(accentHex: string): RecolorPalette {
  const base = RECOLOR_PALETTES["all-black"]!;
  const hex = colord(accentHex).isValid() ? colord(accentHex).toHex() : "#6366f1";
  return { ...base, id: `custom:${hex}`, name: "Custom", accentColor: hex };
}

export function getPalette(id: string): RecolorPalette {
  if (id.startsWith("custom:")) return customPalette(id.slice("custom:".length));
  return RECOLOR_PALETTES[id] ?? RECOLOR_PALETTES["all-black"]!;
}
