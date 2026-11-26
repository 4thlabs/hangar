import { createFileRoute } from "@tanstack/react-router";
import { PendingPage } from "#modules/common/components/pending-page.tsx";

// Not moved here yet: a pending page until the issue of its area moves it.
export const Route = createFileRoute("/_app/cluster")({
  component: PendingPage,
});
