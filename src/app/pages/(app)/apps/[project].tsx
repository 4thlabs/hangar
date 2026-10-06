import { Suspense } from "react";
import type { PageProps } from "waku/router";
import { AppDetailContent } from "#modules/apps/components/app-detail-content.tsx";
import { PageSpinner } from "#modules/common/components/page-spinner.tsx";

export default function AppDetailPage({ project }: PageProps<"/apps/[project]">) {
  return (
    <main>
      {/* Outside the boundary, so the tab title changes on click rather than when Docker replies. */}
      <title>{`${project} | Apps | Hangar`}</title>
      {/* Keyed by the project, so every arrival gets a new boundary rather than reusing the route slot's. */}
      <Suspense key={project} fallback={<PageSpinner />}>
        <AppDetailContent project={project} />
      </Suspense>
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
