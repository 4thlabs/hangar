import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { HangarApp } from "#libs/hangar";

vi.mock("waku", () => ({
  Link: ({ children }: { children: unknown }) => children,
}));

// Server actions are a module boundary the render never crosses.
vi.mock("#modules/store/actions/store-apps.ts", () => ({}));

const { StoreAppCard } = await import("./store-app-card.tsx");

const app = (swarmReady: boolean): HangarApp => ({
  id: "miniflux",
  name: "Miniflux",
  icon: undefined,
  swarmReady,
  containerName: "miniflux",
});

describe("StoreAppCard", () => {
  it("offers to start any app with compose, whatever runs already", () => {
    const html = renderToStaticMarkup(<StoreAppCard app={app(false)} />);

    expect(html).toContain('aria-label="Démarrer Miniflux"');
    expect(html).not.toContain("Installer");
    expect(html).not.toContain("Désinstaller");
    expect(html).not.toContain("sur le swarm");
  });

  it("offers the swarm beside compose, independently, for an app with a compose.swarm.yml", () => {
    const html = renderToStaticMarkup(<StoreAppCard app={app(true)} />);

    expect(html).toContain('aria-label="Démarrer Miniflux"');
    expect(html).toContain('aria-label="Déployer Miniflux sur le swarm"');
  });
});
