import { registration } from "#libs/auth/server";
import { LoginForm } from "#modules/auth/components/login-form";

export default async function LoginPage() {
  const registrationOpen = await registration.isOpen();

  return (
    <>
      <title>Sign in | Hangar</title>
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
