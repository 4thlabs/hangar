import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { CircleAlertIcon, KeyRoundIcon } from "lucide-react";
import { useState, type SubmitEvent } from "react";
import { getAuthOidcLoginUrl } from "#libs/api";
import { authMutations, authQueries } from "#modules/auth/api/auth-queries.ts";
import { describeSignInFailure, isSignInRefusal, signInRefusals } from "#modules/auth/helpers/sign-in-messages.ts";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { Alert, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { buttonVariants } from "#modules/common/ui/button.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { Field, FieldGroup, FieldLabel, FieldSeparator } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";

/**
 * The search of `/login`: why a sign-in through the provider came back, if it did. Any text, which
 * `isSignInRefusal` reads as a `SignInRefusal` or none.
 */
type LoginSearch = { error?: string };

/** `/login`, the sign-in page, outside the app's frame. */
export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch =>
    typeof search.error === "string" ? { error: search.error } : {},
  component: LoginPage,
});

/**
 * The sign-in page of the users of `hangar.yml`: their email and password, and the identity provider's button when
 * one is configured. A sign-in through the provider that failed comes back here with the `error` that says why.
 */
function LoginPage() {
  const { error: refused } = useSearch({ from: "/login" });
  const navigate = useNavigate();
  const login = useMutation(authMutations.login());
  const { data: options } = useQuery(authQueries.options());

  const [error, setError] = useState<string | null>(() => (isSignInRefusal(refused) ? signInRefusals[refused] : null));

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);

    // A text input's entry is a string; only a file input's is a `File`.
    const textOf = (name: string) => {
      const entry = form.get(name);

      return typeof entry === "string" ? entry : "";
    };

    const credentials = { email: textOf("email"), password: textOf("password") };

    try {
      // The options keep the signed-in user as the session, which the frame then requires.
      await login.mutateAsync({ data: credentials });
      await navigate({ to: "/", replace: true });
    } catch (failure) {
      setError(describeSignInFailure(failure));
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6 font-sans">
      <title>Sign in | Hangar</title>
      <form onSubmit={event => void handleSubmit(event)} className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>
              <h1>Sign in to Hangar</h1>
            </CardTitle>
            <CardDescription>Enter your email and password to access your account.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  disabled={login.isPending}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  minLength={8}
                  required
                  disabled={login.isPending}
                />
              </Field>
              {error && (
                <Alert variant="destructive">
                  <CircleAlertIcon />
                  <AlertTitle>Sign in failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </FieldGroup>
          </CardContent>
          <CardFooter className="flex-col gap-3">
            <PendingButton type="submit" className="w-full" pending={login.isPending} pendingLabel="Signing in…">
              Sign in
            </PendingButton>
            {options?.oidc && (
              <>
                <FieldSeparator className="w-full">or</FieldSeparator>
                {/* A link, not a fetch: the server redirects the browser to the provider. */}
                <a href={getAuthOidcLoginUrl()} className={buttonVariants({ variant: "outline", className: "w-full" })}>
                  <KeyRoundIcon data-icon="inline-start" />
                  Sign in with single sign-on
                </a>
              </>
            )}
          </CardFooter>
        </Card>
      </form>
    </main>
  );
}
