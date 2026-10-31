import { registration } from "#libs/auth/server";
import { ServerTranslation } from "#libs/i18n/server";
import { RegisterForm } from "#modules/auth/components/register-form";
import { RegistrationClosed } from "#modules/auth/components/registration-closed.tsx";
import { AuthMessages } from "#modules/auth/messages.ts";

export default async function RegisterPage() {
  const isOpen = await registration.isOpen();
  const { t } = ServerTranslation.get(AuthMessages);

  return (
    <>
      <title>{`${t("register.pageTitle")} | Hangar`}</title>
      {isOpen ? <RegisterForm /> : <RegistrationClosed />}
    </>
  );
}

// Dynamic: whether an account exists is only known at request time.
export const getConfig = async () => {
  return {
    render: "dynamic",
  } as const;
};
