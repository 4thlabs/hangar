import type { Translate } from "#libs/i18n";
import { ServerTranslation } from "#libs/i18n/server";
import { createApp } from "#modules/store/actions/manage-app.ts";
import { NewAppEditor } from "#modules/store/components/new-app-editor.tsx";
import { StoreMessages } from "#modules/store/messages.ts";

/** What a store app needs for Hangar to list it: a name, an icon, a service with its container. */
class NewAppTemplate {
  /** The compose.yml a new app starts from, named in the reader's language. */
  static create(t: Translate<typeof StoreMessages.en>) {
    const id = t("template.id");

    return `name: ${t("template.name")}
x-hangar:
  icon: https://cdn.jsdelivr.net/gh/selfhst/icons@main/webp/docker.webp
services:
  ${id}:
    image: nginx:latest
    container_name: ${id}
    restart: unless-stopped
`;
  }
}

export default function NewAppPage() {
  const { t } = ServerTranslation.get(StoreMessages);

  return (
    <main>
      <title>{`${t("newAppTitle")} | Hangar`}</title>
      <h1 className="text-2xl font-semibold">{t("newAppTitle")}</h1>
      <NewAppEditor source={NewAppTemplate.create(t)} create={createApp} />
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
