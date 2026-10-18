/** The id of a store app: its folder name under `store/` (`llama.cpp`). */
export class AppId {
  /** No separator, no leading dot, nothing to climb out of a folder with */
  static readonly Pattern = /^[a-z0-9][a-z0-9._-]*$/;

  /** Whether `id` can name an app, and so a folder under `store/`, `app-data/` or `app-backups/`. */
  static isValid(id: string) {
    return AppId.Pattern.test(id);
  }
}
