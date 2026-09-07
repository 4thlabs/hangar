'use client';

import { useState, type SubmitEvent } from 'react';
import { CircleAlertIcon } from 'lucide-react';
import { Link, useRouter } from 'waku';
import { authClient } from '#libs/auth';
import { Alert, AlertDescription, AlertTitle } from '#app/components/ui/alert.tsx';
import { Button } from '#app/components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '#app/components/ui/card.tsx';
import { Field, FieldError, FieldGroup, FieldLabel } from '#app/components/ui/field.tsx';
import { Input } from '#app/components/ui/input.tsx';
import { Spinner } from '#app/components/ui/spinner.tsx';

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
    const name = String(formData.get('name')).trim();
    const email = String(formData.get('email')).trim();
    const password = String(formData.get('password'));
    const confirmPassword = String(formData.get('confirmPassword'));

    if (password !== confirmPassword) {
      setPasswordMismatch(true);
      return;
    }

    setIsPending(true);

    try {
      const result = await authClient.signUp.email({ name, email, password });

      if (result.error) {
        setError(result.error.message ?? 'Unable to create your account.');
        return;
      }

      router.replace('/');
    } catch {
      setError('Unable to create your account. Please try again.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm">
      <Card>
        <CardHeader>
          <CardTitle>Create your Hangar account</CardTitle>
          <CardDescription>Enter your details to get started.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">Name</FieldLabel>
              <Input id="name" name="name" type="text" autoComplete="name" required disabled={isPending} />
            </Field>
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
                disabled={isPending}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                disabled={isPending}
              />
            </Field>
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
                aria-describedby={passwordMismatch ? 'confirmPassword-error' : undefined}
              />
              {passwordMismatch && <FieldError id="confirmPassword-error">Passwords do not match.</FieldError>}
            </Field>
            {error && (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>Registration failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </FieldGroup>
        </CardContent>
        <CardFooter className="flex-col gap-3">
          <Button type="submit" className="w-full" disabled={isPending}>
            {isPending && <Spinner data-icon="inline-start" />}
            {isPending ? 'Creating account…' : 'Create account'}
          </Button>
          <p className="text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link to="/login" className="underline underline-offset-4">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </form>
  );
}
