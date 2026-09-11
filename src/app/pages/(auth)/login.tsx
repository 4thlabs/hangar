import { LoginForm } from "#app/components/auth/login-form";

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
