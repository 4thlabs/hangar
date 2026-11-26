import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "#modules/widgets/components/dashboard-page.tsx";

export const Route = createFileRoute("/_app/")({
  component: DashboardPage,
});
