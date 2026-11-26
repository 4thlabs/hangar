import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobRun, StoreStatus, StoreSync } from "#libs/api";
import { coded, problem, renderAt, serve } from "#app/mock/page.tsx";

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
      sync: {
        ...running,
        state: "failed",
        error: { code: "store.pull_failed", message: "the store could not be pulled. See the server's log." },
      },
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

  it("saves only what changed since the read, and says why a save is refused", async () => {
    const saved: unknown[] = [];

    serve({
      "GET /api/env": () => Response.json({ variables: { KEPT: "1", SAME: "2", OLD: "3" } }),
      "PUT /api/env": body => {
        saved.push(body);

        return problem(400, "invalid variable name: 1BAD");
      },
    });

    renderAt("/settings#env");

    fireEvent.change(await screen.findByLabelText("KEPT"), { target: { value: "one" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove OLD" }));
    fireEvent.change(screen.getByLabelText("Name of a new variable"), { target: { value: "new_key" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Invalid variable name: 1BAD.")).toBeDefined();
    // SAME, as it was read, is not sent: a change made to the file since the read stays.
    expect(saved).toEqual([{ updates: { KEPT: "one", NEW_KEY: "" }, remove: ["OLD"] }]);
  });
});

describe("/settings tabs", () => {
  it("read their file anew each time they open, as a sync may have changed it", async () => {
    let source = "categories: []\n";

    serve({
      "GET /api/config": () => Response.json({ source }),
      "GET /api/store": () => Response.json({ url: "u", installed: true, sync: null }),
    });

    renderAt("/settings#config");

    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("categories: []"));
    // The settings' own tab, after the navbar's of the same name.
    fireEvent.click(screen.getAllByRole("tab", { name: "Store" }).at(-1)!);
    source = "categories: [pulled]\n";
    fireEvent.click(await screen.findByRole("tab", { name: "Configuration" }));

    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("categories: [pulled]"));
  });
});

describe("/settings#config", () => {
  it("takes no typing while a save runs", async () => {
    let answer: (response: Response) => void = () => {};

    serve({
      "GET /api/config": () => Response.json({ source: "categories: []\n" }),
      "PUT /api/config": () => new Promise<Response>(resolve => (answer = resolve)),
    });

    renderAt("/settings#config");

    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("categories: []"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(document.querySelector(".cm-editor")?.closest("[inert]")).not.toBeNull());
    answer(new Response(null, { status: 204 }));
    await waitFor(() => expect(document.querySelector(".cm-editor")?.closest("[inert]")).toBeNull());
  });

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

describe("/settings#jobs", () => {
  const check: JobRun = {
    id: 1,
    job: "image_check",
    queue: "default",
    state: "failed",
    createdAt: "2026-11-26T12:17:00.000Z",
    startedAt: "2026-11-26T12:17:00.000Z",
    endedAt: "2026-11-26T12:17:01.000Z",
    error: { code: "docker.unavailable", message: "the Docker daemon could not be read. See the server's log." },
  };

  const update: JobRun = {
    ...check,
    id: 2,
    job: "auto_update",
    state: "running",
    endedAt: null,
    error: null,
  };

  it("lists the runs, the newest first, and says why one failed", async () => {
    serve({ "GET /api/jobs": () => Response.json([update, check]) });
    renderAt("/settings#jobs");

    expect(await screen.findByText("Update of the apps")).toBeDefined();
    expect(screen.getByText("Image check")).toBeDefined();
    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByText("The Docker daemon could not be read. See the server's log.")).toBeDefined();
    // A run that ended cannot be canceled.
    expect(screen.queryByRole("button", { name: "Cancel the image check" })).toBeNull();
  });

  it("runs a job again and cancels a run, then reads the runs again", async () => {
    let runs = [update, check];
    const asked: string[] = [];

    serve({
      "GET /api/jobs": () => Response.json(runs),
      "POST /api/jobs/1/run": () => {
        asked.push("run 1");
        runs = [{ ...check, id: 3, state: "waiting", startedAt: null, endedAt: null, error: null }, ...runs];

        return Response.json(runs[0]);
      },
      "POST /api/jobs/2/cancel": () => {
        asked.push("cancel 2");
        runs = runs.map(run => (run.id === 2 ? { ...run, state: "canceled" } : run));

        return Response.json(runs.find(run => run.id === 2));
      },
    });

    renderAt("/settings#jobs");

    fireEvent.click(await screen.findByRole("button", { name: "Run the image check again" }));

    expect(await screen.findByText("Image check waits its turn.")).toBeDefined();
    expect(await screen.findByText("Waiting")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Cancel the update of the apps" }));

    expect(await screen.findByText("Update of the apps stops.")).toBeDefined();
    expect(await screen.findByText("Canceled")).toBeDefined();
    expect(asked).toEqual(["run 1", "cancel 2"]);
  });

  it("says why a cancel was refused", async () => {
    serve({
      "GET /api/jobs": () => Response.json([update]),
      "POST /api/jobs/2/cancel": () => coded(409, "jobs.ended", "the run 2 of a job has ended already", { run: 2 }),
    });

    renderAt("/settings#jobs");

    fireEvent.click(await screen.findByRole("button", { name: "Cancel the update of the apps" }));

    expect(await screen.findByText("This run of a job has ended already.")).toBeDefined();
  });
});
