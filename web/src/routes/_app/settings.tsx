import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "#modules/settings/components/settings-page.tsx";

/** `/settings`, its tab in the hash. */
export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});
