import { describe, expect, it } from "vitest";
import { ApiError } from "#libs/api";
import { describeSignInFailure, isSignInRefusal } from "./sign-in-messages.ts";

describe("the sign-in's messages", () => {
  it("reads the refusals the server names, and no other", () => {
    expect(isSignInRefusal("expired")).toBe(true);
    expect(isSignInRefusal("toString")).toBe(false);
    expect(isSignInRefusal(undefined)).toBe(false);
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

    expect(describeSignInFailure(invalid)).toBe("Invalid email or password.");
    expect(describeSignInFailure(tooMany)).toBe("Too many failed sign-ins for this email: try again in 15 minutes.");

    expect(describeSignInFailure(new ApiError(401))).toBe("Invalid email or password.");
    expect(describeSignInFailure(new ApiError(413))).toBe("Unable to sign in. Please try again.");
    expect(describeSignInFailure(new TypeError("Failed to fetch"))).toBe("Unable to sign in. Please try again.");
  });
});
