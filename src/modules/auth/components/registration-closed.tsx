import { Link } from "waku";
import { ServerTranslation } from "#libs/i18n/server";
import { AuthMessages } from "#modules/auth/messages.ts";
import { buttonVariants } from "#modules/common/ui/button.tsx";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";

/** What /register shows once the first account exists: there is nothing left to sign up for. */
export function RegistrationClosed() {
  const { t } = ServerTranslation.get(AuthMessages);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{t("closed.title")}</CardTitle>
        <CardDescription>{t("closed.description")}</CardDescription>
      </CardHeader>
      <CardFooter>
        <Link to="/login" className={buttonVariants({ className: "w-full" })}>
          {t("closed.signIn")}
        </Link>
      </CardFooter>
    </Card>
  );
}
