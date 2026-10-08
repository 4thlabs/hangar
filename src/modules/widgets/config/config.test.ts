import { describe, expect, it, vi } from "vitest";
import { clockDescriptor } from "../clock/descriptor.ts";
import { frigateEventsDescriptor } from "../frigate/descriptor.ts";
import { noSecret } from "../mock/mock.ts";
import { WidgetService, type WidgetHost } from "./config.ts";

/** A store whose apps run under their own name, with no key set. */
const host: WidgetHost = { domain: "test.local", containerName: app => app, secret: noSecret };

/** A Frigate placement declaring `fields`, resolved against `on`. */
const frigate = (fields: { url?: string; link?: string } = {}, on: WidgetHost = host) =>
  WidgetService.resolve({ type: "frigate-events", column: 3, ...fields }, frigateEventsDescriptor, on);

/** The two URLs, without the key thunk that never compares equal. */
const pick = ({ api, link }: { api: string; link: string }) => ({ api, link });

describe("WidgetService.resolve", () => {
  it("reaches a service on its public host when the store declares neither URL", () => {
    expect(pick(frigate())).toEqual({ api: "https://frigate.test.local", link: "https://frigate.test.local" });
  });

  it("calls the container directly while still linking to the public host", () => {
    expect(pick(frigate({ url: "http://frigate:5000" }))).toEqual({
      api: "http://frigate:5000",
      link: "https://frigate.test.local",
    });
  });

  it("follows an overridden link with the API when no URL is declared", () => {
    // The override is there because the default host is wrong, so falling back
    // to that default for the API would send every call somewhere unreachable.
    expect(pick(frigate({ link: "https://cams.example.com" }))).toEqual({
      api: "https://cams.example.com",
      link: "https://cams.example.com",
    });
  });

  it("keeps the two apart when both are declared", () => {
    expect(pick(frigate({ url: "http://frigate:5000", link: "https://cams.example.com" }))).toEqual({
      api: "http://frigate:5000",
      link: "https://cams.example.com",
    });
  });

  it("asks for the container's key, and only when the widget wants it", async () => {
    const secret = vi.fn(() => Promise.resolve("s3cret"));
    const { apiKey } = frigate({}, { ...host, secret });

    expect(secret).not.toHaveBeenCalled();
    await expect(apiKey()).resolves.toBe("s3cret");
    // How that name is spelled in .env.global is HangarEnv's business, not this module's.
    expect(secret).toHaveBeenCalledWith("frigate");
  });

  it("reports an unset key as no key, which is a service that takes none", async () => {
    await expect(frigate().apiKey()).resolves.toBeUndefined();
  });

  it("names the link after the container the store runs the app under, not the app", () => {
    const containerName = vi.fn(() => "frigate-nvr");

    expect(frigate({}, { ...host, containerName }).link).toBe("https://frigate-nvr.test.local");
    expect(containerName).toHaveBeenCalledWith("frigate");
  });

  it("refuses a widget whose descriptor reads no service", () => {
    expect(() => WidgetService.resolve({ type: "clock", column: 1 }, clockDescriptor, host)).toThrow(
      "The clock widget reads no service",
    );
  });
});
