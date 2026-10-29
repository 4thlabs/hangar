import { atom } from "jotai";

/** Whether the palette is open, and the id of the source it is narrowed to, if any. */
export type SpotlightState = { open: boolean; scope: string | null };

/** Shared by the palette, its button and its shortcuts, which live in different parts of the navbar. */
export const spotlightAtom = atom<SpotlightState>({ open: false, scope: null });
