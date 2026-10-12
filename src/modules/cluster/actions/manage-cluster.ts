"use server";

import * as z from "zod";
import { sessions } from "#libs/auth/server";
import type { SwarmJoinCommands, SwarmNodeLabelChanges } from "#libs/docker";
import { swarm } from "#libs/docker/server";
import { SwarmRules } from "#libs/docker/swarm-rules";
import { logger } from "#libs/logs";
import { SwarmFailure } from "#modules/cluster/actions/swarm-failure.ts";
import { SwarmInput } from "#modules/cluster/actions/swarm-input.ts";
import { ClusterLabels } from "#modules/cluster/labels.ts";
import { ActionResult, type ReadResult } from "#modules/common/actions/action-result.ts";

/**
 * Promotes, demotes, drains, reactivates or removes a node from its card on /cluster. An unknown node
 * id is the library's to refuse: it looks the id up in the daemon's own list.
 */
export const changeSwarmNode = async (nodeId: string, hostname: string, action: string): Promise<ActionResult> => {
  await sessions.require();

  if (!SwarmRules.isNodeAction(action)) {
    return ActionResult.failure("Action inconnue.");
  }

  try {
    await swarm.changeNode(nodeId, action);

    return ActionResult.success(ClusterLabels.NodeActionDone[action](hostname));
  } catch (error) {
    return SwarmFailure.from(error, `Swarm ${action} failed`, { nodeId });
  }
};

/** What the labels dialog may send, checked with the same rules it applies as you type. */
const labelChangesSchema = z.object({
  set: z.record(
    z.string().refine(key => SwarmRules.isLabelKey(key)),
    z.string().refine(value => SwarmRules.isLabelValue(value)),
  ),
  remove: z.array(z.string()),
});

/** Adds, changes and drops the labels of a node from its card on /cluster. */
export const changeSwarmNodeLabels = async (
  nodeId: string,
  hostname: string,
  changes: SwarmNodeLabelChanges,
): Promise<ActionResult> => {
  await sessions.require();

  const parsed = labelChangesSchema.safeParse(changes);

  if (!parsed.success) {
    logger.warn("Swarm node labels rejected", { nodeId, issues: parsed.error.issues });

    return ActionResult.failure(ClusterLabels.InvalidLabel);
  }

  try {
    await swarm.changeNodeLabels(nodeId, parsed.data);

    return ActionResult.success(`Labels de ${hostname} enregistrés.`);
  } catch (error) {
    return SwarmFailure.from(error, "Swarm node labels failed", { nodeId });
  }
};

/** Makes this node the first manager of a new swarm. */
export const initSwarm = async (advertiseAddress: string): Promise<ActionResult> => {
  await sessions.require();

  const address = advertiseAddress.trim();

  if (address && !SwarmInput.isAddress(address)) {
    return ActionResult.failure("Adresse invalide.");
  }

  try {
    await swarm.init(address || undefined);

    return ActionResult.success("Le cluster est créé : ce nœud en est le premier manager.");
  } catch (error) {
    return SwarmFailure.from(error, "Swarm init failed");
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
    SwarmInput.isAddress(request.managerAddress) &&
    SwarmInput.isJoinToken(request.token) &&
    (request.advertiseAddress === undefined || SwarmInput.isAddress(request.advertiseAddress));

  if (!isValid) {
    return ActionResult.failure("Adresse ou token invalide : le token commence par SWMTKN-1-.");
  }

  try {
    await swarm.join(request);

    return ActionResult.success("Ce nœud a rejoint le cluster.");
  } catch (error) {
    // Never the token in the log: it is a credential.
    return SwarmFailure.from(error, "Swarm join failed", { managerAddress: request.managerAddress });
  }
};

/** The join commands, read only when someone asks to see them. */
export const revealJoinCommands = async (): Promise<ReadResult<SwarmJoinCommands>> => {
  await sessions.require();

  try {
    return { success: true, value: await swarm.joinCommands() };
  } catch (error) {
    const { message } = SwarmFailure.from(error, "Swarm join-token read failed");

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
    return SwarmFailure.from(error, "Swarm token rotation failed", { role });
  }
};
