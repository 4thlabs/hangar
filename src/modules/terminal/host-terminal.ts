import type { SpotlightShortcut } from "#modules/spotlight/spotlight.ts";

/** The navbar's terminal on the host. */
export class HostTerminal {
  /** Opens and closes the terminal from anywhere, as ⌘J or Ctrl+J toggles a code editor's panel. */
  static readonly Shortcut: SpotlightShortcut = { key: "j", mod: true };
}
