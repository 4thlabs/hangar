"use server";

import * as z from "zod";
import { requireSession } from "#libs/auth";
import { HangarEnv } from "#libs/hangar";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";
import { ActionResult, SERVER_LOG_HINT } from "#modules/common/actions/action-result.ts";

const InvalidName = "nom de variable invalide";

const variableName = z.string().refine(name => HangarEnv.isVariableName(name), InvalidName);

/**
 * What the browser may put in .env.global. Every container reads that file, so a stray newline in a value
 * would inject a variable.
 */
const payloadSchema = z.object({
  updates: z.record(
    variableName,
    z.string().refine(value => !/[\r\n]/.test(value), "une valeur ne peut pas contenir de retour à la ligne"),
    // A bad key surfaces as zod's generic `invalid_key` issue, wrapping the refine's message.
    { error: issue => (issue.code === "invalid_key" ? InvalidName : undefined) },
  ),
  remove: z.array(variableName),
});

export type EnvPayload = z.infer<typeof payloadSchema>;

/**
 * Saves the global environment, reconciled with the file on disk: a variable added by hand since the page was
 * rendered survives, and only the names in `remove` are dropped.
 */
export const saveEnv = async (payload: EnvPayload): Promise<ActionResult> => {
  await requireSession();

  const parsed = payloadSchema.safeParse(payload);

  if (!parsed.success) {
    logger.warn("Global env save rejected", { issues: parsed.error.issues });

    return ActionResult.failure(parsed.error.issues[0]?.message ?? "Variables invalides.");
  }

  try {
    await hangar.store.env.write(parsed.data.updates, parsed.data.remove);

    return ActionResult.success("L’environnement global a été enregistré.");
  } catch (error) {
    logger.error("Global env save failed", { error });

    return ActionResult.failure(`L’enregistrement de l’environnement a échoué. ${SERVER_LOG_HINT}`);
  }
};
