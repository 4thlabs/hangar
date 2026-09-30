import { LoginForm } from "#modules/auth/components/login-form";

export default async function LoginPage() {
  return (
    <>
      <title>Sign in | Hangar</title>
      <LoginForm />
    </>
  );
}

export const getConfig = async () => {
  return {
    render: "static",
  } as const;
};
