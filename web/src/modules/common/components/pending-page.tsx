import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { CommonMessages } from "#modules/common/messages.ts";

/** A section of the navigation whose page is not on the Rust server yet: the issue of its area moves it here. */
export function PendingPage() {
  const { t } = useTranslation(CommonMessages);

  return (
    <main>
      <h1 className="text-2xl font-semibold">{t("pending.title")}</h1>
      <p className="text-muted-foreground">{t("pending.description")}</p>
    </main>
  );
}
