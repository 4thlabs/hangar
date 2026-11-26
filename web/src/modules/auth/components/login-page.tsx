import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { CircleAlertIcon, KeyRoundIcon } from "lucide-react";
import { useState, type SubmitEvent } from "react";
import { getAuthOidcLoginUrl, getAuthSessionQueryKey, useAuthLogin, useAuthOptions } from "#libs/api";
import { SignInMessages } from "#modules/auth/sign-in-messages.ts";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { Alert, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { buttonVariants } from "#modules/common/ui/button.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { Field, FieldGroup, FieldLabel, FieldSeparator } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";

/**
 * The sign-in page of the users of `hangar.yml`: their email and password, and the identity provider's button when
 * one is configured. A sign-in through the provider that failed comes back here with the `error` that says why.
 */
export function LoginPage() {
  const { error: refused } = useSearch({ from: "/login" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const login = useAuthLogin();
  const { data: options } = useAuthOptions();

  const [error, setError] = useState<string | null>(() => {
    const refusal = SignInMessages.refusal(refused);

    return refusal ? SignInMessages.Refusals[refusal] : null;
  });

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const credentials = { email: String(form.get("email")), password: String(form.get("password")) };

    try {
      const user = await login.mutateAsync({ data: credentials });

      queryClient.setQueryData(getAuthSessionQueryKey(), user);
      await navigate({ to: "/", replace: true });
    } catch (failure) {
      setError(SignInMessages.ofPassword(failure));
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6 font-sans">
      <title>Sign in | Hangar</title>
      <form onSubmit={handleSubmit} className="w-full max-w-sm">
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
                  maxLength={128}
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
