import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "#libs/api";
import { coded } from "#mock/page.tsx";
import { useEventStream, type StreamOptions } from "#modules/common/hooks/use-event-stream.ts";

type Item = { kind: "line"; line: string } | { kind: "end" };

/** A stream the test writes: its items, a problem, its close. */
function stream() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({ start: started => void (controller = started) });

  return {
    response: new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
    send: (item: Item) => controller?.enqueue(encoder.encode(`data: ${JSON.stringify(item)}\n\n`)),
    problem: (status: number) =>
      controller?.enqueue(encoder.encode(`event: problem\ndata: ${JSON.stringify({ status, detail: "gone" })}\n\n`)),
    close: () => controller?.close(),
  };
}

/** Answers every `fetch` with `response`, and keeps the calls. */
function answer(response: Response) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => response);

  vi.stubGlobal("fetch", fetch);

  return fetch;
}

/** The lines of the items, kept in the order they came. */
const lines: StreamOptions<Item, readonly string[]> = {
  fold: (state, items) => [...state, ...items.flatMap(item => (item.kind === "line" ? [item.line] : []))],
  isEnd: item => item.kind === "end",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useEventStream", () => {
  it("folds the items into the state, and ends on the end item", async () => {
    const written = stream();
    const fetch = answer(written.response);
    const onEnd = vi.fn();
    const { result } = renderHook(() => useEventStream<Item, readonly string[]>([], { ...lines, onEnd }));

    act(() => result.current.read("/log", ["kept"]));
    await waitFor(() => expect(result.current.status).toBe("connected"));

    act(() => {
      written.send({ kind: "line", line: "one" });
      written.send({ kind: "line", line: "two" });
    });

    await waitFor(() => expect(result.current.state).toEqual(["kept", "one", "two"]));

    act(() => written.send({ kind: "end" }));
    await waitFor(() => expect(result.current.status).toBe("ended"));

    expect(onEnd).toHaveBeenCalledTimes(1);
    act(() => written.close());
    await waitFor(() => expect(result.current.status).toBe("ended"));
    expect(result.current.failure).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("folds the next items into a state set during the read, as a log cleared while it is followed", async () => {
    const written = stream();

    answer(written.response);

    const { result } = renderHook(() => useEventStream<Item, readonly string[]>([], lines));

    act(() => result.current.read("/log", []));
    await waitFor(() => expect(result.current.status).toBe("connected"));
    act(() => written.send({ kind: "line", line: "old" }));
    await waitFor(() => expect(result.current.state).toEqual(["old"]));

    act(() => result.current.setState([]));
    act(() => written.send({ kind: "line", line: "new" }));

    await waitFor(() => expect(result.current.state).toEqual(["new"]));
    act(() => written.close());
    await waitFor(() => expect(result.current.status).toBe("ended"));
    expect(result.current.state).toEqual(["new"]);
  });

  it("fails a stream closed before an end it requires, with no failure, and keeps what it folded", async () => {
    const written = stream();

    answer(written.response);

    const { result } = renderHook(() => useEventStream<Item, readonly string[]>([], { ...lines, requiresEnd: true }));

    act(() => result.current.read("/output", []));
    act(() => {
      written.send({ kind: "line", line: "pulled" });
      written.close();
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.failure).toBeNull();
    expect(result.current.state).toEqual(["pulled"]);
  });

  it("ends a stream closed before an end it does not require", async () => {
    const written = stream();

    answer(written.response);

    const { result } = renderHook(() => useEventStream<Item, readonly string[]>([], lines));

    act(() => result.current.read("/log", []));
    act(() => written.close());

    await waitFor(() => expect(result.current.status).toBe("ended"));
  });

  it("says why a stream failed: its refusal, or its problem after the 200", async () => {
    answer(coded(404, "docker.unknown_container", "no such container.", { container: "web" }));

    const { result } = renderHook(() => useEventStream<Item, readonly string[]>([], lines));

    act(() => result.current.read("/log", []));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.failure).toBeInstanceOf(ApiError);

    const written = stream();

    answer(written.response);
    act(() => result.current.read("/log", []));
    await waitFor(() => expect(result.current.status).toBe("connected"));
    expect(result.current.failure).toBeNull();

    act(() => written.problem(502));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.failure).toMatchObject({ status: 502 });
  });

  it("starts each read again from its seed, the last one closed", async () => {
    const first = stream();
    const second = stream();
    const fetch = vi.fn().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);

    vi.stubGlobal("fetch", fetch);

    const { result } = renderHook(() => useEventStream<Item, readonly string[]>([], lines));

    act(() => result.current.read("/log", []));
    act(() => first.send({ kind: "line", line: "old" }));
    await waitFor(() => expect(result.current.state).toEqual(["old"]));

    act(() => result.current.read("/log", ["seed"]));

    expect(result.current.state).toEqual(["seed"]);
    expect(result.current.status).toBe("connecting");
    await waitFor(() => expect(result.current.status).toBe("connected"));
    act(() => second.send({ kind: "line", line: "new" }));
    await waitFor(() => expect(result.current.state).toEqual(["seed", "new"]));
  });

  it("sends the request it is given, as a POST whose answer is the stream", async () => {
    const fetch = answer(stream().response);
    const { result } = renderHook(() => useEventStream<Item, readonly string[]>([], lines));

    act(() => result.current.read("/run", [], { method: "POST", body: "{}" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls[0]?.[0]).toBe("/run");
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: "{}" });
  });
});
