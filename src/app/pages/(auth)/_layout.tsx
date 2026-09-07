import type { ReactNode } from 'react';

type AuthLayoutProps = { children: ReactNode };

export default function AuthLayout({ children }: AuthLayoutProps) {
  return <main className="flex min-h-svh items-center justify-center p-6">{children}</main>;
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
