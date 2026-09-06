import { RegisterForm } from '#app/components/auth/register-form'

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
    render: 'static',
  } as const;
};
