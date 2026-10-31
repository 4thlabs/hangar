/** A compose run, as its notification carries it: `flags` comma-separated, as `AppCommands.query` writes them. */
export type ComposeRun = { project: string; operation: string; flags: string };

/** Nothing to say beyond the key. */
type NoParams = Record<string, never>;

/**
 * Every notification Hangar files, by key, with the parameters its words are built from. The words themselves are
 * the UI's (`NotificationMessages`): whoever files a notification, a job included, needs only this.
 */
export type NotificationParams = {
  updatesAvailable: { count: number };
  autoUpdate: { updated: number; failed: string };
  backupFailed: { app: string; error: string };
  backupRestartFailed: { app: string; services: string };
  composeSucceeded: ComposeRun;
  composeFailed: ComposeRun;
  stackDeployed: { stack: string };
  stackDeployFailed: { stack: string };
  storeInstalled: NoParams;
  storeUpdated: NoParams;
  storeInstallFailed: NoParams;
  storeUpdateFailed: NoParams;
};

/** A key of {@link NotificationParams}. */
export type NotificationKey = keyof NotificationParams;

/** What `Notifications.message` takes after the key: the parameters, or nothing for a key that has none. */
export type NotificationArguments<Key extends NotificationKey> = NotificationParams[Key] extends NoParams
  ? []
  : [params: NotificationParams[Key]];
