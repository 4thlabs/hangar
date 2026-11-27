import { describe, expect, it } from "vitest";
import {
  getAuthLoginMockHandler,
  getDockerLogsMockHandler,
  getHealthCheckMockHandler,
  getNotificationsReadMockHandler,
} from "#libs/api/mock";
import { network } from "#mock/network.ts";
import { ApiError, apiFetch } from "./api-fetch.ts";

/** The answer of an error, `problem`, as `application/problem+json`, with `headers`. */
function problemOf(problem: object & { status: number }, headers: Record<string, string> = {}): Response {
  return Response.json(problem, {
    status: problem.status,
    headers: { "Content-Type": "application/problem+json", ...headers },
  });
}

describe("apiFetch", () => {
  it("returns the body of an answer", async () => {
    network.use(getHealthCheckMockHandler({ version: "0.1.0" }));

    await expect(apiFetch("/api/health", {})).resolves.toEqual({ version: "0.1.0" });
  });

  it("returns null for an answer with no body", async () => {
    network.use(getNotificationsReadMockHandler());

    await expect(apiFetch("/api/notifications/read", { method: "POST" })).resolves.toBeNull();
  });

  it("throws the problem of an error, its detail as the message", async () => {
    const problem = { type: "about:blank", title: "Not Found", status: 404, detail: "no such app" };

    network.use(
      getHealthCheckMockHandler(() => {
        throw problemOf(problem);
      }),
    );

    const error = await apiFetch("/api/health", {}).catch((error: unknown) => error);

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

    network.use(
      getDockerLogsMockHandler(() => {
        throw problemOf(problem);
      }),
    );

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

    network.use(
      getAuthLoginMockHandler(() => {
        throw problemOf(problem);
      }),
    );

    const error = await apiFetch("/api/auth/login", { method: "POST" }).catch((error: unknown) => error);

    expect(error).toMatchObject({ status: 413, detail: undefined });
  });

  it("reads the wait of a Retry-After in seconds", async () => {
    const problem = { type: "/problems/auth.too_many_sign_ins", status: 429, detail: "too many failed sign-ins" };

    network.use(
      getAuthLoginMockHandler(() => {
        throw problemOf(problem, { "Retry-After": "840" });
      }),
    );

    const error = await apiFetch("/api/auth/login", { method: "POST" }).catch((error: unknown) => error);

    expect(error).toMatchObject({
      status: 429,
      retryAfter: 840,
      detail: { code: "auth.too_many_sign_ins", params: {} },
    });
  });

  it("reads no wait from a Retry-After that is a date", async () => {
    network.use(
      getHealthCheckMockHandler(() => {
        throw new Response("Service Unavailable", {
          status: 503,
          headers: { "Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT" },
        });
      }),
    );

    const error = await apiFetch("/api/health", {}).catch((error: unknown) => error);

    expect(error).toMatchObject({ status: 503, retryAfter: undefined });
  });

  it("throws the status alone when a proxy answers with no problem", async () => {
    network.use(
      getHealthCheckMockHandler(() => {
        throw new Response("Bad Gateway", { status: 502 });
      }),
    );

    const error = await apiFetch("/api/health", {}).catch((error: unknown) => error);

    expect(error).toMatchObject({ status: 502, message: "the server answered 502", problem: undefined });
  });
});
