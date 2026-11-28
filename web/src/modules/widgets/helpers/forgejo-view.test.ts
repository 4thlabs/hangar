import { describe, expect, it } from "vitest";
import type { ForgejoRepository, ForgejoRun } from "#libs/api";
import { forgejoView } from "./forgejo-view.ts";

function run(id: number, status: string, createdAt: string, startedAt: string | null): ForgejoRun {
  return {
    id,
    repository: "ana/hangar",
    title: `Run ${id}`,
    status,
    reference: "main",
    url: `https://forgejo.example.com/ana/hangar/actions/runs/${id}`,
    createdAt,
    startedAt,
  };
}

function repository(fullName: string, updatedAt: string, archived = false): ForgejoRepository {
  return { fullName, url: `https://forgejo.example.com/${fullName}`, updatedAt, archived };
}

describe("forgejoView", () => {
  it("lists the running runs first, then the newest queued first, each since it started or was queued", () => {
    // Run 2 was queued before run 3, and started after it: by when they were queued, 3 comes first.
    const view = forgejoView(
      [],
      [
        run(1, "waiting", "2026-11-26T09:00:00.000Z", null),
        run(2, "running", "2026-11-26T08:00:00.000Z", "2026-11-26T08:40:00.000Z"),
        run(3, "running", "2026-11-26T08:30:00.000Z", "2026-11-26T08:31:00.000Z"),
      ],
    );

    expect(view.activeRuns.map(active => [active.id, active.isQueued, active.since])).toEqual([
      [3, false, "2026-11-26T08:31:00.000Z"],
      [2, false, "2026-11-26T08:40:00.000Z"],
      [1, true, "2026-11-26T09:00:00.000Z"],
    ]);
  });

  it("counts every repository and lists the three updated last, archived ones left out", () => {
    const view = forgejoView(
      [
        repository("ana/hangar", "2026-11-25T09:00:00.000Z"),
        repository("ana/old", "2026-11-26T10:00:00.000Z", true),
        repository("ana/notes", "2026-11-20T10:00:00.000Z"),
        repository("ana/empty", "2026-11-01T10:00:00.000Z"),
        repository("cleo/site", "2026-11-24T10:00:00.000Z"),
      ],
      [],
    );

    expect(view.repositoryCount).toBe(5);
    expect(view.recentRepositories.map(recent => recent.fullName)).toEqual(["ana/hangar", "cleo/site", "ana/notes"]);
  });
});
