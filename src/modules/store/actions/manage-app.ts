"use server";

import * as z from "zod";
import { sessions } from "#libs/auth/server";
import { HangarError } from "#libs/hangar";
import { hangar } from "#libs/hangar/server";
import type { Translate } from "#libs/i18n";
import { ServerTranslation } from "#libs/i18n/server";
import { logger } from "#libs/logs";
import { ActionFailure } from "#modules/common/actions/action-failure.ts";
import { ActionResult } from "#modules/common/actions/action-result.ts";
import { StoreMessages } from "#modules/store/messages.ts";

/** A read of one app file: its content when it succeeded, why not otherwise. */
export type AppFileResult = { success: true; source: string } | { success: false; message: string };

/** A save of one app file, and whether it wrote the app's compose file, whatever path led to it. */
export type SaveAppFileResult = ActionResult & { composeChanged: boolean };

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
      success: (payload, t) => t("actions.appCreated", { id: payload.id }),
    },
  );
};

/** Saves one file of a store app, creating it when missing. */
export const saveAppFile = async (id: string, relativePath: string, source: string): Promise<SaveAppFileResult> => {
  await sessions.require();

  // Stays false unless the write goes through: a refused save changed nothing.
  let composeChanged = false;

  const result = await writeApp(
    filePayloadSchema,
    { id, relativePath, source },
    {
      write: async payload => {
        const appFiles = await hangar.store.files(payload.id);

        ({ composeChanged } = await appFiles.write(payload.relativePath, payload.source));
      },
      success: (payload, t) => t("actions.fileSaved", { path: payload.relativePath }),
    },
  );

  return { ...result, composeChanged };
};

/** Creates an empty file in a store app; an existing path, whatever it holds, is refused. */
export const createAppFile = async (id: string, relativePath: string): Promise<ActionResult> => {
  await sessions.require();

  return writeApp(
    filePathSchema,
    { id, relativePath },
    {
      write: async payload => {
        const appFiles = await hangar.store.files(payload.id);

        await appFiles.create(payload.relativePath);
      },
      success: (payload, t) => t("actions.fileCreated", { path: payload.relativePath }),
    },
  );
};

/** Reads one file of a store app, for the editor to open. */
export const readAppFile = async (id: string, relativePath: string): Promise<AppFileResult> => {
  await sessions.require();

  const { t } = ServerTranslation.get(StoreMessages);
  const parsed = filePathSchema.safeParse({ id, relativePath });

  if (!parsed.success) {
    logger.warn("Store app file read rejected", { issues: parsed.error.issues });

    return { success: false, message: t("actions.invalidRequest") };
  }

  try {
    const appFiles = await hangar.store.files(parsed.data.id);

    return { success: true, source: await appFiles.read(parsed.data.relativePath) };
  } catch (error) {
    if (error instanceof HangarError) {
      return { success: false, message: error.message };
    }

    logger.error("Store app file read failed", { error, ...parsed.data });

    return {
      success: false,
      message: ActionFailure.withLogHint(t("actions.readFailed", { path: parsed.data.relativePath })),
    };
  }
};

type AppWrite<Payload> = {
  /** The store call that writes the validated payload. */
  write: (payload: Payload) => Promise<void>;
  /** The message shown once it is written, in the reader's language. */
  success: (payload: Payload, t: Translate<typeof StoreMessages.en>) => string;
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
  const { t } = ServerTranslation.get(StoreMessages);
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    logger.warn("Store app save rejected", { issues: parsed.error.issues });

    return ActionResult.failure(t("actions.invalidRequest"));
  }

  try {
    await write(parsed.data);

    return ActionResult.success(success(parsed.data, t));
  } catch (error) {
    if (error instanceof HangarError) {
      return ActionResult.failure(error.message);
    }

    logger.error("Store app save failed", { error, id: parsed.data.id });

    return ActionResult.failure(ActionFailure.withLogHint(t("actions.saveFailed", { id: parsed.data.id })));
  }
}
