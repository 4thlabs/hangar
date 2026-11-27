import { ApiError } from "#libs/api";
import { authLabels } from "#modules/auth/helpers/auth-labels.ts";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { m } from "#paraglide/messages.js";

/** Why a sign-in through the provider ended back on `/login`, as the server's `error` says it. */
export type SignInRefusal = "unavailable" | "expired" | "denied" | "not-a-user";

/** Whether `error`, the `error` of `/login`, names a refusal. */
export function isSignInRefusal(error: unknown): error is SignInRefusal {
  return typeof error === "string" && Object.hasOwn(authLabels.refusals, error);
}

/**
 * What failed in a sign-in by password: the words of the server's error, a wrong password or too many attempts; a 401
 * of no code, a proxy's or a body cut short, is a wrong password still.
 */
export function describeSignInFailure(error: unknown): string {
  // A sign-in by password that failed with no error of the server's.
  if (!(error instanceof ApiError)) {
    return m.auth_sign_in_failure();
  }

  if (error.detail) {
    return describeError(error);
  }

  // A 401 of no code says what the server's `auth.invalid_credentials` does.
  return error.status === 401 ? m.common_auth_invalid_credentials() : m.auth_sign_in_failure();
}
