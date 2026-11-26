import { focusManager, QueryClientProvider, useSuspenseQuery } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, createQueryClient } from "#libs/api";
import { Region } from "#modules/common/components/region.tsx";

/** A part that throws as it renders, as a card on data of a shape it does not expect. */
function Broken(): never {
  throw new TypeError("cannot read properties of undefined");
}

/** A part that shows what its query read. */
function Read({ read }: { read: () => Promise<string> }) {
  const { data } = useSuspenseQuery({ queryKey: ["read"], queryFn: read, retry: false });

  return <p>{data}</p>;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Region", () => {
  it("shows the failure of a part that throws as it renders, and its sibling stands", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <>
        <Region failure="Could not show the card">
          <Broken />
        </Region>
        <Region failure="Could not show the other">
          <p>The other card</p>
        </Region>
      </>,
    );

    expect(screen.getByText("Could not show the card")).toBeDefined();
    expect(screen.getByText("The other card")).toBeDefined();
    // The page's own error means nothing to its reader: only the server's words are shown.
    expect(screen.queryByText(/cannot read properties/)).toBeNull();
  });

  it("shows its fallback while its query reads, then what it read", async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <Region failure="Could not read" fallback={<p>Reading…</p>}>
          <Read read={async () => "read"} />
        </Region>
      </QueryClientProvider>,
    );

    expect(screen.getByText("Reading…")).toBeDefined();
    expect(await screen.findByText("read")).toBeDefined();
  });

  it("asks its failed query again on Retry, and shows what it then read", async () => {
    const read = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ApiError(503, { status: 503, detail: "the store is not cloned yet" }))
      .mockResolvedValueOnce("cloned");

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <QueryClientProvider client={createQueryClient()}>
        <Region failure="Could not read the store">
          <Read read={read} />
        </Region>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Could not read the store")).toBeDefined();
    expect(screen.getByText("The store is not cloned yet.")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("cloned")).toBeDefined();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("renders again once what it shows changes", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { rerender } = render(
      <Region resetKey={1} failure="Could not show the card">
        <Broken />
      </Region>,
    );

    expect(screen.getByText("Could not show the card")).toBeDefined();

    rerender(
      <Region resetKey={2} failure="Could not show the card">
        <p>Shown</p>
      </Region>,
    );

    expect(screen.getByText("Shown")).toBeDefined();
  });

  it("tries again when the window gets the focus back", async () => {
    const read = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new ApiError(502)).mockResolvedValueOnce("back");

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <QueryClientProvider client={createQueryClient()}>
        <Region failure="Could not read">
          <Read read={read} />
        </Region>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Could not read")).toBeDefined();

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    expect(await screen.findByText("back")).toBeDefined();
    act(() => focusManager.setFocused(undefined));
  });
});
