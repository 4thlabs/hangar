import { ApiError } from "#libs/api";
import { authMessages } from "#modules/auth/messages.ts";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { commonMessages } from "#modules/common/messages.ts";

/** Why a sign-in through the provider ended back on `/login`, as the server's `error` says it. */
export type SignInRefusal = "unavailable" | "expired" | "denied" | "not-a-user";

/** What a sign-in by password that failed with no error of the server's says. */
const failed = authMessages.failure;

/** What a 401 of no code says, as the server's `auth.invalid_credentials` does. */
const invalidCredentials = commonMessages.errors.auth.invalidCredentials;

/** Whether `error`, the `error` of `/login`, names a refusal. */
export function isSignInRefusal(error: unknown): error is SignInRefusal {
  return typeof error === "string" && Object.hasOwn(authMessages.refusals, error);
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
