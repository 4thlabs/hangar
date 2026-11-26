import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GithubReleases } from "#libs/api";
import { GithubCard } from "./github-card.tsx";

const opened = Date.UTC(2026, 10, 26, 8, 0, 0);
const minute = 60_000;

function releasedAt(publishedAt: number): GithubReleases {
  return {
    releases: [
      {
        repository: "4thlabs/hangar",
        tag: "v1.2.3",
        url: "https://github.com/4thlabs/hangar/releases/tag/v1.2.3",
        publishedAt: new Date(publishedAt).toISOString(),
      },
    ],
  };
}

describe("GithubCard", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes a release's time from the clock of the moment, not from when the card was first drawn", () => {
    vi.useFakeTimers({ now: opened });

    const { rerender } = render(<GithubCard releases={releasedAt(opened - 5 * minute)} />);

    expect(screen.getByText("5 minutes ago")).toBeDefined();

    // An hour on the dashboard, then a release published 10 minutes ago comes with the next read.
    act(() => {
      vi.advanceTimersByTime(60 * minute);
    });

    rerender(<GithubCard releases={releasedAt(opened + 50 * minute)} />);

    expect(screen.getByText("10 minutes ago")).toBeDefined();
  });
});
