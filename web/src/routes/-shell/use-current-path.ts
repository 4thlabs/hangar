import { useRouterState } from "@tanstack/react-router";

/** The path the router shows, which the navigation lights its section from. */
export function useCurrentPath() {
  return useRouterState({ select: state => state.location.pathname });
}
