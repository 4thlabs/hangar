import { describe, expect, it } from "vitest";
import { dockerError, dockerOk } from "./api-response.ts";

describe("dockerOk", () => {
  it("wraps the payload and forbids caching a live sample", async () => {
    const response = dockerOk({ projects: [] });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ success: true, data: { projects: [] } });
  });
});

describe("dockerError", () => {
  it("carries the message in the body and the machine-readable part in the status", async () => {
    const response = dockerError("Indisponible.", 503);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ success: false, error: { message: "Indisponible." } });
  });
});
