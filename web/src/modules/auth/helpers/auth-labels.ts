import type { SignInRefusal } from "#modules/auth/helpers/sign-in-messages.ts";
import { m } from "#paraglide/messages.js";

/** The words of each value `auth` shows a label of, by the type that lists them: a new value is a type error here. */
export const authLabels = {
  /** What the sign-in page says of each refusal of the provider. */
  refusals: {
    unavailable: m.auth_refusals_unavailable,
    expired: m.auth_refusals_expired,
    denied: m.auth_refusals_denied,
    "not-a-user": m.auth_refusals_not_a_user,
  } satisfies Record<SignInRefusal, () => string>,
};
