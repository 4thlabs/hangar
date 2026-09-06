import type { ReactNode } from 'react';

type AuthLayoutProps = { children: ReactNode };

export default async function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <>
      {children}
    </>
  );
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
