import { mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ dataDir: "" }));

vi.mock("server-only", () => ({}));
vi.mock("#libs/auth/server", () => ({ sessions: { require: vi.fn(async () => ({ user: { id: "1" } })) } }));

vi.mock("#libs/hangar/server", async () => {
  const { Hangar } = await import("#libs/hangar");

  mocks.dataDir = mkdtempSync(path.join(tmpdir(), "spotlight-apps-"));

  return { hangar: Hangar.create("https://example.com/store.git", mocks.dataDir) };
});

const { hangar } = await import("#libs/hangar/server");
const { spotlightApps } = await import("#modules/apps/actions/spotlight-apps.ts");

describe("spotlightApps", () => {
  const app = (id: string) => path.join(hangar.store.storePath, "store", id);

  beforeEach(async () => {
    await rm(mocks.dataDir, { recursive: true, force: true });
    await mkdir(path.join(hangar.store.storePath, ".git"), { recursive: true });
    await mkdir(path.join(hangar.store.storePath, "config"), { recursive: true });
    await mkdir(hangar.store.installedPath, { recursive: true });
    await writeFile(path.join(hangar.store.storePath, "config", "hangar.yml"), "categories: []\n");

    for (const id of ["vaultwarden", "jellyfin", "immich"]) {
      await mkdir(app(id), { recursive: true });
    }

    await writeFile(
      path.join(app("vaultwarden"), "compose.yml"),
      [
        "x-hangar:\n  name: Vaultwarden\n  icon: vw.svg",
        "services:\n  vaultwarden:\n    container_name: bitwarden\n    labels:\n      - traefik.enable=true\n",
      ].join("\n"),
    );

    await writeFile(path.join(app("jellyfin"), "compose.yml"), "services: {}\n");
    await writeFile(path.join(app("immich"), "compose.yml"), "services: {}\n");
    await hangar.store.link("vaultwarden");
    await hangar.store.link("jellyfin");
    await hangar.store.refresh();
  });

  afterAll(async () => {
    await rm(mocks.dataDir, { recursive: true, force: true });
  });

  it("lists the installed apps only, by name", async () => {
    const items = await spotlightApps();

    expect(items.map(item => item.label)).toEqual(["Jellyfin", "Vaultwarden"]);
  });

  it("opens a routed app at its container's host first, then offers its page", async () => {
    const items = await spotlightApps();
    const vaultwarden = items.find(item => item.id === "vaultwarden");

    expect(vaultwarden).toMatchObject({ icon: "vw.svg", keywords: ["vaultwarden"] });
    expect(vaultwarden?.actions).toEqual([
      { kind: "open", label: "Ouvrir", url: "https://bitwarden.test.local" },
      { kind: "navigate", label: "Voir la page", to: "/apps/vaultwarden" },
    ]);
  });

  it("offers only the page of an app Traefik does not serve", async () => {
    const items = await spotlightApps();
    const jellyfin = items.find(item => item.id === "jellyfin");

    expect(jellyfin?.actions).toEqual([{ kind: "navigate", label: "Voir la page", to: "/apps/jellyfin" }]);
  });
});
