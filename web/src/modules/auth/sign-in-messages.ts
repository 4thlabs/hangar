import { ApiError } from "#libs/api";

/** Why a sign-in through the provider ended back on `/login`, as the server's `error` says it. */
export type SignInRefusal = "unavailable" | "expired" | "denied" | "not-a-user";

/** What the sign-in page says when a sign-in fails. */
export class SignInMessages {
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

  /** What failed in a sign-in by password. */
  static ofPassword(error: unknown): string {
    if (!(error instanceof ApiError)) {
      return "Unable to sign in. Please try again.";
    }

    if (error.status === 401) {
      return "Invalid email or password.";
    }

    if (error.status === 429) {
      return SignInMessages.sentence(error.message);
    }

    return "Unable to sign in. Please try again.";
  }

  /** `detail`, a problem's, written as a sentence. */
  private static sentence(detail: string): string {
    return `${detail.charAt(0).toUpperCase()}${detail.slice(1)}.`;
  }
}
