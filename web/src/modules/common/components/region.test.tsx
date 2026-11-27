import { focusManager, QueryClientProvider, useQuery, type QueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, createQueryClient } from "#libs/api";
import { QueryRegion, RenderRegion } from "#modules/common/components/region.tsx";

/** A read in flight of the fake service, which the test settles. */
type Read = { resolve: (value: string) => void; reject: (reason: unknown) => void };

/**
 * A service the test answers by hand. Its reads take the query's signal, as orval's fetchers do, so that query-core
 * cancels one whose last reader goes; it counts the reads asked and those cancelled.
 */
class FakeService {
  calls = 0;
  aborted = 0;
  readonly #pending: Read[] = [];

  read(signal: AbortSignal): Promise<string> {
    this.calls += 1;

    return new Promise((resolve, reject) => {
      const read = { resolve, reject };

      this.#pending.push(read);
      signal.addEventListener("abort", () => {
        this.aborted += 1;
        this.#pending.splice(this.#pending.indexOf(read), 1);
        reject(new Error("the read was cancelled"));
      });
    });
  }

  /** Answers the oldest read in flight with `value`. */
  async answer(value: string) {
    await act(async () => this.#next().resolve(value));
  }

  /** Fails the oldest read in flight, as a server that answers 503. */
  async fail() {
    await act(async () => this.#next().reject(new ApiError(503, { status: 503, detail: "the service is down" })));
  }

  /** The reads asked, and those cancelled. */
  get counts(): [number, number] {
    return [this.calls, this.aborted];
  }

  #next(): Read {
    const read = this.#pending.shift();

    if (read === undefined) {
      throw new Error("no read in flight");
    }

    return read;
  }
}

const key = ["card"];

type CardProps = {
  service: FakeService;
  /** A value of the page that changes, so that the card renders again while it reads. */
  tick?: number;
  show?: (text: string) => ReactNode;
};

/** A card as the page writes one: its `useQuery` above its region, which shows it. */
function Card({ service, tick = 0, show = text => <p>{text}</p> }: CardProps) {
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => service.read(signal), retry: false });

  return (
    <QueryRegion query={query} failure="Could not read the card" fallback={<p>Reading…</p>}>
      {text => (
        <>
          {show(text)}
          <span hidden>{tick}</span>
        </>
      )}
    </QueryRegion>
  );
}

/** A part that throws as it renders, as a card on data of a shape it does not expect. */
function Shown({ text }: { text: string }) {
  if (text === "bad") {
    throw new TypeError("cannot read properties of undefined");
  }

  return <p>{text}</p>;
}

let client: QueryClient;
let service: FakeService;

