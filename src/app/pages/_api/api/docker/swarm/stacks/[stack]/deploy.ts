import type { ApiContext } from "waku/router";
import { hangar } from "#libs/hangar/server";
import { ServerTranslation } from "#libs/i18n/server";
import { logger } from "#libs/logs";
import { apiCommandStream, apiError, apiRoute } from "#app/api/api-route.ts";
import { ApiMessages } from "#app/api/messages.ts";
import { StackDeployment } from "#modules/cluster/stack-deployment.ts";

/** Streams `docker stack deploy` of a store app; the deploy outlives the request and notifies its end. */
export const POST = apiRoute<ApiContext<"/api/docker/swarm/stacks/[stack]/deploy">>(
  { log: "Swarm stack deploy stream failed to start", unavailable: "daemon" },
  async (_request, { params }, session) => {
    const { stack } = params;

    if (!hangar.store.isStackManageable(stack)) {
      logger.warn("Swarm stack deploy rejected: not a swarm-ready installed app", { stack });

      return apiError(ServerTranslation.get(ApiMessages).t("notSwarmReady", { stack }), 404);
    }

    // Its outcome is reported as a notification.
    return apiCommandStream(output => StackDeployment.run({ stack, userId: session.user.id, output }));
  },
);
