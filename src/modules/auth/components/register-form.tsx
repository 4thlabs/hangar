"use client";

import { useState, type SubmitEvent } from "react";
import { useRouter } from "waku";
import { authClient } from "#libs/auth/client";
import { AuthEmailField, AuthFormCard, AuthPasswordField } from "#modules/auth/components/auth-form-card.tsx";
import { AuthMessages } from "#modules/auth/messages.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { Field, FieldError, FieldLabel } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";

export function RegisterForm() {
  const router = useRouter();
  const { t } = useTranslation(AuthMessages);
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
        setError(result.error.message ?? t("register.error"));

        return;
      }

      router.replace("/");
    } catch (error) {
      console.error("Sign-up request failed", error);
      setError(t("register.transportError"));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <AuthFormCard
      title={t("register.title")}
      description={t("register.description")}
      error={error}
      errorTitle={t("register.failed")}
      isPending={isPending}
      submitLabel={t("register.submit")}
      pendingLabel={t("register.pending")}
      alternate={{ prompt: t("register.haveAccount"), href: "/login", label: t("register.signIn") }}
      onSubmit={handleSubmit}
    >
      <Field>
        <FieldLabel htmlFor="name">{t("register.name")}</FieldLabel>
        <Input id="name" name="name" type="text" autoComplete="name" required disabled={isPending} />
      </Field>
      <AuthEmailField disabled={isPending} />
      <AuthPasswordField disabled={isPending} autoComplete="new-password" />
      <Field data-invalid={passwordMismatch || undefined}>
        <FieldLabel htmlFor="confirmPassword">{t("register.confirmPassword")}</FieldLabel>
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
        {passwordMismatch && <FieldError id="confirmPassword-error">{t("register.mismatch")}</FieldError>}
      </Field>
    </AuthFormCard>
  );
}
