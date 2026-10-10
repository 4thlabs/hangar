"use server";

import * as z from "zod";
import { sessions } from "#libs/auth/server";
import { HangarError } from "#libs/hangar";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";
import { ActionResult, SERVER_LOG_HINT } from "#modules/common/actions/action-result.ts";

/** A read of one app file: its content when it succeeded, why not otherwise. */
export type AppFileResult = { success: true; source: string } | { success: false; message: string };

const payloadSchema = z.object({ id: z.string(), source: z.string() });
const filePathSchema = z.object({ id: z.string(), relativePath: z.string() });
const filePayloadSchema = filePathSchema.extend({ source: z.string() });

/** Adds a new store app. */
export const createApp = async (id: string, source: string): Promise<ActionResult> => {
  await sessions.require();

  return writeApp(
    payloadSchema,
    { id, source },
    {
      write: payload => hangar.store.createApp(payload.id, payload.source),
      success: payload => `${payload.id} a été ajoutée au store.`,
    },
  );
};

/** Saves one file of a store app, creating it when missing. */
export const saveAppFile = async (id: string, relativePath: string, source: string): Promise<ActionResult> => {
  await sessions.require();

  return writeApp(
    filePayloadSchema,
    { id, relativePath, source },
    {
      write: payload => hangar.store.writeAppFile(payload.id, payload.relativePath, payload.source),
      success: payload => `${payload.relativePath} a été enregistré.`,
    },
  );
};

/** Creates an empty file in a store app; an existing path, whatever it holds, is refused. */
export const createAppFile = async (id: string, relativePath: string): Promise<ActionResult> => {
  await sessions.require();

  return writeApp(
    filePathSchema,
    { id, relativePath },
    {
      write: payload => hangar.store.createAppFile(payload.id, payload.relativePath),
      success: payload => `${payload.relativePath} a été créé.`,
    },
  );
};

/** Reads one file of a store app, for the editor to open. */
export const readAppFile = async (id: string, relativePath: string): Promise<AppFileResult> => {
  await sessions.require();

  const parsed = filePathSchema.safeParse({ id, relativePath });

  if (!parsed.success) {
    logger.warn("Store app file read rejected", { issues: parsed.error.issues });

    return { success: false, message: "Requête invalide." };
  }

  try {
    return { success: true, source: await hangar.store.appFile(parsed.data.id, parsed.data.relativePath) };
  } catch (error) {
    if (error instanceof HangarError) {
      return { success: false, message: error.message };
    }

    logger.error("Store app file read failed", { error, ...parsed.data });

    return { success: false, message: `La lecture de ${parsed.data.relativePath} a échoué. ${SERVER_LOG_HINT}` };
  }
};

type AppWrite<Payload> = {
  /** The store call that writes the validated payload. */
  write: (payload: Payload) => Promise<void>;
  /** The message shown once it is written. */
  success: (payload: Payload) => string;
};

/**
 * Validates the payload, runs the write, and turns its outcome into what the editor shows.
 * The store validates the file (`docker compose config`, a YAML or env parse), whose complaint is shown to the
 * user as is.
 */
async function writeApp<Payload extends { id: string }>(
  schema: z.ZodType<Payload>,
  input: Payload,
  { write, success }: AppWrite<Payload>,
): Promise<ActionResult> {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    logger.warn("Store app save rejected", { issues: parsed.error.issues });

    return ActionResult.failure("Requête invalide.");
  }

  try {
    await write(parsed.data);

    return ActionResult.success(success(parsed.data));
  } catch (error) {
    if (error instanceof HangarError) {
      return ActionResult.failure(error.message);
    }

    logger.error("Store app save failed", { error, id: parsed.data.id });

    return ActionResult.failure(`L’enregistrement de ${parsed.data.id} a échoué. ${SERVER_LOG_HINT}`);
  }
}
