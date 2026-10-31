import { ServerTranslation } from "#libs/i18n/server";
import { AppearanceSettingsCard } from "#modules/settings/components/appearance-settings-card.tsx";
import { SettingsMessages } from "#modules/settings/messages.ts";

export default function UserSettingsPage() {
  const { t } = ServerTranslation.get(SettingsMessages);

  return (
    <main>
      <title>{`${t("userPage.title")} | Hangar`}</title>
      <div>
        <h1 className="text-2xl font-semibold">{t("userPage.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("userPage.description")}</p>
      </div>
      <AppearanceSettingsCard />
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
