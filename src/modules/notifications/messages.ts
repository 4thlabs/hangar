import { Plural, Translation } from "#libs/i18n";
import type { ComposeRun, NotificationKey, NotificationParams } from "#libs/notifications";
import { AppCommands } from "#modules/apps/actions/app-operation.ts";
import { AppsMessages } from "#modules/apps/messages.ts";

/** What a notification says once rendered. */
export type NotificationWords = { title: string; description?: string };

/** The words of every notification, each built from the parameters `NotificationParams` gives its key. */
type NotificationCatalog = { [Key in NotificationKey]: (params: NotificationParams[Key]) => NotificationWords };

/**
 * What every notification Hangar files says, by key. Filed with `Notifications.message`, rendered with
 * `NotificationText.render` in the reader's language.
 */
export class NotificationMessages {
  static readonly en: NotificationCatalog = {
    updatesAvailable: ({ count }) => ({
      title: "Updates available",
      description: `${count} ${Plural.select("en", count, { one: "app has", other: "apps have" })} a newer image in the registry.`,
    }),
    autoUpdate: ({ updated, failed }) => ({
      title: "Automatic update",
      description:
        `${updated} ${Plural.select("en", updated, { one: "app was", other: "apps were" })} updated.` +
        (failed ? ` Failed for: ${failed}.` : ""),
    }),
    backupFailed: ({ app, error }) => ({
      title: "Backup failed",
      description: `The backup of ${app} failed: ${error}`,
    }),
    backupRestartFailed: ({ app, services }) => ({
      title: "App stopped",
      description: `${app} did not restart after its backup: ${services}.`,
    }),
    composeSucceeded: run => {
      const t = Translation.create(AppsMessages, "en");
      const command = NotificationMessages.command(run);

      return {
        title: `${AppCommands.label(command, t)} finished`,
        description: AppCommands.outcome(command, run.project, t),
      };
    },
    composeFailed: run => ({
      title: `${AppCommands.label(NotificationMessages.command(run), Translation.create(AppsMessages, "en"))} failed`,
      description: `The Docker Compose command failed for ${run.project}. See the server logs.`,
    }),
    stackDeployed: ({ stack }) => ({
      title: "Deployment finished",
      description: `${stack} is deployed on the swarm.`,
    }),
    stackDeployFailed: ({ stack }) => ({
      title: "Deployment failed",
      description: `The deployment of ${stack} on the swarm failed. See the server logs.`,
    }),
    storeInstalled: () => ({
      title: "Store: installation finished",
      description: "The store was installed.",
    }),
    storeUpdated: () => ({
      title: "Store: update finished",
      description: "The store was updated.",
    }),
    storeInstallFailed: () => ({
      title: "Store: installation failed",
      description: "The installation of the store failed. See the server logs.",
    }),
    storeUpdateFailed: () => ({
      title: "Store: update failed",
      description: "The update of the store failed. See the server logs.",
    }),
  };

  static readonly fr: NotificationCatalog = {
    updatesAvailable: ({ count }) => ({
      title: "Mises à jour disponibles",
      description: `${count} ${Plural.select("fr", count, { one: "application a", other: "applications ont" })} une image plus récente en registre.`,
    }),
    autoUpdate: ({ updated, failed }) => ({
      title: "Mise à jour automatique",
      description:
        `${updated} ${Plural.select("fr", updated, { one: "application a été mise", other: "applications ont été mises" })} à jour.` +
        (failed ? ` Échec pour : ${failed}.` : ""),
    }),
    backupFailed: ({ app, error }) => ({
      title: "Sauvegarde échouée",
      description: `La sauvegarde de ${app} a échoué : ${error}`,
    }),
    backupRestartFailed: ({ app, services }) => ({
      title: "Application arrêtée",
      description: `${app} n’a pas redémarré après sa sauvegarde : ${services}.`,
    }),
    composeSucceeded: run => {
      const t = Translation.create(AppsMessages, "fr");
      const command = NotificationMessages.command(run);

      return {
        title: `${AppCommands.label(command, t)} terminé`,
        description: AppCommands.outcome(command, run.project, t),
      };
    },
    composeFailed: run => ({
      title: `${AppCommands.label(NotificationMessages.command(run), Translation.create(AppsMessages, "fr"))} échoué`,
      description: `La commande Docker Compose a échoué pour ${run.project}. Consultez les logs du serveur.`,
    }),
    stackDeployed: ({ stack }) => ({
      title: "Déploiement terminé",
      description: `${stack} est déployée sur le swarm.`,
    }),
    stackDeployFailed: ({ stack }) => ({
      title: "Déploiement échoué",
      description: `Le déploiement de ${stack} sur le swarm a échoué. Consultez les logs du serveur.`,
    }),
    storeInstalled: () => ({
      title: "Store : installation terminée",
      description: "Le store a été installé.",
    }),
    storeUpdated: () => ({
      title: "Store : mise à jour terminée",
      description: "Le store a été mis à jour.",
    }),
    storeInstallFailed: () => ({
      title: "Store : installation échouée",
      description: "L’installation du store a échoué. Consultez les logs du serveur.",
    }),
    storeUpdateFailed: () => ({
      title: "Store : mise à jour échouée",
      description: "La mise à jour du store a échoué. Consultez les logs du serveur.",
    }),
  };

  /** The command a compose notification names; a plain `up` if the stored one no longer parses. */
  private static command(run: ComposeRun) {
    return AppCommands.parse(run.operation, run.flags) ?? AppCommands.create("up");
  }
}
