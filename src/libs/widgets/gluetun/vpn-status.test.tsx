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

    expect(html).toContain("Connected");
    expect(html).not.toContain("Not connected");
    expect(html).toContain("203.0.113.42");
    expect(html).toContain("Zurich, Switzerland");
  });

  it("reads an empty address as a tunnel that is down", () => {
    // gluetun answers 200 with an empty public_ip rather than failing, so the card has to
    // recognise it: a 200 is not the same as a connection.
    const html = renderToStaticMarkup(<GluetunVpnStatusCard publicIp={{ public_ip: "", city: "", country: "" }} />);

    expect(html).toContain("Not connected");
    expect(html).toContain("text-destructive");
  });

  it("omits the location when gluetun does not report one", () => {
    const html = renderToStaticMarkup(
      <GluetunVpnStatusCard publicIp={{ public_ip: "203.0.113.42", city: "", country: "" }} />,
    );

    expect(html).toContain("203.0.113.42");
    // No empty line, and no stray comma from joining two blanks.
    expect(html).not.toContain("text-muted-foreground");
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
