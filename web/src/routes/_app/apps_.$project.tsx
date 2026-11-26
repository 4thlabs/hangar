import { createFileRoute } from "@tanstack/react-router";
import { AppDetailPage } from "#modules/apps/components/app-detail-page.tsx";

/**
 * `/apps/$project`, one app: its containers, its logs and its compose operations. `apps_`: a page of its own beside
 * the list at `/apps`, not a child rendered inside it.
 */
export const Route = createFileRoute("/_app/apps_/$project")({
  component: AppDetailPage,
});
