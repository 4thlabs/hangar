import type { SshKeyInfo } from "#libs/ssh";

/** The imported key as the page shows it: what it is, none, or a file Hangar cannot read. */
export type ImportedKey = SshKeyInfo | "unreadable" | null;
