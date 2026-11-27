import type { SignInRefusal } from "#modules/auth/helpers/sign-in-messages.ts";

/** What `auth` says: the sign-in page, and why a sign-in failed. */
export const authMessages = {
  signIn: {
    documentTitle: "Sign in | Hangar",
    title: "Sign in to Hangar",
    description: "Enter your email and password to access your account.",
    email: "Email",
    emailPlaceholder: "you@example.com",
    password: "Password",
    failed: "Sign in failed",
    submit: "Sign in",
    submitting: "Signing in…",
    or: "or",
    singleSignOn: "Sign in with single sign-on",
  },
  /** What a sign-in by password that failed with no error of the server's says. */
  failure: "Unable to sign in. Please try again.",
  /** What the sign-in page says of each refusal of the provider. */
  refusals: {
    unavailable: "The identity provider cannot be reached. Try again, or sign in with your password.",
    expired: "The sign-in expired, or was started in another tab. Try again.",
    denied: "The identity provider did not sign you in.",
    "not-a-user": "This account is not one of Hangar's users: hangar.yml does not list it.",
  } satisfies Record<SignInRefusal, string>,
} as const;
