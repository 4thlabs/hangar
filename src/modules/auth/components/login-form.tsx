"use client";

import { useState, type SubmitEvent } from "react";
import { useRouter } from "waku";
import { authClient } from "#libs/auth/client";
import { AuthEmailField, AuthFormCard, AuthPasswordField } from "#modules/auth/components/auth-form-card.tsx";
import { AuthMessages } from "#modules/auth/messages.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";

type LoginFormProps = {
  /** Whether no account exists yet: the link to the sign-up page only shows then. */
  registrationOpen: boolean;
};

export function LoginForm({ registrationOpen }: LoginFormProps) {
  const router = useRouter();
  const { t } = useTranslation(AuthMessages);
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
        setError(result.error.message ?? t("login.error"));

        return;
      }

      router.replace("/");
    } catch (error) {
      console.error("Sign-in request failed", error);
      setError(t("login.transportError"));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <AuthFormCard
      title={t("login.title")}
      description={t("login.description")}
      error={error}
      errorTitle={t("login.failed")}
      isPending={isPending}
      submitLabel={t("login.submit")}
      pendingLabel={t("login.pending")}
      alternate={
        registrationOpen ? { prompt: t("login.noAccount"), href: "/register", label: t("login.createOne") } : undefined
      }
      onSubmit={handleSubmit}
    >
      <AuthEmailField disabled={isPending} />
      <AuthPasswordField disabled={isPending} autoComplete="current-password" />
    </AuthFormCard>
  );
}
