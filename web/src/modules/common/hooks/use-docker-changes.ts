import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { getDockerChangesUrl, type DockerChange } from "#libs/api";
import { allDockerQueries, staleAfterDockerChange } from "#modules/common/api/docker-queries.ts";
import { useEventFeed } from "#modules/common/hooks/use-event-feed.ts";

/**
 * Reads again what the page shows of Docker when the server says it changed, rather than every so often. The feed is
 * closed while the tab is hidden, and connected again when it is lost; each time it opens, the first time included,
 * every read of Docker is made stale, as what changed before it opened is not in it.
 *
 * @returns Whether the feed is lost, and the page may be out of date until it is back.
 */
export function useDockerChanges() {
  const queryClient = useQueryClient();
  const invalidate = (queryKey: QueryKey) => void queryClient.invalidateQueries({ queryKey });

  const { isDown } = useEventFeed<DockerChange>(getDockerChangesUrl(), {
    // The first time too: a change between the page's first read and the feed's opening is in neither, and would
    // leave the page stale until the next one. Its price is a read again, which the server's cache answers.
    onOpen: () => invalidate(allDockerQueries),
    onItem: change => staleAfterDockerChange[change].forEach(invalidate),
  });

  return { isReconnecting: isDown };
}
