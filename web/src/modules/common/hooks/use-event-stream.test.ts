import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "#libs/api";
import { coded, network } from "#mock/network.ts";
import { useEventStream, type StreamOptions } from "#modules/common/hooks/use-event-stream.ts";

type Item = { kind: "line"; line: string } | { kind: "end" };

/**
 * A stream the test writes: its items, a problem, its close. It opens with an empty comment, sent with the head, as
 * quoll's server does, which a proxy or msw would otherwise hold until the first item.
 */
function stream() {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;

  const body = new ReadableStream<Uint8Array>({
    start: started => {
      controller = started;
      started.enqueue(encoder.encode(":\n\n"));
    },
  });

  return {
    response: new Response(body, { headers: { "Content-Type": "text/event-stream" } }),
    send: (item: Item) => controller?.enqueue(encoder.encode(`data: ${JSON.stringify(item)}\n\n`)),
    problem: (status: number) =>
      controller?.enqueue(encoder.encode(`event: problem\ndata: ${JSON.stringify({ status, detail: "gone" })}\n\n`)),
    close: () => controller?.close(),
  };
}

/**
 * Answers the calls to `path` with `responses`, one each, in order, and keeps the requests. The hook reads any stream
 * that ends, of any route: these are not the contract's.
 */
function answer(path: string, ...responses: Response[]) {
  const requests: Request[] = [];

  network.use(
    http.all(`*${path}`, ({ request }) => {
      requests.push(request);

      return responses.shift() ?? new Response(null, { status: 410 });
    }),
  );

  return requests;
}

/** The lines of the items, kept in the order they came. */
const lines: StreamOptions<Item, readonly string[]> = {
  fold: (state, items) => [...state, ...items.flatMap(item => (item.kind === "line" ? [item.line] : []))],
  isEnd: item => item.kind === "end",
};

afterEach(() => {
  cleanup();
});

describe("useEventStream", () => {
  it("folds the items into the state, and ends on the end item", async () => {
    const written = stream();
    const requests = answer("/log", written.response);
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
    expect(requests).toHaveLength(1);
  });

  it("folds the next items into a state set during the read, as a log cleared while it is followed", async () => {
    const written = stream();

    answer("/log", written.response);

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

    answer("/output", written.response);

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

    answer("/log", written.response);

    const { result } = renderHook(() => useEventStream<Item, readonly string[]>([], lines));

    act(() => result.current.read("/log", []));
    act(() => written.close());

    await waitFor(() => expect(result.current.status).toBe("ended"));
  });

  it("says why a stream failed: its refusal, or its problem after the 200", async () => {
    const written = stream();

    const refusal = coded(404, {
      code: "docker.unknown_container",
      params: { project: "alpha", container: "web" },
      message: "no such container.",
    });

    answer("/log", refusal, written.response);

    const { result } = renderHook(() => useEventStream<Item, readonly string[]>([], lines));

    act(() => result.current.read("/log", []));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.failure).toBeInstanceOf(ApiError);

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

    answer("/log", first.response, second.response);

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
    const requests = answer("/run", stream().response);
    const { result } = renderHook(() => useEventStream<Item, readonly string[]>([], lines));

    act(() => result.current.read("/run", [], { method: "POST", body: "{}" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(new URL(requests[0]?.url ?? "").pathname).toBe("/run");
    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]?.text()).toBe("{}");
  });
});