/** `ui` under the page's own client. */
function page(ui: ReactNode) {
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

/** The card made stale, as a feed or a mutation does. */
async function invalidate() {
  await act(async () => void client.invalidateQueries({ queryKey: key }));
}

/** The window losing the focus, then getting it back. */
async function focusBack() {
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
}

beforeEach(() => {
  client = createQueryClient();
  service = new FakeService();
});

afterEach(() => {
  cleanup();
  client.clear();
  focusManager.setFocused(undefined);
  vi.restoreAllMocks();
});

describe("QueryRegion", () => {
  it("shows its fallback while its query reads, then what it read", async () => {
    render(page(<Card service={service} />));

    expect(screen.getByText("Reading…")).toBeDefined();

    await service.answer("read");

    expect(await screen.findByText("read")).toBeDefined();
    expect(service.counts).toEqual([1, 0]);
  });

  it("shows why its read failed, and comes back once a feed makes it stale and it is read", async () => {
    render(page(<Card service={service} />));
    await service.fail();

    expect(await screen.findByText("Could not read the card")).toBeDefined();
    expect(screen.getByText("The service is down.")).toBeDefined();

    await invalidate();
    await service.answer("back");

    expect(await screen.findByText("back")).toBeDefined();
    expect(service.counts).toEqual([2, 0]);
  });

  it("comes back after a failure even when the page renders again while it is read", async () => {
    const { rerender } = render(page(<Card service={service} tick={0} />));

    await service.fail();
    expect(await screen.findByText("Could not read the card")).toBeDefined();

    await invalidate();
    rerender(page(<Card service={service} tick={1} />));
    rerender(page(<Card service={service} tick={2} />));
    await service.answer("back");

    expect(await screen.findByText("back")).toBeDefined();
    expect(service.counts).toEqual([2, 0]);
  });

  it("reads again a query that failed when it mounts again, rather than show the old failure", async () => {
    const { rerender } = render(page(<Card service={service} />));

    await service.fail();
    expect(await screen.findByText("Could not read the card")).toBeDefined();

    rerender(page(<p>Another page</p>));
    rerender(page(<Card service={service} />));

    expect(screen.getByText("Reading…")).toBeDefined();

    await service.answer("back");

    expect(await screen.findByText("back")).toBeDefined();
    expect(service.counts).toEqual([2, 0]);
  });

  it("reads once on a Retry clicked twice", async () => {
    render(page(<Card service={service} />));
    await service.fail();

    const retry = await screen.findByRole("button", { name: "Retry" });

    fireEvent.click(retry);
    fireEvent.click(retry);
    await service.answer("back");

    expect(await screen.findByText("back")).toBeDefined();
    expect(service.counts).toEqual([2, 0]);
  });

  it("reads a failed query again when the window gets the focus back", async () => {
    render(page(<Card service={service} />));
    await service.fail();
    expect(await screen.findByText("Could not read the card")).toBeDefined();

    await focusBack();
    await service.answer("back");

    expect(await screen.findByText("back")).toBeDefined();
    expect(service.counts).toEqual([2, 0]);
  });

  it("keeps what it read when a later read fails", async () => {
    render(page(<Card service={service} />));
    await service.answer("first");
    expect(await screen.findByText("first")).toBeDefined();

    await invalidate();
    await service.fail();

    expect(screen.getByText("first")).toBeDefined();
    expect(screen.queryByText("Could not read the card")).toBeNull();
    expect(service.counts).toEqual([2, 0]);
  });

  it("cancels its read in flight when the page leaves it", async () => {
    const { rerender } = render(page(<Card service={service} />));

    rerender(page(<p>Another page</p>));

    expect(service.counts).toEqual([1, 1]);
  });

  it("reads once more in StrictMode, which mounts it twice, and shows what it read", async () => {
    render(<StrictMode>{page(<Card service={service} />)}</StrictMode>);

    // Development only: the first read is cancelled with the first mount, and asked again.
    expect(service.counts).toEqual([2, 1]);

    await service.answer("read");

    expect(await screen.findByText("read")).toBeDefined();
  });

  it("fails alone when what it read throws as it renders, and renders the next answer, read once on a Retry clicked twice", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      page(
        <>
          <Card service={service} show={text => <Shown text={text} />} />
          <RenderRegion failure="Could not show the other">
            <p>The other card</p>
          </RenderRegion>
        </>,
      ),
    );

    await service.answer("bad");

    expect(await screen.findByText("Could not read the card")).toBeDefined();
    expect(screen.getByText("The other card")).toBeDefined();
    // The page's own error means nothing to its reader: only the server's words are shown.
    expect(screen.queryByText(/cannot read properties/)).toBeNull();

    // Twice: the second click joins the read in flight, which still has the data, rather than cancel it.
    const retry = screen.getByRole("button", { name: "Retry" });

    fireEvent.click(retry);
    fireEvent.click(retry);
    await service.answer("good");

    expect(await screen.findByText("good")).toBeDefined();
    expect(service.counts).toEqual([2, 0]);
  });

  it("keeps the Retry of a card that threw, and its focus, when the page renders again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { rerender } = render(page(<Card service={service} tick={0} show={text => <Shown text={text} />} />));

    await service.answer("bad");

    const retry = await screen.findByRole("button", { name: "Retry" });

    retry.focus();
    // As the Docker card renders again once its apps are read.
    rerender(page(<Card service={service} tick={1} show={text => <Shown text={text} />} />));

    expect(screen.getByRole("button", { name: "Retry" })).toBe(retry);
    expect(document.activeElement).toBe(retry);
  });

  it("catches a children function that throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      page(
        <Card
          service={service}
          show={() => {
            throw new TypeError("cannot read properties of undefined");
          }}
        />,
      ),
    );

    await service.answer("read");

    expect(await screen.findByText("Could not read the card")).toBeDefined();
  });

  it("tells its failures apart: the read's, and the render's", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    /** A card that says which failure it shows. */
    function Told() {
      const query = useQuery({ queryKey: key, queryFn: ({ signal }) => service.read(signal), retry: false });

      return (
        <QueryRegion query={query} failure={({ cause }) => <p>Failed to {cause}</p>}>
          {text => <Shown text={text} />}
        </QueryRegion>
      );
    }

    render(page(<Told />));
    await service.fail();
    expect(await screen.findByText("Failed to read")).toBeDefined();

    await invalidate();
    await service.answer("bad");
    expect(await screen.findByText("Failed to render")).toBeDefined();
  });
});

describe("RenderRegion", () => {
  it("renders again once what it shows changes", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { rerender } = render(
      page(
        <RenderRegion resetKey={1} failure="Could not show the card">
          <Shown text="bad" />
        </RenderRegion>,
      ),
    );

    expect(screen.getByText("Could not show the card")).toBeDefined();

    rerender(
      page(
        <RenderRegion resetKey={2} failure="Could not show the card">
          <Shown text="shown" />
        </RenderRegion>,
      ),
    );

    expect(screen.getByText("shown")).toBeDefined();
  });

  it("renders again on its Retry", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    let text = "bad";

    /** A part that reads `text` as it renders. */
    function Current() {
      return <Shown text={text} />;
    }

    render(
      page(
        <RenderRegion failure="Could not show the card">
          <Current />
        </RenderRegion>,
      ),
    );

    expect(screen.getByText("Could not show the card")).toBeDefined();

    text = "fixed";
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(screen.getByText("fixed")).toBeDefined();
  });
});
