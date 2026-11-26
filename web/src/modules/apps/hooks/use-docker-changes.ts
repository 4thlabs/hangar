import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getDockerChangesUrl, ServerEvents, type DockerChange } from "#libs/api";

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
 * Reads again what the page shows of Docker when the server says it changed, rather than every so often. The stream
 * is closed while the tab is hidden, and connected again when it is lost; once it opens again, everything is read
 * again, as what changed meanwhile is not in it. The first time it opens, the page's queries have just been read.
 *
 * @returns Whether the stream is lost, and the page may be out of date until it is back.
 */
export function useDockerChanges() {
  const queryClient = useQueryClient();
  const [isReconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let hasOpened = false;

    const invalidate = (prefix: string) =>
      void queryClient.invalidateQueries({
        predicate: query => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith(prefix),
      });

    const open = () => {
      stop ??= ServerEvents.keep<DockerChange>(getDockerChangesUrl(), {
        onOpen: () => {
          setReconnecting(false);

          if (hasOpened) {
            invalidate(DockerQueries.All);
          }

          hasOpened = true;
        },
        onDown: () => setReconnecting(true),
        onItem: change => invalidate(DockerQueries.ByChange[change]),
      });
    };

    const close = () => {
      stop?.();
      stop = undefined;
      setReconnecting(false);
    };

    const sync = () => (document.hidden ? close() : open());

    sync();
    document.addEventListener("visibilitychange", sync);

    return () => {
      document.removeEventListener("visibilitychange", sync);
      close();
    };
  }, [queryClient]);

  return { isReconnecting };
}
