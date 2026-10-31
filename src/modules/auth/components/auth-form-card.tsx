"use client";

import { CircleAlertIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Link } from "waku";
import { AuthMessages } from "#modules/auth/messages.ts";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { Alert, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { Field, FieldGroup, FieldLabel } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";

type AuthAlternate = {
  prompt: string;
  href: "/login" | "/register";
  label: string;
};

type AuthFormCardProps = {
  title: string;
  description: string;
  error: string | null;
  errorTitle: string;
  isPending: boolean;
  submitLabel: string;
  pendingLabel: string;
  /** The link to the other form, left out when that form is closed. */
  alternate?: AuthAlternate | undefined;
  children: ReactNode;
  onSubmit: ComponentProps<"form">["onSubmit"];
};

export function AuthFormCard({
  title,
  description,
  error,
  errorTitle,
  isPending,
  submitLabel,
  pendingLabel,
  alternate,
  children,
  onSubmit,
}: AuthFormCardProps) {
  return (
    <form onSubmit={onSubmit} className="w-full max-w-sm">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {children}
            {error && (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>{errorTitle}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex-col gap-3">
          <PendingButton type="submit" className="w-full" pending={isPending} pendingLabel={pendingLabel}>
            {submitLabel}
          </PendingButton>
          {alternate && (
            <p className="text-sm text-muted-foreground">
              {alternate.prompt}{" "}
              <Link to={alternate.href} className="underline underline-offset-4">
                {alternate.label}
              </Link>
            </p>
          )}
        </CardFooter>
      </Card>
    </form>
  );
}

export function AuthEmailField({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation(AuthMessages);

  return (
    <Field>
      <FieldLabel htmlFor="email">{t("email")}</FieldLabel>
      <Input
        id="email"
        name="email"
        type="email"
        placeholder={t("emailPlaceholder")}
        autoComplete="email"
        required
        disabled={disabled}
      />
    </Field>
  );
}

export function AuthPasswordField({
  disabled,
  autoComplete,
}: {
  disabled: boolean;
  autoComplete: "current-password" | "new-password";
}) {
  const { t } = useTranslation(AuthMessages);

  return (
    <Field>
      <FieldLabel htmlFor="password">{t("password")}</FieldLabel>
      <Input
        id="password"
        name="password"
        type="password"
        autoComplete={autoComplete}
        minLength={8}
        maxLength={128}
        required
        disabled={disabled}
      />
    </Field>
  );
}
