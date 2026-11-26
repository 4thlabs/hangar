/** The memory an app's containers may take: their own limits, or the host's memory. */
export type AvailableMemory = { bytes: number; isHost: boolean };

/**
 * The memory an app's containers may take, from the limits their stats report: the sum of the containers' own limits,
 * at most the host's memory; the host's memory, once, when one has none of its own, as its stats then report the
 * host's memory as its limit. `null` before a container or the host has a reading.
 */
export function availableMemory(
  limits: readonly (number | null)[],
  hostMemory: number | undefined,
): AvailableMemory | null {
  if (limits.length === 0 || hostMemory === undefined) {
    return null;
  }

  const hasNoLimit = limits.some(limit => limit === null || limit >= hostMemory);
  const total = limits.reduce<number>((sum, limit) => sum + (limit ?? 0), 0);

  if (hasNoLimit || total >= hostMemory) {
    return { bytes: hostMemory, isHost: true };
  }

  return { bytes: total, isHost: false };
}
