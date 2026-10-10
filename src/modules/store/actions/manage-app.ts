"use server";

import * as z from "zod";
import { sessions } from "#libs/auth/server";
import { HangarError } from "#libs/hangar";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";
import { ActionResult, SERVER_LOG_HINT } from "#modules/common/actions/action-result.ts";

const payloadSchema = z.object({ id: z.string(), source: z.string() });

/** Adds a new store app. */
export const createApp = async (id: string, source: string): Promise<ActionResult> => {
  await sessions.require();

  return writeApp(id, source, {
    write: payload => hangar.store.createApp(payload.id, payload.source),
    success: appId => `${appId} a été ajoutée au store.`,
  });
};

/** Saves a store app's compose.yml. */
export const updateApp = async (id: string, source: string): Promise<ActionResult> => {
  await sessions.require();

  return writeApp(id, source, {
    write: payload => hangar.store.updateApp(payload.id, payload.source),
    success: appId => `${appId} a été enregistrée.`,
  });
};

type AppWrite = {
  /** The store call that writes the validated payload. */
  write: (payload: z.infer<typeof payloadSchema>) => Promise<void>;
  /** The message shown once it is written. */
  success: (id: string) => string;
};

/**
 * Validates the payload, runs the write, and turns its outcome into what the editor shows.
 * The store validates the file with `docker compose config`, whose complaint is shown to the user as is.
 */
async function writeApp(id: string, source: string, { write, success }: AppWrite): Promise<ActionResult> {
  const parsed = payloadSchema.safeParse({ id, source });

  if (!parsed.success) {
    logger.warn("Store app save rejected", { issues: parsed.error.issues });

    return ActionResult.failure("Requête invalide.");
  }

  try {
    await write(parsed.data);

    return ActionResult.success(success(parsed.data.id));
  } catch (error) {
    if (error instanceof HangarError) {
      return ActionResult.failure(error.message);
    }

    logger.error("Store app save failed", { error, id: parsed.data.id });

    return ActionResult.failure(`L’enregistrement de ${parsed.data.id} a échoué. ${SERVER_LOG_HINT}`);
  }
}
