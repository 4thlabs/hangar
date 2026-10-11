import { Suspense } from "react";
import type { PageProps } from "waku/router";
import { ClusterContent } from "#modules/cluster/components/cluster-content.tsx";
import { ClusterSearch } from "#modules/cluster/search.ts";
import { PageSpinner } from "#modules/common/components/page-spinner.tsx";

export default function ClusterPage({ search }: PageProps<"/cluster">) {
  return (
    <main>
      {/* Outside the boundary, so the tab title changes on click rather than when Docker replies. */}
      <title>Cluster | Hangar</title>
      {/* Keyed, or Waku's unkeyed route slot reuses one boundary across routes. */}
      <Suspense key="cluster" fallback={<PageSpinner />}>
        <ClusterContent search={search} />
      </Suspense>
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
    unstable_searchCodec: ClusterSearch.Codec,
  } as const;
};
