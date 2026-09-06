import { LoginForm } from '#app/components/login-form.tsx';

export default function LoginPage() {
  return (
    <>
      <title>Sign in | Hangar</title>
      <LoginForm />
    </>
  );
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
