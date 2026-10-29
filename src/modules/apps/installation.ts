/** A row of Apps or Cluster: an installed app or a stack, or a store app not installed, marked `installed: false`. */
type InstallableRow = { installed?: boolean | undefined };

/** Tells the rows of a store app not installed apart, on Apps and Cluster alike. */
export class AppInstallation {
  /** Whether the row is installed, or not a store app at all; only `installed: false` says otherwise. */
  static isInstalled(row: InstallableRow) {
    return row.installed !== false;
  }
}
