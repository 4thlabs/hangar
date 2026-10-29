/**
 * Whether Apps and Cluster list the store apps that are not installed. Remembered in a cookie, like the theme, so
 * the server renders the lists as the user left them.
 */
export class UninstalledApps {
  /** The cookie holding the choice: `1` shows them. */
  static readonly Cookie = "show_uninstalled";

  /** Hidden until the user asks for them. */
  static readonly DefaultShown = false;

  /** The choice a cookie value holds: `1` shows them, `0` hides them, no cookie leaves the default. */
  static parse(value: string | undefined) {
    if (value === undefined) {
      return UninstalledApps.DefaultShown;
    }

    return value === "1";
  }

  /** The cookie value for a choice. */
  static serialize(shown: boolean) {
    return shown ? "1" : "0";
  }
}
