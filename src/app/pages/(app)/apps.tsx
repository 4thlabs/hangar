import type { PageProps } from "waku/router";
import { AppsOverview } from "#app/components/apps/apps-overview.tsx";
import { PageSpinner } from "#app/components/common/page-spinner.tsx";
import { Warm } from "#app/components/common/warm.tsx";
import type { AppsSearch } from "#app/search-codecs.ts";
import { appsSearchCodec } from "#app/search-codecs.ts";
import { appsSnapshot } from "#app/snapshots.ts";
import type { ComposeProjectsSnapshot } from "#libs/docker";
import { logger } from "#libs/logs";

/**
 * The Docker half of the page, kept as a child so the `await` happens inside the boundary rather
 * than in the page itself — an async page component suspends its own route, which paints nothing
 * at all until the daemon answers.
 *
 * Renders synchronously when the snapshot is warm, and only then does `<Warm>` above leave the
 * boundary out. Both paths render the same rows because both come from `appsSnapshot`.
 *
 * Errors are caught and rendered, not rethrown: `AppsOverview` already knows how to show one
 * next to a Réessayer button, and the route error boundary would take the whole page down.
 */
function AppsContent({ search, ready }: { search: AppsSearch; ready: { data: ComposeProjectsSnapshot } | undefined }) {
  const show = (snapshot: ComposeProjectsSnapshot) => <AppsOverview snapshot={snapshot} error={null} search={search} />;

  if (ready) return show(ready.data);

  return (async () => {
    try {
      return show(await appsSnapshot.read());
    } catch (failure) {
      logger.error("Failed to render Docker Compose projects", { error: failure });

      return (
        <AppsOverview
          snapshot={null}
          error="Le daemon Docker est indisponible. Vérifiez le socket et ses permissions."
          search={search}
        />
      );
    }
  })();
}

export default function AppsPage({ search }: PageProps<"/apps">) {
  // Peeked once and shared: two peeks would be two chances to disagree about whether this render
  // is warm, and the boundary and its child must make that call the same way.
  const ready = appsSnapshot.peek();

  return (
    <main>
      {/* Outside the boundary, so the tab title changes on click rather than when Docker replies. */}
      <title>Apps | Hangar</title>
      {/* Keyed, because Waku renders the route slot unkeyed: the detail page has the same
          shape, so React would reuse this boundary and — a navigation being a transition —
          keep that page on screen rather than swap in the spinner. The key is constant: a
          search-param change must not remount the boundary and flash it. */}
      <Warm key="apps" ready={ready !== undefined} fallback={<PageSpinner />}>
        <AppsContent search={search} ready={ready} />
      </Warm>
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
    unstable_searchCodec: appsSearchCodec,
  } as const;
};
