import type { PageProps } from "waku/router";
import { AppsContent } from "#modules/apps/components/apps-content.tsx";
import { PageSpinner } from "#modules/common/components/page-spinner.tsx";
import { Warm } from "#modules/common/components/warm.tsx";
import { appsSearchCodec } from "#modules/apps/search-codec.ts";
import { appsSnapshot } from "#modules/apps/snapshots.ts";

export default function AppsPage({ search }: PageProps<"/apps">) {
  return (
    <main>
      {/* Outside the boundary, so the tab title changes on click rather than when Docker replies. */}
      <title>Apps | Hangar</title>
      {/* Keyed, because Waku renders the route slot unkeyed: the detail page has the same
          shape, so React would reuse this boundary and — a navigation being a transition —
          keep that page on screen rather than swap in the spinner. The key is constant: a
          search-param change must not remount the boundary and flash it. */}
      <Warm key="apps" ready={appsSnapshot.peek() !== undefined} fallback={<PageSpinner />}>
        <AppsContent search={search} />
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
