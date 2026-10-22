import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("waku", () => ({
  useRouter: () => ({ replace: () => {} }),
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("#libs/auth/client", () => ({ authClient: {} }));

const { LoginForm } = await import("./login-form.tsx");
const { RegistrationClosed } = await import("./registration-closed.tsx");

describe("LoginForm", () => {
  it("links to the sign-up page while no account exists", () => {
    expect(renderToStaticMarkup(<LoginForm registrationOpen />)).toContain('href="/register"');
  });

  it("leaves the link out once the first account exists", () => {
    expect(renderToStaticMarkup(<LoginForm registrationOpen={false} />)).not.toContain('href="/register"');
  });
});

describe("RegistrationClosed", () => {
  it("sends to the sign-in page instead of a form", () => {
    const html = renderToStaticMarkup(<RegistrationClosed />);

    expect(html).toContain("Registration is closed");
    expect(html).toContain('href="/login"');
    expect(html).not.toContain("<form");
  });
});
