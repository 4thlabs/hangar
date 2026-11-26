import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreStatus, StoreSync } from "#libs/api";
import { problem, renderAt, serve } from "#app/mock/page.tsx";

const running: StoreSync = {
  operation: "update",
  state: "running",
  startedAt: "2026-11-26T10:00:00.000Z",
  finishedAt: null,
  error: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/settings#store", () => {
  it("starts a sync, and says it runs until it ends", async () => {
    let status: StoreStatus = { url: "https://example.com/store.git", installed: true, sync: null };

    serve({
      "GET /api/store": () => Response.json(status),
      "POST /api/store/sync": () => {
        status = { ...status, sync: running };

        return Response.json(running, { status: 202 });
      },
    });

    renderAt("/settings#store");

    fireEvent.click(await screen.findByRole("button", { name: "Update" }));

    expect(await screen.findByText("Updating the store…")).toBeDefined();
    expect(await screen.findByText("The update of the store was started.")).toBeDefined();
    expect(screen.getByText("Synchronizing…").closest("button")).toHaveProperty("disabled", true);

    status = {
      ...status,
      sync: { ...running, state: "failed", error: "The store could not be pulled. See the server's log." },
    };

    // The card reads the store again each second while the sync runs.
    const failed = "The update of the store failed: The store could not be pulled. See the server's log.";

    expect(await screen.findByText(failed, {}, { timeout: 3000 })).toBeDefined();
    expect(screen.getByRole("button", { name: "Update" })).toHaveProperty("disabled", false);
  });
});

describe("/settings#env", () => {
  it("hides each value until shown", async () => {
    serve({ "GET /api/env": () => Response.json({ variables: { JELLYFIN_API_KEY: "secret" } }) });
    renderAt("/settings#env");

    const value = (await screen.findByLabelText("JELLYFIN_API_KEY")) as HTMLInputElement;

    expect(value.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show the value of JELLYFIN_API_KEY" }));
    expect(value.type).toBe("text");
  });

  it("saves the values changed and the variables removed, and says why a save is refused", async () => {
    const saved: unknown[] = [];

    serve({
      "GET /api/env": () => Response.json({ variables: { KEPT: "1", OLD: "2" } }),
      "PUT /api/env": body => {
        saved.push(body);

        return problem(400, "invalid variable name: 1BAD");
      },
    });

    renderAt("/settings#env");

    fireEvent.change(await screen.findByLabelText("KEPT"), { target: { value: "one" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove OLD" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Invalid variable name: 1BAD.")).toBeDefined();
    expect(saved).toEqual([{ updates: { KEPT: "one" }, remove: ["OLD"] }]);
  });
});

describe("/settings#config", () => {
  it("shows why hangar.yml was refused under the editor", async () => {
    serve({
      "GET /api/config": () => Response.json({ source: "categories: []\n" }),
      "PUT /api/config": () => problem(400, "invalid hangar.yml: categories[0].color: required"),
    });

    renderAt("/settings#config");

    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("categories: []"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findAllByText("Invalid hangar.yml: categories[0].color: required.")).toHaveLength(2);
  });
});
