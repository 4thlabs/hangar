"use server";

import { sessions } from "#libs/auth/server";
import { SwarmNodeActions, type SwarmJoinCommands, type SwarmNodeAction } from "#libs/docker";
import { swarm } from "#libs/docker/server";
import { swarmFailure } from "#modules/cluster/actions/swarm-failure.ts";
import { ActionResult, type ReadResult } from "#modules/common/actions/action-result.ts";

/** A `host`, `host:port`, `[ipv6]:port` or an interface name such as `eth0`. */
const Address = /^[\w.:[\]-]{1,255}$/;

/** A join token, as `docker swarm join-token` prints it. */
const JoinToken = /^SWMTKN-1-[\w-]{1,255}$/;

/** What each action did, for the success toast. */
const SuccessMessage: Record<SwarmNodeAction, (hostname: string) => string> = {
  promote: hostname => `${hostname} est maintenant manager.`,
  demote: hostname => `${hostname} est maintenant worker.`,
  drain: hostname => `${hostname} est drainé : ses tâches partent sur les autres nœuds.`,
  activate: hostname => `${hostname} peut de nouveau recevoir des tâches.`,
  remove: hostname => `${hostname} a été retiré du cluster.`,
};

const isNodeAction = (action: string): action is SwarmNodeAction =>
  (SwarmNodeActions as readonly string[]).includes(action);

/**
 * Promotes, demotes, drains, reactivates or removes a node from its card on /cluster. An unknown node
 * id is the library's to refuse: it looks the id up in the daemon's own list.
 */
export const changeSwarmNode = async (nodeId: string, hostname: string, action: string): Promise<ActionResult> => {
  await sessions.require();

  if (!isNodeAction(action)) {
    return ActionResult.failure("Action inconnue.");
  }

  try {
    await swarm.changeNode(nodeId, action);

    return ActionResult.success(SuccessMessage[action](hostname));
  } catch (error) {
    return swarmFailure(error, `Swarm ${action} failed`, { nodeId });
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
    return swarmFailure(error, "Swarm init failed");
  }
};

/** Joins an existing swarm with a token from one of its managers. */
export const joinSwarm = async (
  managerAddress: string,
  token: string,
  advertiseAddress: string,
): Promise<ActionResult> => {
  await sessions.require();

  const request = {
    managerAddress: managerAddress.trim(),
    token: token.trim(),
    advertiseAddress: advertiseAddress.trim() || undefined,
  };

  const isValid =
    Address.test(request.managerAddress) &&
    JoinToken.test(request.token) &&
    (request.advertiseAddress === undefined || Address.test(request.advertiseAddress));

  if (!isValid) {
    return ActionResult.failure("Adresse ou token invalide : le token commence par SWMTKN-1-.");
  }

  try {
    await swarm.join(request);

    return ActionResult.success("Ce nœud a rejoint le cluster.");
  } catch (error) {
    // Never the token in the log: it is a credential.
    return swarmFailure(error, "Swarm join failed", { managerAddress: request.managerAddress });
  }
};

/** The join commands, read only when someone asks to see them. */
export const revealJoinCommands = async (): Promise<ReadResult<SwarmJoinCommands>> => {
  await sessions.require();

  try {
    return { success: true, value: await swarm.joinCommands() };
  } catch (error) {
    const { message } = swarmFailure(error, "Swarm join-token read failed");

    return { success: false, message };
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
    return swarmFailure(error, "Swarm token rotation failed", { role });
  }
};
