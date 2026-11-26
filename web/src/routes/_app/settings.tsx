import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "#modules/settings/components/settings-page.tsx";

export const Route = createFileRoute("/_app/settings")({
  component: SettingsPage,
});
