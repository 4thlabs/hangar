import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "#modules/auth/components/login-page.tsx";

/**
 * The search of `/login`: why a sign-in through the provider came back, if it did. Any text, which
 * `isSignInRefusal` reads as a `SignInRefusal` or none.
 */
type LoginSearch = { error?: string };

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch =>
    typeof search.error === "string" ? { error: search.error } : {},
  component: LoginPage,
});
