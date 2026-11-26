import { ApiError } from "#libs/api";
import { ErrorMessage } from "#modules/common/error-message.ts";

/** Why a sign-in through the provider ended back on `/login`, as the server's `error` says it. */
export type SignInRefusal = "unavailable" | "expired" | "denied" | "not-a-user";

/** What the sign-in page says when a sign-in fails. */
export class SignInMessages {
  /** What a sign-in by password that failed with no error of the server's says. */
  private static readonly Failed = "Unable to sign in. Please try again.";

  /** What a 401 of no code says, as the server's `auth.invalid_credentials` does. */
  private static readonly InvalidCredentials = "Invalid email or password.";

  static readonly Refusals: Record<SignInRefusal, string> = {
    unavailable: "The identity provider cannot be reached. Try again, or sign in with your password.",
    expired: "The sign-in expired, or was started in another tab. Try again.",
    denied: "The identity provider did not sign you in.",
    "not-a-user": "This account is not one of Hangar's users: hangar.yml does not list it.",
  };

  /** The refusal the `error` of `/login` names, if it names one. */
  static refusal(error: unknown): SignInRefusal | undefined {
    if (typeof error !== "string" || !Object.hasOwn(SignInMessages.Refusals, error)) {
      return undefined;
    }

    return error as SignInRefusal;
  }

  /**
   * What failed in a sign-in by password: the words of the server's error, a wrong password or too many attempts; a 401
   * of no code, a proxy's or a body cut short, is a wrong password still.
   */
  static ofPassword(error: unknown): string {
    if (!(error instanceof ApiError)) {
      return SignInMessages.Failed;
    }

    if (error.detail) {
      return ErrorMessage.describe(error);
    }

    return error.status === 401 ? SignInMessages.InvalidCredentials : SignInMessages.Failed;
  }
}
