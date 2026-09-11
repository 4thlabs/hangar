"use client";

import { useState, type SubmitEvent } from "react";
import { useRouter } from "waku";
import { AuthEmailField, AuthFormCard, AuthPasswordField } from "#app/components/auth/auth-form-card.tsx";
import { authClient } from "#libs/auth/client";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsPending(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email"));
    const password = String(formData.get("password"));

    try {
      const result = await authClient.signIn.email({ email, password });

      if (result.error) {
        setError(result.error.message ?? "Unable to sign in.");
        return;
      }

      router.replace("/");
    } catch {
      setError("Unable to sign in. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <AuthFormCard
      title="Sign in to Hangar"
      description="Enter your email and password to access your account."
      error={error}
      errorTitle="Sign in failed"
      isPending={isPending}
      submitLabel="Sign in"
      pendingLabel="Signing in…"
      alternatePrompt="Don't have an account?"
      alternateHref="/register"
      alternateLabel="Create one"
      onSubmit={handleSubmit}
    >
      <AuthEmailField disabled={isPending} />
      <AuthPasswordField disabled={isPending} autoComplete="current-password" />
    </AuthFormCard>
  );
}
