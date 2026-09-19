import { describe, expect, it, vi } from "vitest";
import { widgetConfigSchema, widgetService } from "./config.ts";
import { noSecret } from "../mock/mock.ts";

const DOMAIN = "test.local";

/** The two URLs, without the key thunk that never compares equal. */
const pick = ({ api, link }: { api: string; link: string }) => ({ api, link });

describe("widgetService", () => {
  it("reaches a service on its public host when the store declares neither URL", () => {
    expect(pick(widgetService({}, "frigate", DOMAIN, noSecret))).toEqual({
      api: "https://frigate.test.local",
      link: "https://frigate.test.local",
    });
  });

  it("calls the container directly while still linking to the public host", () => {
    expect(pick(widgetService({ url: "http://frigate:5000" }, "frigate", DOMAIN, noSecret))).toEqual({
      api: "http://frigate:5000",
      link: "https://frigate.test.local",
    });
  });

  it("follows an overridden link with the API when no URL is declared", () => {
    // The override is there because the default host is wrong, so falling back
    // to that default for the API would send every call somewhere unreachable.
    expect(pick(widgetService({ link: "https://cams.example.com" }, "frigate", DOMAIN, noSecret))).toEqual({
      api: "https://cams.example.com",
      link: "https://cams.example.com",
    });
  });

  it("keeps the two apart when both are declared", () => {
    expect(
      pick(
        widgetService({ url: "http://frigate:5000", link: "https://cams.example.com" }, "frigate", DOMAIN, noSecret),
      ),
    ).toEqual({
      api: "http://frigate:5000",
      link: "https://cams.example.com",
    });
  });

  it("asks for the container's key, and only when the widget wants it", async () => {
    const secret = vi.fn(() => Promise.resolve("s3cret"));
    const { apiKey } = widgetService({}, "arcane", DOMAIN, secret);

    expect(secret).not.toHaveBeenCalled();
    await expect(apiKey()).resolves.toBe("s3cret");
    // How that name is spelled in .env.global is HangarEnv's business, not this module's.
    expect(secret).toHaveBeenCalledWith("arcane");
  });

  it("reports an unset key as no key, which is a service that takes none", async () => {
    const { apiKey } = widgetService({}, "frigate", DOMAIN, noSecret);

    await expect(apiKey()).resolves.toBeUndefined();
  });

  it("names the link after the container, not the app", () => {
    expect(widgetService({}, "frigate-nvr", DOMAIN, noSecret).link).toBe("https://frigate-nvr.test.local");
  });
});

describe("widgetConfigSchema", () => {
  it("accepts a service widget carrying both URLs", () => {
    const parsed = widgetConfigSchema.safeParse({
      type: "frigate-events",
      column: 3,
      url: "http://frigate:5000",
      link: "https://cams.example.com",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects a host with no scheme, which ky cannot use as a base URL", () => {
    const parsed = widgetConfigSchema.safeParse({ type: "frigate-events", column: 3, url: "frigate:5000" });

    expect(parsed.success).toBe(false);
  });
});
