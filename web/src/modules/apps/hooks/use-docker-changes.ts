import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getDockerChangesUrl, keepEvents, type DockerChange } from "#libs/api";

/** The query keys each change of the daemon makes stale, by the start of their URL. */
class DockerQueries {
  /** Every query of the Docker routes. */
  static readonly All = "/api/docker/";

  static readonly ByChange: Readonly<Record<DockerChange, readonly string[]>> = {
    // The projects, each project's detail, and the compose batches, as one starts or ends.
    containers: ["/api/docker/apps", "/api/docker/compose"],
    overview: ["/api/docker/overview"],
  };
}

/**
 * Reads again what the page shows of Docker when the server says it changed, rather than every so often. The stream
 * is closed while the tab is hidden, and connected again when it is lost; each time it opens, the first time
 * included, everything is read again, as what changed before it opened is not in it.
 *
 * @returns Whether the stream is lost, and the page may be out of date until it is back.
 */
export function useDockerChanges() {
  const queryClient = useQueryClient();
  const [isReconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    let stop: (() => void) | undefined;

    const invalidate = (prefix: string) =>
      void queryClient.invalidateQueries({
        predicate: query => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith(prefix),
      });

    const open = () => {
      stop ??= keepEvents<DockerChange>(getDockerChangesUrl(), {
        onOpen: () => {
          setReconnecting(false);

          // The first time too: a change between the page's first read and the stream's opening is in neither, and
          // would leave the page stale until the next one. Its price is a read again, which the server's cache answers.
          invalidate(DockerQueries.All);
        },
        onDown: () => setReconnecting(true),
        onItem: change => DockerQueries.ByChange[change].forEach(invalidate),
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
