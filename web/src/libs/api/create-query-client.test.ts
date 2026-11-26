import { MutationObserver, QueryObserver, type QueryKey } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { createQueryClient } from "./create-query-client.ts";

/** A client holding a read of each key, all fresh, each observed so that a stale one is read again. */
function clientWith(keys: readonly QueryKey[]) {
  const client = createQueryClient();
  const reads = new Map<string, number>();

  for (const queryKey of keys) {
    const name = JSON.stringify(queryKey);

    new QueryObserver(client, {
      queryKey,
      queryFn: async () => {
        reads.set(name, (reads.get(name) ?? 0) + 1);

        return name;
      },
      staleTime: Infinity,
    }).subscribe(() => {});
  }

  return { client, readsOf: (queryKey: QueryKey) => reads.get(JSON.stringify(queryKey)) ?? 0 };
}

const project = ["api", "docker", "apps", "alpha"];
const projects = ["api", "docker", "apps"];
const overview = ["api", "docker", "overview"];
const config = ["api", "config"];

describe("createQueryClient", () => {
  it("reads again on success what a mutation's meta.invalidates names, the keys under it too, and nothing else", async () => {
    const { client, readsOf } = clientWith([project, projects, overview, config]);

    await vi.waitFor(() => expect(readsOf(config)).toBe(1));

    await new MutationObserver(client, {
      mutationFn: async () => "saved",
      meta: { invalidates: [projects] },
    }).mutate();

    expect(readsOf(projects)).toBe(2);
    expect(readsOf(project)).toBe(2);
    expect(readsOf(overview)).toBe(1);
    expect(readsOf(config)).toBe(1);
  });

  it("keeps a mutation pending until the reads it makes stale are done", async () => {
    const client = createQueryClient();
    let answer: (value: string) => void = () => {};

    new QueryObserver(client, {
      queryKey: config,
      queryFn: () => new Promise<string>(resolve => (answer = resolve)),
    }).subscribe(() => {});

    answer("read");
    await vi.waitFor(() => expect(client.getQueryData(config)).toBe("read"));

    const save = new MutationObserver(client, { mutationFn: async () => "saved", meta: { invalidates: [config] } });
    const saved = save.mutate();

    await vi.waitFor(() => expect(client.isFetching({ queryKey: config })).toBe(1));
    expect(save.getCurrentResult().isPending).toBe(true);

    answer("read again");
    await saved;

    expect(save.getCurrentResult().isSuccess).toBe(true);
    expect(client.getQueryData(config)).toBe("read again");
  });

  it("reads nothing again when the mutation fails", async () => {
    const { client, readsOf } = clientWith([config]);

    await vi.waitFor(() => expect(readsOf(config)).toBe(1));

    await expect(
      new MutationObserver(client, {
        mutationFn: async () => Promise.reject(new Error("refused")),
        meta: { invalidates: [config] },
      }).mutate(),
    ).rejects.toThrow("refused");

    expect(readsOf(config)).toBe(1);
  });
});
