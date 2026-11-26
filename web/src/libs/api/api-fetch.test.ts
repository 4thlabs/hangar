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

  it("reads the code of a problem of Hangar's from its type, and its params from its members", async () => {
    const problem = {
      type: "/problems/docker.unknown_container",
      title: "Not Found",
      status: 404,
      detail: "the app alpha has no container web",
      project: "alpha",
      container: "web",
    };

    answer(Response.json(problem, { status: 404, headers: { "Content-Type": "application/problem+json" } }));

    const error = await apiFetch("/api/docker/apps/alpha/containers/web/logs", {}).catch((error: unknown) => error);

    expect(error).toMatchObject({
      status: 404,
      detail: {
        code: "docker.unknown_container",
        params: { project: "alpha", container: "web" },
        message: "the app alpha has no container web",
      },
    });
  });

  it("reads no code from a problem quoll answers itself", async () => {
    const problem = { type: "about:blank", title: "Payload Too Large", status: 413, detail: "the body is too large" };

    answer(Response.json(problem, { status: 413, headers: { "Content-Type": "application/problem+json" } }));

    const error = await apiFetch("/api/auth/login", {}).catch((error: unknown) => error);

    expect(error).toMatchObject({ status: 413, detail: undefined });
  });

  it("reads the wait of a Retry-After in seconds", async () => {
    const problem = { type: "/problems/auth.too_many_sign_ins", status: 429, detail: "too many failed sign-ins" };
    const headers = { "Content-Type": "application/problem+json", "Retry-After": "840" };

    answer(Response.json(problem, { status: 429, headers }));

    const error = await apiFetch("/api/auth/login", {}).catch((error: unknown) => error);

    expect(error).toMatchObject({
      status: 429,
      retryAfter: 840,
      detail: { code: "auth.too_many_sign_ins", params: {} },
    });
  });

  it("reads no wait from a Retry-After that is a date", async () => {
    const headers = { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" };

    answer(new Response("Service Unavailable", { status: 503, headers }));

    const error = await apiFetch("/api/health", {}).catch((error: unknown) => error);

    expect(error).toMatchObject({ status: 503, retryAfter: undefined });
  });

  it("throws the status alone when a proxy answers with no problem", async () => {
    answer(new Response("Bad Gateway", { status: 502 }));

    const error = await apiFetch("/api/health", {}).catch((error: unknown) => error);

    expect(error).toMatchObject({ status: 502, message: "the server answered 502", problem: undefined });
  });
});
