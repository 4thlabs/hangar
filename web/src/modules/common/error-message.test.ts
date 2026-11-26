import { describe, expect, it } from "vitest";
import { ApiError } from "#libs/api";
import { ErrorMessage } from "./error-message.ts";

/** An error the server answered with `detail`. */
function answered(status: number, detail: string) {
  return new ApiError(status, { type: "about:blank", title: "Error", status, detail });
}

describe("ErrorMessage.of", () => {
  it("writes the server's detail as a sentence", () => {
    expect(ErrorMessage.of(answered(404, "the store has no app alpha"))).toBe("The store has no app alpha.");
  });

  it("keeps the final period of a detail that has one", () => {
    expect(ErrorMessage.of(answered(500, "the store could not be pulled. See the server's log."))).toBe(
      "The store could not be pulled. See the server's log.",
    );
  });

  it("says the server could not be reached for an answer with no problem, or no answer", () => {
    expect(ErrorMessage.of(new ApiError(502))).toBe(ErrorMessage.Unreachable);
    expect(ErrorMessage.of(new TypeError("Failed to fetch"))).toBe(ErrorMessage.Unreachable);
  });
});
