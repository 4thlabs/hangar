import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FrigateEvent, FrigateStats } from "#libs/api/frigate";
import { FrigateEventsCard, FrigateEventsSkeleton } from "./events.tsx";

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

  it("exports a titled skeleton with the same minimum height", () => {
    const html = renderToStaticMarkup(<FrigateEventsSkeleton />);

    expect(html).toContain("Frigate");
    expect(html).toContain("min-h-88");
  });
});
