import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { type DockerChange, getDockerChangesUrl, ServerEvents } from "#libs/api";

/** The query keys each change of the daemon makes stale, by the start of their URL. */
class DockerQueries {
  /** Every query of the Docker routes. */
  static readonly All = "/api/docker/";

  static readonly ByChange: Readonly<Record<DockerChange, string>> = {
    // The projects, and each project's detail.
    containers: "/api/docker/apps",
    overview: "/api/docker/overview",
  };
}

/**
 * Reads again what the page shows of Docker when the server says the daemon changed it, rather than every so often.
 * The stream is closed while the tab is hidden; once it opens, at first or again, everything is read again, as what
 * changed before it is not in it.
 */
export function useDockerChanges() {
  const queryClient = useQueryClient();

  useEffect(() => {
    let stop: (() => void) | undefined;

    const invalidate = (prefix: string) =>
      void queryClient.invalidateQueries({
        predicate: query => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith(prefix),
      });

    const open = () => {
      stop ??= ServerEvents.follow<DockerChange>(getDockerChangesUrl(), {
        onOpen: () => invalidate(DockerQueries.All),
        onItem: change => invalidate(DockerQueries.ByChange[change]),
      });
    };

    const close = () => {
      stop?.();
      stop = undefined;
    };

    const sync = () => (document.hidden ? close() : open());

    sync();
    document.addEventListener("visibilitychange", sync);

    return () => {
      document.removeEventListener("visibilitychange", sync);
      close();
    };
  }, [queryClient]);
}
