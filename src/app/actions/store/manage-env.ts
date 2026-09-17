"use server";

import { ActionResult, SERVER_LOG_HINT } from "#app/actions/action-result.ts";
import { requireSession } from "#libs/auth";
import { hangar } from "#libs/hangar/server";
import { logger } from "#libs/logs";
import * as z from "zod";

/**
 * What the browser is allowed to put in .env.global. Everything here ends up in a file every
 * container reads, so a stray newline in a value is a way to inject a variable: validate at
 * the boundary, before the file is touched.
 */
const payloadSchema = z.object({
  updates: z.record(
    z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "nom de variable invalide"),
    z.string().refine(value => !/[\r\n]/.test(value), "une valeur ne peut pas contenir de retour à la ligne"),
  ),
  remove: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "nom de variable invalide")),
});

export type EnvPayload = z.infer<typeof payloadSchema>;

/**
 * Saves the global environment. The write itself reconciles with the file on disk, so a
 * variable added by hand since the page was rendered survives this save: only the names in
 * `remove` are dropped.
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
