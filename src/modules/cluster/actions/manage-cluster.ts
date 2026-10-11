"use server";

import { sessions } from "#libs/auth/server";
import {
  SwarmNodeActions,
  SwarmRefusedError,
  type SwarmJoinCommands,
  type SwarmNodeAction,
  type SwarmRefusal,
} from "#libs/docker";
import { swarm } from "#libs/docker/server";
import { logger } from "#libs/logs";
import { ActionResult, SERVER_LOG_HINT } from "#modules/common/actions/action-result.ts";

/** A Swarm node id: 25 lowercase base-36 characters, but any plain word is passed on for the daemon to judge. */
const NodeId = /^[a-z0-9]{1,64}$/;

/** A `host`, `host:port`, `[ipv6]:port` or an interface name such as `eth0`. */
const Address = /^[\w.:[\]-]{1,255}$/;

/** A join token, as `docker swarm join-token` prints it. */
const JoinToken = /^SWMTKN-1-[\w-]{1,255}$/;

/** Why Hangar turned an action down, as the toast words it. */
const RefusalMessage: Record<SwarmRefusal, string> = {
  "already-done": "Ce nœud est déjà dans cet état.",
  "last-manager": "C'est le dernier manager du cluster : le rétrograder le laisserait sans manager.",
  "manager-not-removable": "Un manager ne peut pas être retiré : rétrogradez-le d'abord.",
  "node-not-down": "Seul un nœud injoignable peut être retiré : arrêtez-le, ou faites-lui quitter le swarm.",
  "unknown-node": "Ce nœud ne fait plus partie du cluster.",
};

/** What each action did, for the success toast. */
const SuccessMessage: Record<SwarmNodeAction, (hostname: string) => string> = {
  promote: hostname => `${hostname} est maintenant manager.`,
  demote: hostname => `${hostname} est maintenant worker.`,
  drain: hostname => `${hostname} est drainé : ses tâches partent sur les autres nœuds.`,
  activate: hostname => `${hostname} peut de nouveau recevoir des tâches.`,
  remove: hostname => `${hostname} a été retiré du cluster.`,
};

/** The join commands, only on success: they carry the tokens. */
export type JoinCommandsResult = ActionResult & { commands?: SwarmJoinCommands };

/**
 * The daemon's own words when it refused the request, which say what to fix (an address to choose,
 * a quorum to keep); `null` for a failure that is not a refusal.
 */
function daemonRefusal(error: unknown): string | null {
  const { statusCode, json } = error as { statusCode?: number; json?: { message?: string } };
  const isRefusal = statusCode !== undefined && statusCode >= 400 && statusCode < 600 && Boolean(json?.message);

  return isRefusal ? `Docker a refusé : ${json?.message}` : null;
}

/** A failed call as the toast words it, logged unless it was a refusal the user can act on. */
function failure(error: unknown, operation: string, context: Record<string, unknown> = {}): ActionResult {
  if (error instanceof SwarmRefusedError) {
    return ActionResult.failure(RefusalMessage[error.refusal]);
  }

  const refusal = daemonRefusal(error);

  if (refusal) {
    return ActionResult.failure(refusal);
  }

  logger.error(`Swarm ${operation} failed`, { error, ...context });

  return ActionResult.failure(`L'opération a échoué. ${SERVER_LOG_HINT}`);
}

/** Promotes, demotes, drains, reactivates or removes a node from its card on /cluster. */
export const changeSwarmNode = async (nodeId: string, hostname: string, action: string): Promise<ActionResult> => {
  await sessions.require();

  const isKnownAction = SwarmNodeActions.includes(action as SwarmNodeAction);

  if (!NodeId.test(nodeId) || !isKnownAction) {
    return ActionResult.failure("Action inconnue.");
  }

  try {
    await swarm.changeNode(nodeId, action as SwarmNodeAction);

    return ActionResult.success(SuccessMessage[action as SwarmNodeAction](hostname));
  } catch (error) {
    return failure(error, action, { nodeId });
  }
};

/** Makes this node the first manager of a new swarm. */
export const initSwarm = async (advertiseAddress: string): Promise<ActionResult> => {
  await sessions.require();

  const address = advertiseAddress.trim();

  if (address && !Address.test(address)) {
    return ActionResult.failure("Adresse invalide.");
  }

  try {
    await swarm.init(address || undefined);

    return ActionResult.success("Le cluster est créé : ce nœud en est le premier manager.");
  } catch (error) {
    return failure(error, "init");
  }
};

/** Joins an existing swarm with a token from one of its managers. */
export const joinSwarm = async (
  managerAddress: string,
  token: string,
  advertiseAddress: string,
): Promise<ActionResult> => {
  await sessions.require();

  const request = { managerAddress: managerAddress.trim(), token: token.trim(), advertise: advertiseAddress.trim() };
  const isAdvertiseValid = !request.advertise || Address.test(request.advertise);

  if (!Address.test(request.managerAddress) || !JoinToken.test(request.token) || !isAdvertiseValid) {
    return ActionResult.failure("Adresse ou token invalide : le token commence par SWMTKN-1-.");
  }

  try {
    await swarm.join({
      managerAddress: request.managerAddress,
      token: request.token,
      advertiseAddress: request.advertise || undefined,
    });

    return ActionResult.success("Ce nœud a rejoint le cluster.");
  } catch (error) {
    // Never the token in the log: it is a credential.
    return failure(error, "join", { managerAddress: request.managerAddress });
  }
};

/** The join commands, read only when someone asks to see them. */
export const revealJoinCommands = async (): Promise<JoinCommandsResult> => {
  await sessions.require();

  try {
    return { ...ActionResult.success("Commandes de jonction chargées."), commands: await swarm.joinCommands() };
  } catch (error) {
    return failure(error, "join-token read");
  }
};

/** Replaces the worker or manager join token, so the old one stops working. */
export const rotateJoinToken = async (role: string): Promise<ActionResult> => {
  await sessions.require();

  if (role !== "worker" && role !== "manager") {
    return ActionResult.failure("Rôle inconnu.");
  }

  try {
    await swarm.rotateToken(role);

    return ActionResult.success(`Le token ${role} a été régénéré : l'ancien ne fonctionne plus.`);
  } catch (error) {
    return failure(error, "token rotation", { role });
  }
};
