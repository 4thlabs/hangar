"use server";

import { ActionResult, SERVER_LOG_HINT } from "#app/actions/action-result.ts";
import { requireSession } from "#libs/auth";
import { HangarError } from "#libs/hangar";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";
import * as z from "zod";

/** `create` decides whether a rejected save deletes the whole folder: it must be a real boolean. */
const payloadSchema = z.object({ id: z.string(), source: z.string(), create: z.boolean() });

/**
 * Saves a store app's compose.yml, or adds a new app. `docker compose config` validates it first:
 * its complaint is the message the user needs, so it is shown as is.
 */
export const saveApp = async (id: string, source: string, create: boolean): Promise<ActionResult> => {
  await requireSession();

  const parsed = payloadSchema.safeParse({ id, source, create });

  if (!parsed.success) {
    logger.warn("Store app save rejected", { issues: parsed.error.issues });

    return ActionResult.failure("Requête invalide.");
  }

  try {
    await hangar.store.saveApp(parsed.data.id, parsed.data.source, parsed.data.create);

    return ActionResult.success(create ? `${id} a été ajoutée au store.` : `${id} a été enregistrée.`);
  } catch (error) {
    if (error instanceof HangarError) return ActionResult.failure(error.message);

    logger.error("Store app save failed", { error, id });

    return ActionResult.failure(`L’enregistrement de ${id} a échoué. ${SERVER_LOG_HINT}`);
  }
};
