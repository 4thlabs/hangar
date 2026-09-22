import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BeszelSystem } from "./api/client.ts";
import { BeszelServerStatsCard, beszelServerStats, displaySystem } from "./server-stats.tsx";
import { aService, clearWidgetCache } from "../mock/mock.ts";

afterEach(() => vi.unstubAllGlobals());
beforeEach(clearWidgetCache);

const service = {
  api: "http://beszel:8090",
  link: "https://beszel.test.local",
  apiKey: () => Promise.resolve("a-token"),
};

/** Fixed, so "3d up" is a fact rather than a race with the clock. */
const NOW = Date.UTC(2026, 8, 21, 12, 0, 0);

const nas: BeszelSystem = {
  id: "sys1",
  name: "nas",
  status: "up",
  info: { u: 259_200, cpu: 12.4, mp: 48.6, dp: 71.2, dt: 41, m: "Intel N100" },
};

describe("displaySystem", () => {
  it("reads Beszel's single-letter keys into named metrics", () => {
    expect(displaySystem(nas)).toEqual({
      id: "sys1",
      name: "nas",
      up: true,
      status: "up",
      uptime: 259_200,
      cpu: 12.4,
      memory: 48.6,
      disk: 71.2,
      temperature: 41,
      cpuModel: "Intel N100",
    });
  });

  it("treats a host that has never reported as having no readings, not zeroed ones", () => {
    expect(displaySystem({ id: "sys2", name: "vps", status: "pending", info: {} })).toMatchObject({
      up: false,
      uptime: undefined,
      temperature: undefined,
      cpu: 0,
    });
  });
});

describe("BeszelServerStatsCard", () => {
  it("shows each host's uptime and its three gauges", () => {
    const html = renderToStaticMarkup(
      <BeszelServerStatsCard servers={[displaySystem(nas)]} serviceUrl="https://beszel.test.local" now={NOW} />,
    );

    expect(html).toContain("nas");
    expect(html).toContain("3d up");
    expect(html).toContain("41°C");
    expect(html).toContain("12%");
    expect(html).toContain("49%");
    expect(html).toContain("71%");
    expect(html).toContain("width:71.2%");
  });

  it("marks a saturated metric in colour as well as in figures", () => {
    const html = renderToStaticMarkup(
      <BeszelServerStatsCard
        servers={[displaySystem({ ...nas, info: { ...nas.info, mp: 93 } })]}
        serviceUrl="https://beszel.test.local"
        now={NOW}
      />,
    );

    expect(html).toContain("93%");
    expect(html).toContain("bg-destructive");
  });

  it("draws no gauges for a host the hub is not hearing from, and counts it in the header", () => {
    const html = renderToStaticMarkup(
      <BeszelServerStatsCard
        servers={[displaySystem(nas), displaySystem({ ...nas, id: "sys3", name: "vps", status: "down" })]}
        serviceUrl="https://beszel.test.local"
        now={NOW}
      />,
    );

    expect(html).toContain("2 servers");
    expect(html).toContain("1 down");
    expect(html).toContain("down");
    // The live host still draws its own three; the dead one adds none.
    expect(html.match(/rounded-full bg-muted/g)).toHaveLength(3);
  });

  it("says so when the hub monitors nothing", () => {
    const html = renderToStaticMarkup(<BeszelServerStatsCard servers={[]} serviceUrl="https://beszel.test.local" />);

    expect(html).toContain("No servers monitored.");
  });
});

describe("beszelServerStats", () => {
  it("reads the systems collection once, with the token PocketBase expects", async () => {
    const called: Request[] = [];

    vi.stubGlobal("fetch", (request: Request) => {
      called.push(request);

      return Promise.resolve(
        new Response(JSON.stringify({ items: [nas] }), { headers: { "content-type": "application/json" } }),
      );
    });

    const html = renderToStaticMarkup(<>{await beszelServerStats(service).Widget()}</>);

    expect(called).toHaveLength(1);
    expect(called[0]?.url).toBe(
      "http://beszel:8090/api/collections/systems/records?sort=name&fields=id%2Cname%2Cstatus%2Cinfo&perPage=100",
    );
    expect(called[0]?.headers.get("Authorization")).toBe("a-token");
    expect(html).toContain("nas");
    // The container address is Hangar's to reach; the header links to the public host.
    expect(html).not.toContain("beszel:8090");
  });

  it("degrades to the error card when the hub is unreachable", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("ECONNREFUSED")));

    expect(renderToStaticMarkup(<>{await beszelServerStats(service).Widget()}</>)).toContain("unavailable");
  });

  it("exposes a titled skeleton through the widget definition", () => {
    expect(renderToStaticMarkup(<>{beszelServerStats(aService()).Skeleton()}</>)).toContain("Beszel");
  });
});
