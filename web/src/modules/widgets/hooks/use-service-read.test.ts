import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createQueryClient, type JellyfinData, type ServicesJellyfinParams } from "#libs/api";
import { getServicesJellyfinMockHandler } from "#libs/api/mock";
import { network } from "#mock/network.ts";
import { servicesQueries } from "#modules/widgets/api/services-queries.ts";
import { hasParts, useServiceRead, type ServiceParts } from "./use-service-read.ts";

const counts = { movies: 1, series: 2, episodes: 3, songs: 4 };

/** `children` under a client of their own. */
function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client: createQueryClient() }, children);
}

describe("hasParts", () => {
  it("holds when each part asked is there, whatever the parts not asked are", () => {
    const data: JellyfinData = { counts, latest: null };

    expect(hasParts(data, { counts: true })).toBe(true);
    expect(hasParts(data, { counts: true, latest: undefined })).toBe(true);
  });

  it("fails when a part asked is null or missing, a limit as much as a flag", () => {
    expect(hasParts({ counts, latest: null }, { latest: 10 })).toBe(false);
    expect(hasParts({ counts: null, latest: [] }, { counts: true })).toBe(false);
    expect(hasParts({ latest: [] }, { counts: true })).toBe(false);
  });

  it("asks nothing of a part the read gives false", () => {
    expect(hasParts({ counts: null, latest: [] }, { counts: false, latest: 10 })).toBe(true);
  });
});

describe("useServiceRead", () => {
  it("gives each part asked, typed as there, the others possibly null", async () => {
    const read = { counts: true } as const satisfies ServicesJellyfinParams;

    network.use(getServicesJellyfinMockHandler({ counts, latest: null }));

    const { result } = renderHook(() => useServiceRead(servicesQueries.jellyfin, "jellyfin-latest-1", read), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const data = result.current.data;

    expect(data?.counts.movies).toBe(1);

    // Kept as a type test: a part read without being asked is possibly null, and tsc refuses it (TS18047). Were the
    // hook to type it as there, the line would no longer be an error, and tsc would refuse the comment instead.
    // @ts-expect-error -- `latest` was not asked.
    const readsLatest = () => data?.latest.length;

    expect(readsLatest).toThrow(TypeError);
  });

  it("types a part a computed read may leave out as possibly null", () => {
    // A read written from a flag, `{ counts: show } as const`, whose `show` is a `boolean`.
    const data: ServiceParts<JellyfinData, { readonly counts: boolean }> = { counts: null, latest: null };

    // Kept as a type test: `counts` may not be asked, so tsc refuses it as possibly null (TS18047).
    // @ts-expect-error -- `counts` may not be asked.
    const readsCounts = () => data.counts.movies;

    expect(readsCounts).toThrow(TypeError);
  });

  it("fails the read when the server left out a part asked", async () => {
    const read = { counts: true, latest: 10 } as const satisfies ServicesJellyfinParams;

    network.use(getServicesJellyfinMockHandler({ counts, latest: null }));

    const { result } = renderHook(() => useServiceRead(servicesQueries.jellyfin, "jellyfin-latest-1", read), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
