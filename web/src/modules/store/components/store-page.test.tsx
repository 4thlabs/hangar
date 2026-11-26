import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreApp, StoreApps } from "#libs/api";
import { problem, renderAt, serve } from "#app/mock/page.tsx";

/** An app of the store. */
function app(id: string, name: string, installed: boolean): StoreApp {
  return { id, name, icon: null, installed, swarmReady: false };
}

const listing: StoreApps = {
  apps: [app("jellyfin", "Jellyfin", true), app("miniflux", "Miniflux", false), app("frigate", "Frigate", false)],
  counts: { installed: 1, available: 2 },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/store", () => {
  it("lists the store's apps by name", async () => {
    serve({ "GET /api/store/apps": () => Response.json(listing) });
    renderAt("/store");

    const cards = await screen.findAllByText(/^(Frigate|Jellyfin|Miniflux)$/);

    expect(cards.map(card => card.textContent)).toEqual(["Frigate", "Jellyfin", "Miniflux"]);
  });

  it("asks the server for the filters of the URL, and narrows by its query", async () => {
    const fetch = serve({
      "GET /api/store/apps?filter=available": () => Response.json({ ...listing, apps: listing.apps.slice(1) }),
    });

    renderAt("/store?filter=available&q=mini");

    expect(await screen.findByText("Miniflux")).toBeDefined();
    expect(screen.queryByText("Frigate")).toBeNull();
    expect(fetch.mock.calls.map(([url]) => url)).toContain("/api/store/apps?filter=available");
    expect((screen.getByLabelText("Search", { selector: "#navbar-search-desktop" }) as HTMLInputElement).value).toBe(
      "mini",
    );
  });

  it("narrows the apps by what is typed in the navbar's search", async () => {
    serve({ "GET /api/store/apps": () => Response.json(listing) });
    renderAt("/store");

    await screen.findByText("Frigate");
    fireEvent.change(screen.getByLabelText("Search", { selector: "#navbar-search-desktop" }), {
      target: { value: "frig" },
    });

    await waitFor(() => expect(screen.queryByText("Miniflux")).toBeNull());
    expect(screen.getByText("Frigate")).toBeDefined();
  });

  it("installs an app, and reads the list again", async () => {
    let installed = false;

    const fetch = serve({
      "GET /api/store/apps": () => Response.json({ ...listing, apps: [app("miniflux", "Miniflux", installed)] }),
      "POST /api/store/apps/miniflux/install": () => {
        installed = true;

        return Response.json(app("miniflux", "Miniflux", true));
      },
    });

    renderAt("/store");
    fireEvent.click(await screen.findByRole("button", { name: "Install Miniflux" }));

    expect(await screen.findByText("Miniflux was installed.")).toBeDefined();
    expect(await screen.findByRole("button", { name: "Uninstall Miniflux" })).toBeDefined();
    expect(fetch.mock.calls.filter(([url]) => url === "/api/store/apps")).toHaveLength(2);
  });

  it("uninstalls an app once confirmed, and says why it could not", async () => {
    const fetch = serve({
      "GET /api/store/apps": () => Response.json({ ...listing, apps: [app("jellyfin", "Jellyfin", true)] }),
      "POST /api/store/apps/jellyfin/uninstall": () =>
        problem(500, "the uninstallation of Jellyfin failed. See the server's log."),
    });

    renderAt("/store");
    fireEvent.click(await screen.findByRole("button", { name: "Uninstall Jellyfin" }));

    const dialog = await screen.findByRole("alertdialog");

    expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/uninstall"))).toBe(false);
    fireEvent.click(within(dialog).getByRole("button", { name: "Uninstall" }));

    expect(await screen.findByText("The uninstallation of Jellyfin failed. See the server's log.")).toBeDefined();
  });

  it("says the store has no apps, or none of the search", async () => {
    serve({ "GET /api/store/apps": () => Response.json({ apps: [], counts: { installed: 0, available: 0 } }) });
    renderAt("/store");

    expect(await screen.findByText("No apps available in the store.")).toBeDefined();
  });
});

describe("/store/new", () => {
  it("opens the template of the server", async () => {
    serve({ "GET /api/store/new-app": () => Response.json({ compose: "name: My app\nservices: {}\n" }) });
    renderAt("/store/new");

    expect(await screen.findByLabelText("Identifier")).toBeDefined();
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("name: My app"));
  });
});
