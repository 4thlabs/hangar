import type { ReactNode } from 'react';
import { ErrorBoundary } from 'waku/router/client';
type RootProps = {
  /** Everything below <body>: the layout of whichever route group matched. */
  children: ReactNode;
};

/** */
export default function Root({ children }: RootProps) {
  return (
    <ErrorBoundary>
      {/* The script adds .dark before paint; React hydrates <html> without it. */}
      <html lang="en" suppressHydrationWarning>
        <head></head>
        <body className="dark">{children}</body>
      </html>
    </ErrorBoundary>
  );
}

/**
 * Static: prerendered at build time.
 */
export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};