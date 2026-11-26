import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FrigateEvents } from "#libs/api";
import { FrigateCard } from "./frigate-card.tsx";

const events: FrigateEvents = {
  cameraCount: 1,
  detectionFps: 1,
  detectors: [],
  events: [
    { id: "1-abc", camera: "frigate_front_door", label: "person", subLabel: "Ana", startTime: "2026-11-26T08:00:00Z" },
  ],
};

describe("FrigateCard", () => {
  it("names what was seen and what it was recognised as, linked to Frigate or not", () => {
    const linked = renderToStaticMarkup(
      <FrigateCard events={events} placementKey="frigate-events-1" link="https://frigate.example.com" />,
    );

    const unlinked = renderToStaticMarkup(<FrigateCard events={events} placementKey="frigate-events-1" link={null} />);

    expect(linked).toContain('href="https://frigate.example.com/explore?event_id=1-abc"');
    expect(linked).toContain("person · Ana");
    expect(unlinked).toContain("person · Ana");
    expect(unlinked).toContain("front door");
  });
});
