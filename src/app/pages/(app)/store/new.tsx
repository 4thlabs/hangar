import { saveApp } from "#app/actions/store/manage-app.ts";
import { AppEditor } from "#app/components/store/app-editor.tsx";

/** What a store app needs for Hangar to list it: a name, an icon, a service with its container. */
const TEMPLATE = `name: Mon app
x-hangar:
  icon: https://cdn.jsdelivr.net/gh/selfhst/icons@main/webp/docker.webp
services:
  mon-app:
    image: nginx:latest
    container_name: mon-app
    restart: unless-stopped
`;

export default function NewAppPage() {
  return (
    <main>
      <title>Nouvelle app | Hangar</title>
      <h1 className="text-2xl font-semibold">Nouvelle app</h1>
      <AppEditor source={TEMPLATE} saveApp={saveApp} />
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
