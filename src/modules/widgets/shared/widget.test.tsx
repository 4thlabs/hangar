import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  WidgetCard,
  WidgetContent,
  WidgetEmptyState,
  WidgetFooter,
  WidgetHeader,
  WidgetList,
  WidgetListItem,
  WidgetMetadata,
  WidgetMetric,
  WidgetMetricGrid,
  WidgetTime,
} from "./widget.tsx";

describe("widget primitives", () => {
  it("composes the shared card, header, metadata, metrics, list, empty state, and footer styles", () => {
    const html = renderToStaticMarkup(
      <WidgetCard className="min-h-64">
        <WidgetHeader
          href="https://service.example.com"
          icon={<span aria-hidden="true">Icon</span>}
          title="Service"
          description={
            <WidgetMetadata>
              <span>v1.0.0</span>
              <span>2 items</span>
            </WidgetMetadata>
          }
        />
        <WidgetContent>
          <WidgetMetricGrid>
            <WidgetMetric label="Healthy" value="2" />
            <WidgetMetric label="Failed" value="1" detail="Needs attention" tone="destructive" />
          </WidgetMetricGrid>
          <WidgetList>
            <WidgetListItem media={<span>Media</span>} trailing={<time dateTime="2025-01-01">Today</time>}>
              Item
            </WidgetListItem>
          </WidgetList>
          <WidgetEmptyState>Nothing here.</WidgetEmptyState>
        </WidgetContent>
        <WidgetFooter title="Status">Ready</WidgetFooter>
      </WidgetCard>,
    );

    expect(html).toContain("w-full");
    expect(html).toContain("min-h-64");
    expect(html).toContain('href="https://service.example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain('aria-hidden="true">·</span>');
    expect(html).toContain("<dl");
    expect(html).toContain("<dt");
    expect(html).toContain("<dd");
    expect(html).toContain("text-destructive");
    expect(html).toContain("<ul");
    expect(html).toContain("<li");
    expect(html).toContain("Nothing here.");
    expect(html).toContain("Status");
    expect(html).toContain('data-slot="card-footer"');
  });

  it("formats a metric given a number, and leaves a string alone", () => {
    const html = renderToStaticMarkup(
      <WidgetMetricGrid>
        <WidgetMetric label="Episodes" value={4512} />
        <WidgetMetric label="Version" value="1.0.0" />
      </WidgetMetricGrid>,
    );

    expect(html).toContain("4,512");
    expect(html).toContain("1.0.0");
  });

  it("says what an empty list is empty of, and renders no <ul> for it", () => {
    const html = renderToStaticMarkup(<WidgetList empty="No releases found.">{[].map(() => null)}</WidgetList>);

    expect(html).toContain("No releases found.");
    expect(html).not.toContain("<ul");
  });

  it("writes a moment as a machine-readable date and a readable phrase", () => {
    const now = Date.UTC(2026, 8, 21, 12, 0, 0);
    const html = renderToStaticMarkup(<WidgetTime at={now - 7_200_000} now={now} />);

    expect(html).toContain('dateTime="2026-09-21T10:00:00.000Z"');
    expect(html).toContain("2 hours ago");
  });

  it("writes the same moment short when the row cannot spare the words", () => {
    const now = Date.UTC(2026, 8, 21, 12, 0, 0);

    expect(renderToStaticMarkup(<WidgetTime at={now - 7_200_000} now={now} compact />)).toContain(">2h<");
  });
});
