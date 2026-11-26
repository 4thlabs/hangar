import { Link } from "@tanstack/react-router";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { CommonMessages } from "#modules/common/messages.ts";
import { Button } from "#modules/common/ui/button.tsx";

/** What a path that is no page shows, inside the app's frame. */
export function NotFoundPage() {
  const { t } = useTranslation(CommonMessages);

  return (
    <main className="items-start">
      <h1 className="text-2xl font-semibold">{t("notFound.title")}</h1>
      <p className="text-muted-foreground">{t("notFound.description")}</p>
      <Button variant="outline" render={<Link to="/">{t("notFound.home")}</Link>} />
    </main>
  );
}
