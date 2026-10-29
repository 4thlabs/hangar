/** The id of a store app: its folder name under `store/` (`llama.cpp`), and its URL segment under `/apps`. */
export class AppId {
  /** No separator, no leading dot, nothing to climb out of a folder with */
  static readonly Pattern = /^[a-z0-9][a-z0-9._-]*$/;

  /** Ids taken by a page under `/apps`: an app named `new` would be hidden behind `/apps/new`. */
  static readonly Reserved: readonly string[] = ["new"];

  /** Whether `id` can name an app, and so a folder under `store/`, `app-data/` or `app-backups/`. */
  static isValid(id: string) {
    return AppId.Pattern.test(id) && !AppId.isReserved(id);
  }

  /** Whether `id` is one of the {@link AppId.Reserved} ids. */
  static isReserved(id: string) {
    return AppId.Reserved.includes(id);
  }
}
