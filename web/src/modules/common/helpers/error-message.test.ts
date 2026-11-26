import { describe, expect, it } from "vitest";
import { ApiError, type ErrorDetail } from "#libs/api";
import { describeError, describeErrorDetail, serverUnreachable } from "./error-message.ts";

/** An error the server answered with `detail`, of no code: one quoll answers itself. */
function answered(status: number, detail: string) {
  return new ApiError(status, { type: "about:blank", title: "Error", status, detail });
}

/** An error the server answered with the problem of `code`, whose members are `params`. */
function coded(status: number, code: string, params: Record<string, unknown>, retryAfter?: number) {
  return new ApiError(
    status,
    { type: `/problems/${code}`, status, detail: `the message of ${code}`, ...params },
    retryAfter,
  );
}

describe("describeError", () => {
  it("words a code by its params", () => {
    expect(describeError(coded(404, "store.unknown_app", { app: "alpha" }))).toBe("The store has no app alpha.");

    expect(describeError(coded(400, "editor.too_large", { path: "big.yml", size: 2_000_000 }))).toBe(
      "big.yml is too large to edit here: 2000000 bytes, 1 MiB at most.",
    );
  });

  it("sends the reader of a failure of the server's own to its log", () => {
    expect(describeError(coded(500, "store.pull_failed", {}))).toBe(
      "The store could not be pulled. See the server's log.",
    );
  });

  it("says the wait of a 429 from its Retry-After, in minutes", () => {
    expect(describeError(coded(429, "auth.too_many_sign_ins", {}, 840))).toBe(
      "Too many failed sign-ins for this email: try again in 14 minutes.",
    );

    expect(describeError(coded(429, "auth.too_many_sign_ins", {}, 1))).toBe(
      "Too many failed sign-ins for this email: try again in 1 minute.",
    );

    expect(describeError(coded(429, "auth.too_many_sign_ins", {}))).toBe(
      "Too many failed sign-ins for this email: try again later.",
    );
  });

  it("says a code it does not know in the server's message", () => {
    expect(describeError(coded(409, "store.newer_than_the_page", { app: "alpha" }))).toBe(
      "The message of store.newer_than_the_page.",
    );

    expect(describeError(coded(409, "toString", {}))).toBe("The message of toString.");
  });

  it("says a code without a param its words need in the server's message", () => {
    expect(describeError(coded(404, "store.unknown_app", {}))).toBe("The message of store.unknown_app.");
    expect(describeError(coded(404, "docker.unknown_container", { project: "alpha" }))).toBe(
      "The message of docker.unknown_container.",
    );

    expect(describeError(coded(404, "docker.unknown_container", { project: "alpha", container: null }))).toBe(
      "The message of docker.unknown_container.",
    );
  });

  it("writes the detail of a problem of no code as a sentence", () => {
    expect(describeError(answered(413, "the body is too large"))).toBe("The body is too large.");
  });

  it("says the server could not be reached for an answer with no problem, or no answer", () => {
    expect(describeError(new ApiError(502))).toBe(serverUnreachable);
    expect(describeError(new TypeError("Failed to fetch"))).toBe(serverUnreachable);
  });
});

describe("describeErrorDetail", () => {
  it("words the code of an error a body carries", () => {
    const detail: ErrorDetail = { code: "store.clone_failed", message: "the store could not be cloned" };

    expect(describeErrorDetail(detail)).toBe("The store could not be cloned. See the server's log.");
  });

  it("says an error a body carries without a param its words need in the server's message", () => {
    const detail = { code: "store.install_failed", message: "the installation of alpha failed" } as ErrorDetail;

    expect(describeErrorDetail(detail)).toBe("The installation of alpha failed.");
  });
});
