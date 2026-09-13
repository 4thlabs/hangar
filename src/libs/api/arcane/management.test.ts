import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Hangar } from "#libs/hangar";
import type { Project } from "./type.ts";

const { getProjects, updateProjectTag } = vi.hoisted(() => ({
  getProjects: vi.fn(),
  updateProjectTag: vi.fn(),
}));

vi.mock("./client.ts", () => ({ getProjects, updateProjectTag }));

const { syncTags } = await import("./management.ts");

const hangar = {
  config: {
    categories: () => [{ name: "infra", color: "blue", stacks: ["traefik"] }],
  },
} as unknown as Hangar;

const project = (overrides: Partial<Project>): Project => ({
  id: "1",
  name: "p",
  dirName: "traefik",
  isArchived: false,
  runningCount: 0,
  tags: [],
  ...overrides,
});

describe("syncTags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateProjectTag.mockResolvedValue({ success: true });
  });

  it("attaches the category tag and detaches stale ones", async () => {
    getProjects.mockResolvedValue({
      success: true,
      data: [
        project({ id: "1", dirName: "traefik" }),
        project({ id: "2", dirName: "orphan", tags: [{ name: "infra", color: "blue", sources: [] }] }),
      ],
    });

    await expect(syncTags(hangar)).resolves.toBe(0);
    expect(updateProjectTag).toHaveBeenCalledWith("1", "infra", "blue", true);
    expect(updateProjectTag).toHaveBeenCalledWith("2", "infra", "", false);
  });

  it("reports failed updates instead of exiting clean", async () => {
    getProjects.mockResolvedValue({ success: true, data: [project({})] });
    updateProjectTag.mockRejectedValue(new Error("boom"));

    await expect(syncTags(hangar)).rejects.toThrow(/Failed to sync 1 tag\(s\): traefik: \+infra/);
  });

  it("throws when the projects cannot be read", async () => {
    getProjects.mockResolvedValue({ success: false, detail: "nope" });

    await expect(syncTags(hangar)).rejects.toThrow("Failed to grab projects");
    expect(updateProjectTag).not.toHaveBeenCalled();
  });
});
