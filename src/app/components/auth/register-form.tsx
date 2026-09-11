"use client";

import { useState, type SubmitEvent } from "react";
import { useRouter } from "waku";
import { AuthEmailField, AuthFormCard, AuthPasswordField } from "#app/components/auth/auth-form-card.tsx";
import { Field, FieldError, FieldLabel } from "#app/components/ui/field.tsx";
import { Input } from "#app/components/ui/input.tsx";
import { authClient } from "#libs/auth/client";

export function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [passwordMismatch, setPasswordMismatch] = useState(false);
  const [isPending, setIsPending] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPasswordMismatch(false);

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name")).trim();
    const email = String(formData.get("email")).trim();
    const password = String(formData.get("password"));
    const confirmPassword = String(formData.get("confirmPassword"));

    if (password !== confirmPassword) {
      setPasswordMismatch(true);
      return;
    }

    setIsPending(true);

    try {
      const result = await authClient.signUp.email({ name, email, password });

      if (result.error) {
        setError(result.error.message ?? "Unable to create your account.");
        return;
      }

      router.replace("/");
    } catch {
      setError("Unable to create your account. Please try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <AuthFormCard
      title="Create your Hangar account"
      description="Enter your details to get started."
      error={error}
      errorTitle="Registration failed"
      isPending={isPending}
      submitLabel="Create account"
      pendingLabel="Creating account…"
      alternatePrompt="Already have an account?"
      alternateHref="/login"
      alternateLabel="Sign in"
      onSubmit={handleSubmit}
    >
      <Field>
        <FieldLabel htmlFor="name">Name</FieldLabel>
        <Input id="name" name="name" type="text" autoComplete="name" required disabled={isPending} />
      </Field>
      <AuthEmailField disabled={isPending} />
      <AuthPasswordField disabled={isPending} autoComplete="new-password" />
      <Field data-invalid={passwordMismatch || undefined}>
        <FieldLabel htmlFor="confirmPassword">Confirm password</FieldLabel>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
          disabled={isPending}
          aria-invalid={passwordMismatch || undefined}
          aria-describedby={passwordMismatch ? "confirmPassword-error" : undefined}
        />
        {passwordMismatch && <FieldError id="confirmPassword-error">Passwords do not match.</FieldError>}
      </Field>
    </AuthFormCard>
  );
}
