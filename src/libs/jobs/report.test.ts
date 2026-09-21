import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), logger: { error: vi.fn() } }));

vi.mock("sidequest", () => ({ Sidequest: { job: { list: mocks.list } } }));
vi.mock("#libs/logs", () => ({ logger: mocks.logger }));

const { markUpdated, outdatedProjects } = await import("./report.ts");

/** One completed `CheckImageVersion` row, newest-id-first as Sidequest lists them. */
const run = (id: number, checkedAt: string, ...outdated: string[]) => ({
  id,
  result: { checkedAt, updates: outdated.map(project => ({ project, image: "nginx", status: "outdated" })) },
});

const past = "2026-09-20T00:00:00.000Z";
const future = "2099-01-01T00:00:00.000Z";

describe("outdatedProjects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Every case starts from a cold cache: `markUpdated` clears it, and so must a new report.
    markUpdated("reset");
    mocks.list.mockResolvedValue([]);
  });

  it("takes the newest run by its own timestamp, not by row id", async () => {
    // A rerun from the Jobs page resets the row it was run from and keeps its id, so the fresh
    // report can sit below an older one.
    mocks.list.mockResolvedValue([run(9, past, "alpha"), run(2, future, "beta")]);

    expect([...(await outdatedProjects())]).toEqual(["beta"]);
  });

  it("drops an app updated since the report was taken", async () => {
    mocks.list.mockResolvedValue([run(1, past, "alpha", "beta")]);
    markUpdated("alpha");

    expect([...(await outdatedProjects())]).toEqual(["beta"]);
  });

  it("lets a check that ran after the update have the last word", async () => {
    markUpdated("alpha");
    mocks.list.mockResolvedValue([run(1, future, "alpha")]);

    expect([...(await outdatedProjects())]).toEqual(["alpha"]);
  });

  it("reports nothing rather than failing when the job store cannot be read", async () => {
    mocks.list.mockRejectedValue(new Error("no backend"));

    expect([...(await outdatedProjects())]).toEqual([]);
    expect(mocks.logger.error).toHaveBeenCalled();
  });
});
