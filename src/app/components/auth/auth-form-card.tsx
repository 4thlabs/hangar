"use client";

import type { ComponentProps, ReactNode } from "react";
import { CircleAlertIcon } from "lucide-react";
import { Link } from "waku";
import { Card } from "#app/components/card/accent-card.tsx";
import { Alert, AlertDescription, AlertTitle } from "#app/components/ui/alert.tsx";
import { Button } from "#app/components/ui/button.tsx";
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import { Field, FieldGroup, FieldLabel } from "#app/components/ui/field.tsx";
import { Input } from "#app/components/ui/input.tsx";
import { Spinner } from "#app/components/ui/spinner.tsx";

type AuthFormCardProps = {
  title: string;
  description: string;
  error: string | null;
  errorTitle: string;
  isPending: boolean;
  submitLabel: string;
  pendingLabel: string;
  alternatePrompt: string;
  alternateHref: "/login" | "/register";
  alternateLabel: string;
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
  alternatePrompt,
  alternateHref,
  alternateLabel,
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
          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending && <Spinner data-icon="inline-start" />}
            {isPending ? pendingLabel : submitLabel}
          </Button>
          <p className="text-sm text-muted-foreground">
            {alternatePrompt}{" "}
            <Link to={alternateHref} className="underline underline-offset-4">
              {alternateLabel}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </form>
  );
}

export function AuthEmailField({ disabled }: { disabled: boolean }) {
  return (
    <Field>
      <FieldLabel htmlFor="email">Email</FieldLabel>
      <Input
        id="email"
        name="email"
        type="email"
        placeholder="you@example.com"
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
  return (
    <Field>
      <FieldLabel htmlFor="password">Password</FieldLabel>
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
