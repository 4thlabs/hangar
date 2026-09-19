import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FrigateEvent, FrigateStats } from "./api/client.ts";
import { FrigateEventsCard, frigateEvents } from "./events.tsx";
import { aService } from "../mock/mock.ts";

afterEach(() => vi.unstubAllGlobals());

const now = 1_700_000_000_000;

const stats: FrigateStats = {
  detection_fps: 7.25,
  cameras: {
    frigate_front_door: {},
    frigate_garden: {},
  },
  detectors: {
    coral: { inference_speed: 8.6 },
  },
};

const events: FrigateEvent[] = [
  {
    id: "1699999880.0-person",
    camera: "frigate_front_door",
    label: "person",
    sub_label: "Alice",
    start_time: 1_699_999_880,
  },
  {
    id: "1699999700.0-car",
    camera: "frigate_garden",
    label: "car",
    sub_label: null,
    start_time: 1_699_999_700,
  },
];

describe("FrigateEventsCard", () => {
  it("renders Frigate statistics and recent events with public links", () => {
    const html = renderToStaticMarkup(
      <FrigateEventsCard events={events} stats={stats} serviceUrl="https://frigate.example.com" now={now} />,
    );

    expect(html).toContain("2 cameras");
    expect(html).toContain("7.3 det/s");
    expect(html).toContain("9 ms");
    expect(html).toContain("person · Alice");
    expect(html).toContain(">car</a>");
    expect(html).toContain("front door");
    expect(html).toContain("garden");
    expect(html).toContain("2 minutes ago");
    expect(html).toContain("https://frigate.example.com/api/events/1699999880.0-person/thumbnail.jpg");
    expect(html).toContain("https://frigate.example.com/explore?event_id=1699999880.0-person");
  });

  it("renders the empty state when there are no recent events", () => {
    const html = renderToStaticMarkup(
      <FrigateEventsCard events={[]} stats={stats} serviceUrl="https://frigate.example.com" now={now} />,
    );

    expect(html).toContain("No recent events.");
    expect(html).not.toContain("thumbnail.jpg");
  });

  it("calls the container but points the browser at the public host", async () => {
    // The whole reason the two URLs are told apart: the header link, the event
    // deep links and the thumbnail <img> are all resolved by the visitor, who
    // cannot reach the container network the API answers on.
    const called: Request[] = [];

    vi.stubGlobal("fetch", (request: Request) => {
      called.push(request);

      return Promise.resolve(
        new Response(JSON.stringify(request.url.includes("/stats") ? stats : events), {
          headers: { "content-type": "application/json" },
        }),
      );
    });

    const { Widget } = frigateEvents({
      api: "http://frigate:5000",
      link: "https://frigate.test.local",
      apiKey: () => Promise.resolve("s3cret"),
    });
    const html = renderToStaticMarkup(<>{await Widget()}</>);

    expect(called.every(request => request.url.startsWith("http://frigate:5000/api/"))).toBe(true);
    // The key the operator put in .env.global has to reach the request, not just the factory.
    expect(called.map(request => request.headers.get("x-api-key"))).toEqual(["s3cret", "s3cret"]);
    expect(html).toContain("https://frigate.test.local/api/events/");
    expect(html).toContain("https://frigate.test.local/explore?event_id=");
    expect(html).not.toContain("frigate:5000");
  });

  it("exposes a titled skeleton through the widget definition", () => {
    const { Skeleton } = frigateEvents(aService());
    const html = renderToStaticMarkup(<Skeleton />);

    expect(html).toContain("Frigate");
    expect(html).toContain('aria-busy="true"');
  });
});
