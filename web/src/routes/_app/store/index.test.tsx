import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { NewApp, StoreApp, StoreApps } from "#libs/api";
import {
  getEditorCreateAppMockHandler,
  getEditorFilesMockHandler,
  getEditorReadMockHandler,
  getStoreAppsMockHandler,
  getStoreInstallMockHandler,
  getStoreNewAppMockHandler,
  getStoreUninstallMockHandler,
} from "#libs/api/mock";
import { coded, countCalls, network, problem } from "#mock/network.ts";
import { renderAt } from "#mock/page.tsx";

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
});

describe("/store", () => {
  it("links each app to its editor", async () => {
    network.use(getStoreAppsMockHandler(listing));
    renderAt("/store");

    const edit = await screen.findByRole("link", { name: "Edit Miniflux" });

    expect(edit.getAttribute("href")).toBe("/store/miniflux/edit");
  });

  it("lists the store's apps by name", async () => {
    network.use(getStoreAppsMockHandler(listing));
    renderAt("/store");

    const cards = await screen.findAllByText(/^(Frigate|Jellyfin|Miniflux)$/);

    expect(cards.map(card => card.textContent)).toEqual(["Frigate", "Jellyfin", "Miniflux"]);
  });

  it("asks the server for the filters of the URL, and narrows by its query", async () => {
    const filters: (string | null)[] = [];

    network.use(
      getStoreAppsMockHandler(({ request }) => {
        filters.push(new URL(request.url).searchParams.get("filter"));

        return { ...listing, apps: listing.apps.slice(1) };
      }),
    );

    renderAt("/store?filter=available&q=mini");

    expect(await screen.findByText("Miniflux")).toBeDefined();
    expect(screen.queryByText("Frigate")).toBeNull();
    expect(filters).toEqual(["available"]);
    expect(screen.getByLabelText<HTMLInputElement>("Search", { selector: "#navbar-search-field" }).value).toBe("mini");
  });

  it("narrows the apps by what is typed in the navbar's search", async () => {
    network.use(getStoreAppsMockHandler(listing));
    renderAt("/store");

    await screen.findByText("Frigate");
    fireEvent.change(screen.getByLabelText("Search", { selector: "#navbar-search-field" }), {
      target: { value: "frig" },
    });

    await waitFor(() => expect(screen.queryByText("Miniflux")).toBeNull());
    expect(screen.getByText("Frigate")).toBeDefined();
  });

  it("installs an app, and reads the list again", async () => {
    let installed = false;
    const calls = countCalls();

    network.use(
      getStoreAppsMockHandler(() => ({ ...listing, apps: [app("miniflux", "Miniflux", installed)] })),
      getStoreInstallMockHandler(({ params }) => {
        installed = params.id === "miniflux";

        return app("miniflux", "Miniflux", true);
      }),
    );

    renderAt("/store");
    fireEvent.click(await screen.findByRole("button", { name: "Install Miniflux" }));

    expect(await screen.findByText("Miniflux was installed.")).toBeDefined();
    expect(await screen.findByRole("button", { name: "Uninstall Miniflux" })).toBeDefined();
    expect(calls("GET /api/store/apps")).toBe(2);
  });

  it("uninstalls an app once confirmed, and says why it could not", async () => {
    const calls = countCalls();

    network.use(
      getStoreAppsMockHandler({ ...listing, apps: [app("jellyfin", "Jellyfin", true)] }),
      getStoreUninstallMockHandler(() => {
        throw problem(500, "the uninstallation of Jellyfin failed. See the server's log.");
      }),
    );

    renderAt("/store");
    fireEvent.click(await screen.findByRole("button", { name: "Uninstall Jellyfin" }));

    const dialog = await screen.findByRole("alertdialog");

    expect(calls("POST /api/store/apps/jellyfin/uninstall")).toBe(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Uninstall" }));

    expect(await screen.findByText("The uninstallation of Jellyfin failed. See the server's log.")).toBeDefined();
  });

  it("says which field of hangar.yml is at fault when the store cannot be listed", async () => {
    network.use(
      getStoreAppsMockHandler(() => {
        throw problem(400, "invalid hangar.yml: categories[0].color: required");
      }),
    );

    renderAt("/store");

    expect(await screen.findByText("Invalid hangar.yml: categories[0].color: required.")).toBeDefined();
  });

  it("says the store has no apps, or none of the search", async () => {
    network.use(getStoreAppsMockHandler({ apps: [], counts: { installed: 0, available: 0 } }));
    renderAt("/store");

    expect(await screen.findByText("No apps available in the store.")).toBeDefined();
  });
});

describe("/store/new", () => {
  it("opens the template of the server", async () => {
    network.use(getStoreNewAppMockHandler({ compose: "name: My app\nservices: {}\n" }));
    renderAt("/store/new");

    expect(await screen.findByLabelText("Identifier")).toBeDefined();
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("name: My app"));
  });

  it("creates the app under the id typed in, then opens its editor", async () => {
    const created: NewApp[] = [];

    network.use(
      getStoreNewAppMockHandler({ compose: "name: My app\nservices: {}\n" }),
      getEditorCreateAppMockHandler(async ({ request }) => {
        created.push(await request.json());

        return app("my-app", "My app", false);
      }),
      // The editor it opens.
      getEditorFilesMockHandler({ app: app("my-app", "My app", false), files: [] }),
      getEditorReadMockHandler({ path: "compose.yml", source: "name: My app\nservices: {}\n" }),
    );

    const router = renderAt("/store/new");
    const save = await screen.findByRole("button", { name: "Save" });

    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Identifier"), { target: { value: "My-App" } });
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("name: My app"));
    fireEvent.click(save);

    await waitFor(() => expect(router.state.location.pathname).toBe("/store/my-app/edit"));
    expect(created).toEqual([{ id: "my-app", compose: "name: My app\nservices: {}\n" }]);
  });

  it("refuses an id the store does not take under its field, before any call", async () => {
    const calls = countCalls();

    network.use(getStoreNewAppMockHandler({ compose: "services: {}\n" }));
    renderAt("/store/new");

    const id = await screen.findByLabelText<HTMLInputElement>("Identifier");

    fireEvent.change(id, { target: { value: "../escape" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const refusal = await screen.findByText(/^\.\.\/escape is not an app id/);

    expect(id.getAttribute("aria-invalid")).toBe("true");
    expect(id.getAttribute("aria-describedby")).toBe(refusal.id);
    expect(calls("POST /api/store/apps")).toBe(0);
  });

  it("shows the server's refusal of the id under its field, and not in a toast", async () => {
    network.use(
      getStoreNewAppMockHandler({ compose: "services: {}\n" }),
      getEditorCreateAppMockHandler(() => {
        throw coded(409, {
          code: "editor.app_exists",
          params: { app: "jellyfin" },
          message: "the app jellyfin exists",
        });
      }),
    );

    renderAt("/store/new");

    const id = await screen.findByLabelText<HTMLInputElement>("Identifier");

    fireEvent.change(id, { target: { value: "jellyfin" } });
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("services"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("The app jellyfin already exists.")).toBeDefined();
    expect(id.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getAllByText("The app jellyfin already exists.")).toHaveLength(1);
  });

  it("retries a new app the server refused, with nothing changed", async () => {
    let isDown = true;
    const calls = countCalls();

    network.use(
      getStoreNewAppMockHandler({ compose: "name: My app\nservices: {}\n" }),
      getEditorCreateAppMockHandler(() => {
        if (isDown) {
          throw problem(500, "the disk is full");
        }

        return app("my-app", "My app", false);
      }),
      getEditorFilesMockHandler({ app: app("my-app", "My app", false), files: [] }),
      getEditorReadMockHandler({ path: "compose.yml", source: "name: My app\nservices: {}\n" }),
    );

    const router = renderAt("/store/new");

    fireEvent.change(await screen.findByLabelText("Identifier"), { target: { value: "my-app" } });
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("name: My app"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The disk is full.")).toBeDefined();

    isDown = false;
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/store/my-app/edit"));
    expect(calls("POST /api/store/apps")).toBe(2);
  });

  it("shows why compose refused the new app under the editor", async () => {
    network.use(
      getStoreNewAppMockHandler({ compose: "services: {}\n" }),
      getEditorCreateAppMockHandler(() => {
        throw problem(400, "docker rejects compose.yml:\nservices.web must be a mapping");
      }),
    );

    renderAt("/store/new");
    fireEvent.change(await screen.findByLabelText("Identifier"), { target: { value: "web" } });
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("services"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const refusals = await screen.findAllByText(/services\.web must be a mapping/);

    // Under the editor alone: a form's refusal is no toast.
    expect(refusals.map(refusal => refusal.tagName)).toEqual(["PRE"]);
  });
});
