import { ThemeSettingsCard } from "#app/components/settings/theme-settings-card.tsx";

export default function UserSettingsPage() {
  return (
    <main>
      <title>Paramètres utilisateur | Hangar</title>
      <div>
        <h1 className="text-2xl font-semibold">Paramètres utilisateur</h1>
        <p className="text-sm text-muted-foreground">Personnalisez votre expérience dans Hangar.</p>
      </div>
      <ThemeSettingsCard />
    </main>
  );
}

export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
