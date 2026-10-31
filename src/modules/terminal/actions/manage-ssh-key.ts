"use server";

import { sessions } from "#libs/auth/server";
import { ServerTranslation } from "#libs/i18n/server";
import { SshKeyError } from "#libs/ssh";
import { sshKeys } from "#libs/ssh/server";
import { ActionFailure } from "#modules/common/actions/action-failure.ts";
import { ActionResult } from "#modules/common/actions/action-result.ts";
import { TerminalMessages } from "#modules/terminal/messages.ts";

/** Replaces the key the terminal signs in with. A file that holds no private key is refused, never written. */
export const importSshKey = async (source: string): Promise<ActionResult> => {
  await sessions.require();

  const { t } = ServerTranslation.get(TerminalMessages);

  try {
    const key = await sshKeys.save(source);

    if (key.encrypted) {
      return ActionResult.success(t("key.importedEncrypted"));
    }

    return ActionResult.success(t("key.importedMessage", { type: key.type }));
  } catch (error) {
    if (error instanceof SshKeyError) {
      return ActionResult.failure(t("key.notAKey"));
    }

    return ActionFailure.from(error, "SSH key import failed", t("key.importError"));
  }
};

/** Forgets the imported key: the terminal signs in with the account's password. */
export const removeSshKey = async (): Promise<ActionResult> => {
  await sessions.require();

  const { t } = ServerTranslation.get(TerminalMessages);

  try {
    await sshKeys.remove();
  } catch (error) {
    return ActionFailure.from(error, "SSH key removal failed", t("key.deleteError"));
  }

  return ActionResult.success(t("key.deletedMessage"));
};
