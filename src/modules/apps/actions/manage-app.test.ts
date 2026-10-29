import { mkdtempSync } from "node:fs";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dataDir: "",
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("#libs/auth/server", () => ({ sessions: { require: vi.fn(async () => ({ user: { id: "1" } })) } }));
vi.mock("#libs/logs", () => ({ logger: mocks.logger }));
vi.mock("#libs/hangar/server", async () => {
  const { Hangar } = await import("#libs/hangar");

  mocks.dataDir = mkdtempSync(path.join(tmpdir(), "manage-app-"));

  return { hangar: Hangar.create("https://example.com/store.git", mocks.dataDir) };
});

const { hangar } = await import("#libs/hangar/server");
const { createApp, saveAppFile } = await import("#modules/apps/actions/manage-app.ts");

describe("saveAppFile", () => {
  const folder = () => path.join(hangar.store.storePath, "store", "delta-app");

  beforeAll(async () => {
    await mkdir(path.join(hangar.store.storePath, ".git"), { recursive: true });
    await mkdir(folder(), { recursive: true });
    await mkdir(hangar.store.installedPath, { recursive: true });
    await symlink("compose.yml", path.join(folder(), "alias.yml"));
  });

  beforeEach(async () => {
    vi.spyOn(hangar.runtime, "run").mockResolvedValue({ code: 0, stdout: "" });
    await writeFile(path.join(folder(), "compose.yml"), "name: Delta\nservices: {}\n");
  });

  afterAll(async () => {
    await rm(mocks.dataDir, { recursive: true, force: true });
  });

  it.each(["compose.yml", "alias.yml", "Compose.yml"])(
    "reports that saving %s changed the compose file",
    async relativePath => {
      await expect(saveAppFile("delta-app", relativePath, "name: Renamed\nservices: {}\n")).resolves.toMatchObject({
        success: true,
        composeChanged: true,
      });
    },
  );

  it("reports no compose change for another file, nor for a refused save", async () => {
    await expect(saveAppFile("delta-app", "delta.env", "DELTA_PORT=8080\n")).resolves.toMatchObject({
      success: true,
      composeChanged: false,
    });

    await expect(saveAppFile("delta-app", "../escape.yml", "a: 1\n")).resolves.toMatchObject({
      success: false,
      composeChanged: false,
    });
  });
});

describe("createApp", () => {
  it("refuses the id of the page that creates apps, which would leave the app without a page", async () => {
    await expect(createApp("new", "name: New\nservices: {}\n")).resolves.toMatchObject({ success: false });
    await expect(hangar.store.files("new")).rejects.toThrow();
  });
});
