import { describe, expect, it } from "vitest";
import { ApiError } from "#libs/api";
import { SignInMessages } from "./sign-in-messages.ts";

describe("SignInMessages", () => {
  it("reads the refusals the server names, and no other", () => {
    expect(SignInMessages.refusal("expired")).toBe("expired");
    expect(SignInMessages.refusal("toString")).toBeUndefined();
    expect(SignInMessages.refusal(undefined)).toBeUndefined();
  });

  it("says what failed in a sign-in by password", () => {
    const invalid = new ApiError(401, {
      type: "/problems/auth.invalid_credentials",
      status: 401,
      detail: "invalid email or password",
    });

    const tooMany = new ApiError(
      429,
      {
        type: "/problems/auth.too_many_sign_ins",
        status: 429,
        detail: "too many failed sign-ins for this email: try again later",
      },
      900,
    );

    expect(SignInMessages.ofPassword(invalid)).toBe("Invalid email or password.");
    expect(SignInMessages.ofPassword(tooMany)).toBe(
      "Too many failed sign-ins for this email: try again in 15 minutes.",
    );

    expect(SignInMessages.ofPassword(new ApiError(413))).toBe("Unable to sign in. Please try again.");
    expect(SignInMessages.ofPassword(new TypeError("Failed to fetch"))).toBe("Unable to sign in. Please try again.");
  });
});
