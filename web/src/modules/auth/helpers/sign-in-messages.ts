import { ApiError } from "#libs/api";
import { describeError } from "#modules/common/helpers/error-message.ts";

/** Why a sign-in through the provider ended back on `/login`, as the server's `error` says it. */
export type SignInRefusal = "unavailable" | "expired" | "denied" | "not-a-user";

/** What a sign-in by password that failed with no error of the server's says. */
const failed = "Unable to sign in. Please try again.";

/** What a 401 of no code says, as the server's `auth.invalid_credentials` does. */
const invalidCredentials = "Invalid email or password.";

/** What the sign-in page says of each refusal of the provider. */
export const signInRefusals: Readonly<Record<SignInRefusal, string>> = {
  unavailable: "The identity provider cannot be reached. Try again, or sign in with your password.",
  expired: "The sign-in expired, or was started in another tab. Try again.",
  denied: "The identity provider did not sign you in.",
  "not-a-user": "This account is not one of Hangar's users: hangar.yml does not list it.",
};

/** Whether `error`, the `error` of `/login`, names a refusal. */
export function isSignInRefusal(error: unknown): error is SignInRefusal {
  return typeof error === "string" && Object.hasOwn(signInRefusals, error);
}

/**
 * What failed in a sign-in by password: the words of the server's error, a wrong password or too many attempts; a 401
 * of no code, a proxy's or a body cut short, is a wrong password still.
 */
export function describeSignInFailure(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return failed;
  }

  if (error.detail) {
    return describeError(error);
  }

  return error.status === 401 ? invalidCredentials : failed;
}
