import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GluetunPublicIp } from "./api/client.ts";
import { GluetunVpnStatusCard, gluetunVpnStatus } from "./vpn-status.tsx";
import { aService } from "../mock/mock.ts";

afterEach(() => vi.unstubAllGlobals());

const connected: GluetunPublicIp = {
  public_ip: "203.0.113.42",
  city: "Zurich",
  country: "Switzerland",
};

describe("GluetunVpnStatusCard", () => {
  it("shows where the tunnel comes out when it is up", () => {
    const html = renderToStaticMarkup(<GluetunVpnStatusCard publicIp={connected} />);

    expect(html).toContain("Your VPN is connected!");
    expect(html).not.toContain("not connected");
    // One line, as Glance writes it: the address and where it comes out belong together.
    expect(html).toContain("203.0.113.42 - Zurich, Switzerland");
  });

  it("reads an empty address as a tunnel that is down", () => {
    // gluetun answers 200 with an empty public_ip rather than failing, so the card has to
    // recognise it: a 200 is not the same as a connection.
    const html = renderToStaticMarkup(<GluetunVpnStatusCard publicIp={{ public_ip: "", city: "", country: "" }} />);

    expect(html).toContain("Your VPN is not connected!");
    expect(html).toContain("text-destructive");
  });

  it("omits the location when gluetun does not report one", () => {
    const html = renderToStaticMarkup(
      <GluetunVpnStatusCard publicIp={{ public_ip: "203.0.113.42", city: "", country: "" }} />,
    );

    // No trailing separator, and no stray comma from joining two blanks.
    expect(html).toContain(">203.0.113.42</p>");
  });

  it("calls the control server under /v1, with the key, and never links anywhere", async () => {
    const called: Request[] = [];

    vi.stubGlobal("fetch", (request: Request) => {
      called.push(request);

      return Promise.resolve(
        new Response(JSON.stringify(connected), { headers: { "content-type": "application/json" } }),
      );
    });

    const { Widget } = gluetunVpnStatus({
      api: "http://gluetun:8000",
      link: "https://gluetun.test.local",
      apiKey: () => Promise.resolve("s3cret"),
    });
    const html = renderToStaticMarkup(<>{await Widget()}</>);

    expect(called.map(request => request.url)).toEqual(["http://gluetun:8000/v1/publicip/ip"]);
    expect(called[0]?.headers.get("x-api-key")).toBe("s3cret");
    // The control server serves JSON and the stack has no Traefik router: there is nothing to open.
    expect(html).not.toContain("<a ");
  });

  it("exposes a titled skeleton through the widget definition", () => {
    const { Skeleton } = gluetunVpnStatus(aService());
    const html = renderToStaticMarkup(<Skeleton />);

    expect(html).toContain("Gluetun");
    expect(html).toContain('aria-busy="true"');
  });
});
