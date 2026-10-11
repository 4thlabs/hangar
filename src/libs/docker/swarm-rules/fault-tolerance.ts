/**
 * How many managers can fail before the rest no longer form a majority, and the cluster its quorum.
 * @param managers How many managers the cluster has
 */
export function faultTolerance(managers: number) {
  return Math.max(0, Math.floor((managers - 1) / 2));
}
