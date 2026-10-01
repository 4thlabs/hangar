import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), logger: { error: vi.fn() } }));

vi.mock("#libs/logs", () => ({ logger: mocks.logger }));

const { ImageCheckReport } = await import("./report.ts");

/** A fresh report per case, reading the runs `mocks.list` answers. */
let report = new ImageCheckReport(mocks.list);

/** One completed `CheckImageVersion` row, newest-id-first as Sidequest lists them. */
const run = (id: number, checkedAt: string, remotes: Record<string, string> = {}) => ({
  id,
  result: { checkedAt, remotes },
});

const past = "2026-09-20T00:00:00.000Z";
const future = "2099-01-01T00:00:00.000Z";

describe("ImageCheckReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Every case starts from a cold cache: a new report has none.
    report = new ImageCheckReport(mocks.list);
    mocks.list.mockResolvedValue([]);
  });

  it("takes the newest run by its own timestamp, not by row id", async () => {
    // A rerun from the Jobs page resets the row it was run from and keeps its id, so the fresh
    // report can sit below an older one.
    mocks.list.mockResolvedValue([run(9, past, { nginx: "sha256:old" }), run(2, future, { nginx: "sha256:new" })]);

    expect(await report.snapshot.read()).toEqual({ nginx: "sha256:new" });
  });

  it("reads a report from before digests were stored as nothing to compare", async () => {
    mocks.list.mockResolvedValue([{ id: 1, result: { checkedAt: past, updates: [] } }]);

    expect(await report.snapshot.read()).toEqual({});
  });

  it("reports nothing rather than failing when the job store cannot be read", async () => {
    mocks.list.mockRejectedValue(new Error("no backend"));

    expect(await report.snapshot.read()).toEqual({});
    expect(mocks.logger.error).toHaveBeenCalled();
  });
});
