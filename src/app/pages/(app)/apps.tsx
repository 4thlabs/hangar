import { Suspense } from "react";
import type { PageProps } from "waku/router";
import { AppsContent } from "#modules/apps/components/apps-content.tsx";
import { appsSearchCodec } from "#modules/apps/search-codec.ts";
import { PageSpinner } from "#modules/common/components/page-spinner.tsx";

export default function AppsPage({ search }: PageProps<"/apps">) {
  return (
    <main>
      {/* Outside the boundary, so the tab title changes on click rather than when Docker replies. */}
      <title>Apps | Hangar</title>
      {/* Keyed, or Waku's unkeyed route slot reuses one boundary across routes. Constant, so a search-param change
          does not remount the boundary and flash it. Warm, the content renders inline and the spinner never shows. */}
      <Suspense key="apps" fallback={<PageSpinner />}>
        <AppsContent search={search} />
      </Suspense>
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
    unstable_searchCodec: appsSearchCodec,
  } as const;
};
