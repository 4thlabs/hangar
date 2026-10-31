import { registration } from "#libs/auth/server";
import { ServerTranslation } from "#libs/i18n/server";
import { LoginForm } from "#modules/auth/components/login-form";
import { AuthMessages } from "#modules/auth/messages.ts";

export default async function LoginPage() {
  const registrationOpen = await registration.isOpen();
  const { t } = ServerTranslation.get(AuthMessages);

  return (
    <>
      <title>{`${t("login.pageTitle")} | Hangar`}</title>
      <LoginForm registrationOpen={registrationOpen} />
    </>
  );
}

// Dynamic: the sign-up link depends on whether an account exists yet.
export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
