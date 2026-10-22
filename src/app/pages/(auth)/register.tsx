import { registration } from "#libs/auth/server";
import { RegisterForm } from "#modules/auth/components/register-form";
import { RegistrationClosed } from "#modules/auth/components/registration-closed.tsx";

export default async function RegisterPage() {
  const isOpen = await registration.isOpen();

  return (
    <>
      <title>Create account | Hangar</title>
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
