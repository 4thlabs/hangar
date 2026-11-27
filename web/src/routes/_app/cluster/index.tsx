import { createFileRoute } from "@tanstack/react-router";
import { PendingPage } from "#routes/_app/-pending-page.tsx";

/** `/cluster`, not moved to this server yet: a pending page until the issue of its area moves it. */
export const Route = createFileRoute("/_app/cluster/")({
  component: PendingPage,
});
