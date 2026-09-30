import { RegisterForm } from "#modules/auth/components/register-form";

export default function RegisterPage() {
  return (
    <>
      <title>Create account | Hangar</title>
      <RegisterForm />
    </>
  );
}

export const getConfig = async () => {
  return {
    render: "static",
  } as const;
};
