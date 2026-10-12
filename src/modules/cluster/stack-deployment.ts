import type { Writable } from "node:stream";
import { finished } from "node:stream/promises";
import { swarm } from "#libs/docker/server";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";
import { notifications } from "#libs/notifications/server";
import { RepeatedLineFilter } from "#modules/cluster/repeated-line-filter.ts";
import { SERVER_LOG_HINT } from "#modules/common/actions/action-result.ts";
import { CommandStream } from "#modules/common/command-stream.ts";

type StackDeploymentRun = {
  /** The app to deploy, already checked with `HangarStore.isStackManageable`. */
  stack: string;
  /** Who gets a notification once the deploy is over. */
  userId: string;
  /** Where `docker stack deploy` writes, ended with the exit marker once it is done. */
  output: Writable;
};

/** `docker stack deploy` of a store app, its output streamed to /cluster: a first deploy and an update alike. */
export class StackDeployment {
  private static readonly Href = "/cluster";

  /**
   * Deploys the stack and files a notification with the outcome, which is what the user reads when
   * they closed the sheet. Never rejects: a failure is in the output and the notification.
   */
  static async run({ stack, userId, output }: StackDeploymentRun) {
    output.write(`$ docker stack deploy -c compose.yml -c compose.swarm.yml ${stack}\n`);

    const succeeded = await StackDeployment.deploy(stack, output);

    const outcome = succeeded
      ? { level: "success" as const, title: "Déploiement terminé", description: `${stack} est déployée sur le swarm.` }
      : {
          level: "error" as const,
          title: "Déploiement échoué",
          description: `Le déploiement de ${stack} sur le swarm a échoué. ${SERVER_LOG_HINT}`,
        };

    await notifications.notify({ userId, href: StackDeployment.Href, ...outcome });

    CommandStream.end(output, succeeded ? 0 : 1);
  }

  /** Resolves to whether the deploy went through. */
  private static async deploy(stack: string, output: Writable) {
    // Docker's progress, one line per refresh without a terminal, minus the repeats. Forwarded by hand,
    // not piped: once the page is closed the output is destroyed, and a pipe would then stop reading
    // Docker, which blocks the deploy on its own output.
    const progress = new RepeatedLineFilter();

    progress.on("data", (chunk: Buffer) => output.write(chunk));

    try {
      // A compose.swarm.yml added after the install may reference variables the install did not seed.
      await hangar.store.env.ensure(stack);
      // Settled before the marker, so the client's reload is served the new services.
      await hangar.store.stack(stack, ["deploy"], { pipe: progress }).finally(() => swarm.settle());

      return true;
    } catch (error) {
      logger.error("Swarm stack deploy failed", { error, stack });

      return false;
    } finally {
      progress.end();
      await finished(progress);
    }
  }
}
