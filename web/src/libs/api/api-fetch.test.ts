import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "./api-fetch.ts";

/** Answers every `fetch` with `response`. */
function answer(response: Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response),
  );
}

describe("apiFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the body of an answer", async () => {
    answer(Response.json({ version: "0.1.0" }));

    await expect(apiFetch("/api/health", {})).resolves.toEqual({ version: "0.1.0" });
  });

  it("returns null for an answer with no body", async () => {
    answer(new Response(null, { status: 204 }));

    await expect(apiFetch("/api/nothing", {})).resolves.toBeNull();
  });

  it("throws the problem of an error, its detail as the message", async () => {
    const problem = { type: "about:blank", title: "Not Found", status: 404, detail: "no such app" };

    answer(Response.json(problem, { status: 404, headers: { "Content-Type": "application/problem+json" } }));

    const error = await apiFetch("/api/apps/alpha", {}).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, message: "no such app", problem });
  });

  it("throws the status alone when a proxy answers with no problem", async () => {
    answer(new Response("Bad Gateway", { status: 502 }));

    const error = await apiFetch("/api/health", {}).catch((error: unknown) => error);

    expect(error).toMatchObject({ status: 502, message: "the server answered 502", problem: undefined });
  });
});
