import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeEventSource } from "#mock/page.tsx";
import { useEventFeed } from "#modules/common/hooks/use-event-feed.ts";

/** The sources opened on `url`, open or closed. */
function sourcesOf(url: string): FakeEventSource[] {
  return FakeEventSource.sources.filter(source => source.url === url);
}

/** Says the tab is hidden, or shown, as the browser does. */
function setHidden(isHidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => isHidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  FakeEventSource.sources = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setHidden(false);
});

describe("useEventFeed", () => {
  it("hands each item to the latest handler, and connects once whatever the renders", () => {
    const seen: string[] = [];

    const { rerender } = renderHook(
      ({ tag }) => useEventFeed<number>("/feed", { onItem: item => seen.push(`${tag}${item}`) }),
      {
        initialProps: { tag: "a" },
      },
    );

    act(() => FakeEventSource.of("/feed")?.open());
    act(() => FakeEventSource.of("/feed")?.send(1));
    rerender({ tag: "b" });
    act(() => FakeEventSource.of("/feed")?.send(2));

    expect(seen).toEqual(["a1", "b2"]);
    expect(sourcesOf("/feed")).toHaveLength(1);
  });

  it("says the feed is down once lost, connects again after a wait doubled by each failure, and up once open", () => {
    vi.useFakeTimers();

    const downs = vi.fn();
    const opens = vi.fn();
    const { result } = renderHook(() => useEventFeed("/feed", { onItem: () => {}, onDown: downs, onOpen: opens }));

    act(() => sourcesOf("/feed")[0]?.fail());

    expect(result.current.isDown).toBe(true);
    expect(downs).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(999);
    });

    expect(sourcesOf("/feed")).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(sourcesOf("/feed")).toHaveLength(2);

    // Failed again before it opened: the next wait is twice as long.
    act(() => sourcesOf("/feed")[1]?.fail());
    act(() => {
      vi.advanceTimersByTime(1_999);
    });

    expect(sourcesOf("/feed")).toHaveLength(2);
    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(sourcesOf("/feed")).toHaveLength(3);

    act(() => sourcesOf("/feed")[2]?.open());

    expect(result.current.isDown).toBe(false);
    expect(opens).toHaveBeenCalledTimes(1);
  });

  it("closes the feed while the tab is hidden, and opens it again once shown", () => {
    const closes = vi.fn();

    renderHook(() => useEventFeed("/feed", { onItem: () => {}, onClose: closes }));

    act(() => setHidden(true));

    expect(sourcesOf("/feed")[0]?.readyState).toBe(FakeEventSource.CLOSED);
    expect(closes).toHaveBeenCalledTimes(1);

    act(() => setHidden(false));

    expect(sourcesOf("/feed")).toHaveLength(2);
    expect(FakeEventSource.of("/feed")).toBe(sourcesOf("/feed")[1]);
  });

  it("opens no feed for a null url, and one once it is given", () => {
    const { rerender } = renderHook(({ url }) => useEventFeed(url, { onItem: () => {} }), {
      initialProps: { url: null as string | null },
    });

    expect(FakeEventSource.sources).toHaveLength(0);

    rerender({ url: "/feed?since=3" });

    expect(sourcesOf("/feed?since=3")).toHaveLength(1);
  });

  it("closes the feed as the component goes, and connects nothing after", () => {
    vi.useFakeTimers();

    const { unmount } = renderHook(() => useEventFeed("/feed", { onItem: () => {} }));

    act(() => sourcesOf("/feed")[0]?.fail());
    unmount();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(sourcesOf("/feed")).toHaveLength(1);
  });
});
