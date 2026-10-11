/**
 * How long a read of the swarm is reused. Short, because Docker emits no event for a task: only time
 * moves the task counts, so the page reloads at the same pace.
 */
export const SwarmRefreshMs = 10_000;
