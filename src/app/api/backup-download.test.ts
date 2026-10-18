import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "#libs/hangar";

// Lives here rather than beside the route: waku turns every file under `src/app/pages/` into a
// route, test files included, which breaks the build.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  logger: { error: vi.fn() },
  file: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("#libs/auth/server", () => ({ sessions: { get: mocks.getSession } }));
vi.mock("#libs/logs", () => ({ logger: mocks.logger }));
vi.mock("#libs/backups/server", () => ({ backups: { file: mocks.file } }));

const { GET } = await import("#app/pages/_api/api/backups/[app]/[archive].ts");

const get = (app: string, archive: string) =>
  GET(new Request("http://hangar.test/"), { params: { app, archive } } as never);

describe("GET a backup archive", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ user: { id: "u-1" } });
  });

  it("refuses an anonymous request without touching the archives", async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await get("jellyfin", "2026-10-18T03-30-00-000Z");

    expect(response.status).toBe(401);
    expect(mocks.file).not.toHaveBeenCalled();
  });

  it("answers 404 for an archive the app does not have", async () => {
    mocks.file.mockRejectedValue(new NotFoundError("jellyfin has no archive ../../etc"));

    const response = await get("jellyfin", "../../etc");

    expect(response.status).toBe(404);
    expect(mocks.logger.error).not.toHaveBeenCalled();
  });

  it("streams the archive as a zip attachment, its size announced", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "hangar-download-"));
    const file = path.join(folder, "2026-10-18T03-30-00-000Z.zip");

    await writeFile(file, "PK-bytes");
    mocks.file.mockResolvedValue({ path: file, size: 8, downloadName: "jellyfin-2026-10-18T03-30-00-000Z.zip" });

    const response = await get("jellyfin", "2026-10-18T03-30-00-000Z");

    expect(mocks.file).toHaveBeenCalledWith("jellyfin", "2026-10-18T03-30-00-000Z");
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "content-type": "application/zip",
      "content-length": "8",
      "content-disposition": 'attachment; filename="jellyfin-2026-10-18T03-30-00-000Z.zip"',
    });

    expect(await response.text()).toBe("PK-bytes");
  });
});
