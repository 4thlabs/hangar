"use server";

import { sessions } from "#libs/auth/server";
import { SshKeyError } from "#libs/ssh";
import { sshKeys } from "#libs/ssh/server";
import { ActionFailure } from "#modules/common/actions/action-failure.ts";
import { ActionResult } from "#modules/common/actions/action-result.ts";

/** Replaces the key the terminal signs in with. A file that holds no private key is refused, never written. */
export const importSshKey = async (source: string): Promise<ActionResult> => {
  await sessions.require();

  try {
    const key = await sshKeys.save(source);

    if (key.encrypted) {
      return ActionResult.success("Clé importée : sa phrase de passe sera demandée à chaque connexion.");
    }

    return ActionResult.success(`Clé ${key.type} importée.`);
  } catch (error) {
    if (error instanceof SshKeyError) {
      return ActionResult.failure("Ce fichier ne contient pas de clé privée SSH lisible.");
    }

    return ActionFailure.from(error, "SSH key import failed", "L’import de la clé a échoué.");
  }
};

/** Forgets the imported key: the terminal signs in with the account's password. */
export const removeSshKey = async (): Promise<ActionResult> => {
  await sessions.require();

  try {
    await sshKeys.remove();
  } catch (error) {
    return ActionFailure.from(error, "SSH key removal failed", "La suppression de la clé a échoué.");
  }

  return ActionResult.success("Clé supprimée : le terminal demandera le mot de passe.");
};
