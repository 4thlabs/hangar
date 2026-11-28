import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EnvChanges, JobRun, StoreStatus, StoreSync } from "#libs/api";
import {
  getConfigReadMockHandler,
  getConfigSaveMockHandler,
  getEnvReadMockHandler,
  getEnvSaveMockHandler,
  getJobsCancelMockHandler,
  getJobsListMockHandler,
  getJobsRunMockHandler,
  getStoreAppsMockHandler,
  getStoreStatusMockHandler,
  getStoreSyncMockHandler,
} from "#libs/api/mock";
import { coded, countCalls, network, problem } from "#mock/network.ts";
import { renderAt } from "#mock/page.tsx";

const running: StoreSync = {
  operation: "update",
  state: "running",
  startedAt: "2026-11-26T10:00:00.000Z",
  finishedAt: null,
  error: null,
};

/** A store cloned from its URL, no sync running. */
const cloned: StoreStatus = { url: "https://example.com/store.git", installed: true, sync: null };

/** What `/settings` reads whatever its tab: the store's status, `cloned`, and no job run. A test's own handlers win. */
function settingsPage() {
  network.use(getStoreStatusMockHandler(cloned), getJobsListMockHandler([]));
}

afterEach(() => {
  cleanup();
});

describe("/settings", () => {
  it("reads its cards once when its link is hovered, then followed", async () => {
    const reads = countCalls();

    settingsPage();
    network.use(getStoreAppsMockHandler({ apps: [], counts: { installed: 0, available: 0 } }));
    renderAt("/store");

    const link = (await screen.findAllByRole("link", { name: "Settings" }))[0]!;

    fireEvent.mouseEnter(link);
    await waitFor(() => expect(reads("GET /api/store")).toBe(1));
    fireEvent.click(link);

    expect(await screen.findByRole("button", { name: "Update" })).toBeDefined();
    expect(reads("GET /api/store")).toBe(1);
    expect(reads("GET /api/jobs")).toBe(1);
  });
});

describe("/settings#store", () => {
  it("starts a sync, and says it runs until it ends", async () => {
    let status: StoreStatus = cloned;

    settingsPage();
    network.use(
      getStoreStatusMockHandler(() => status),
      getStoreSyncMockHandler(() => {
        status = { ...status, sync: running };

        return running;
      }),
    );

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
    settingsPage();
    network.use(getEnvReadMockHandler({ variables: { JELLYFIN_API_KEY: "secret" } }));
    renderAt("/settings#env");

    const value = await screen.findByLabelText<HTMLInputElement>("JELLYFIN_API_KEY");

    expect(value.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show the value of JELLYFIN_API_KEY" }));
    expect(value.type).toBe("text");
  });

  it("saves only what changed since the read, and says why a save is refused", async () => {
    const saved: EnvChanges[] = [];

    settingsPage();
    network.use(
      getEnvReadMockHandler({ variables: { KEPT: "1", SAME: "2", OLD: "3" } }),
      getEnvSaveMockHandler(async ({ request }) => {
        saved.push(await request.json());

        throw problem(400, "invalid variable name: 1BAD");
      }),
    );

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

describe("/settings#env, its refusals", () => {
  it("shows a refusal of the server under the variable it names, until that value changes", async () => {
    settingsPage();
    network.use(
      getEnvReadMockHandler({ variables: { KEPT: "1", SAME: "2" } }),
      getEnvSaveMockHandler(() => {
        throw coded(400, {
          code: "env.line_break",
          params: { name: "KEPT" },
          message: "the value of KEPT holds a line break",
        });
      }),
    );

    renderAt("/settings#env");

    const kept = await screen.findByLabelText<HTMLInputElement>("KEPT");

    fireEvent.change(kept, { target: { value: "one" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const refusal = await screen.findByText("The value of KEPT cannot contain a line break.");

    expect(kept.getAttribute("aria-invalid")).toBe("true");
    expect(kept.getAttribute("aria-describedby")).toBe(refusal.id);
    expect(screen.getAllByText("The value of KEPT cannot contain a line break.")).toHaveLength(1);
    expect(screen.getByLabelText("SAME").getAttribute("aria-invalid")).toBe("false");

    fireEvent.change(kept, { target: { value: "two" } });

    await waitFor(() => expect(screen.queryByText("The value of KEPT cannot contain a line break.")).toBeNull());
    expect(kept.getAttribute("aria-invalid")).toBe("false");
  });

  it("keeps a refusal with its variable when a row is added before it, or an earlier one removed", async () => {
    settingsPage();
    network.use(
      getEnvReadMockHandler({ variables: { KEPT: "1", SAME: "2", ZED: "3" } }),
      getEnvSaveMockHandler(() => {
        throw coded(400, { code: "env.line_break", params: { name: "SAME" }, message: "line break" });
      }),
    );

    renderAt("/settings#env");

    await screen.findByLabelText("SAME");

    const refusal = "The value of SAME cannot contain a line break.";
    // Read again each time: the rows' inputs are their places, which the variables move through.
    const describedBySame = () => screen.getByLabelText("SAME").getAttribute("aria-describedby");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(refusal)).toBeDefined();

    // Added before it, by name.
    fireEvent.change(screen.getByLabelText("Name of a new variable"), { target: { value: "AAA" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByLabelText("AAA");

    expect(screen.getByText(refusal).id).toBe(describedBySame());

    fireEvent.click(screen.getByRole("button", { name: "Remove KEPT" }));
    await waitFor(() => expect(screen.queryByLabelText("KEPT")).toBeNull());

    expect(screen.getByText(refusal).id).toBe(describedBySame());
    expect(screen.getByLabelText("AAA").getAttribute("aria-invalid")).toBe("false");
    expect(screen.getByLabelText("ZED").getAttribute("aria-invalid")).toBe("false");
  });

  it("keeps the refusal of the last variable when one is added before it", async () => {
    settingsPage();
    network.use(
      getEnvReadMockHandler({ variables: { KEPT: "1", SAME: "2", ZED: "3" } }),
      getEnvSaveMockHandler(() => {
        throw coded(400, { code: "env.line_break", params: { name: "ZED" }, message: "line break" });
      }),
    );

    renderAt("/settings#env");
    await screen.findByLabelText("ZED");

    const refusal = "The value of ZED cannot contain a line break.";

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(refusal)).toBeDefined();

    fireEvent.change(screen.getByLabelText("Name of a new variable"), { target: { value: "YYY" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByLabelText("YYY");

    expect(screen.getByText(refusal).id).toBe(screen.getByLabelText("ZED").getAttribute("aria-describedby"));
    expect(screen.getByLabelText("ZED").getAttribute("aria-invalid")).toBe("true");
  });

  it("keeps a refusal when a variable is removed, then another added", async () => {
    settingsPage();
    network.use(
      getEnvReadMockHandler({ variables: { KEPT: "1", SAME: "2", ZED: "3" } }),
      getEnvSaveMockHandler(() => {
        throw coded(400, { code: "env.line_break", params: { name: "ZED" }, message: "line break" });
      }),
    );

    renderAt("/settings#env");
    await screen.findByLabelText("ZED");

    const refusal = "The value of ZED cannot contain a line break.";

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(refusal)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Remove KEPT" }));
    await waitFor(() => expect(screen.queryByLabelText("KEPT")).toBeNull());
    fireEvent.change(screen.getByLabelText("Name of a new variable"), { target: { value: "AAA" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByLabelText("AAA");

    expect(screen.getByText(refusal).id).toBe(screen.getByLabelText("ZED").getAttribute("aria-describedby"));
  });

  it("forgets the refusal of a variable whose secret is generated", async () => {
    settingsPage();
    network.use(
      getEnvReadMockHandler({ variables: { KEPT: "1", ZED: "3" } }),
      getEnvSaveMockHandler(() => {
        throw coded(400, { code: "env.line_break", params: { name: "ZED" }, message: "line break" });
      }),
    );

    renderAt("/settings#env");
    await screen.findByLabelText("ZED");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The value of ZED cannot contain a line break.")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Generate a secret for ZED" }));

    expect(screen.queryByText("The value of ZED cannot contain a line break.")).toBeNull();
    expect(screen.getByLabelText("ZED").getAttribute("aria-invalid")).toBe("false");
  });

  it("forgets the refusal of a variable removed, which comes back new once added again", async () => {
    settingsPage();
    network.use(
      getEnvReadMockHandler({ variables: { KEPT: "1", ZED: "3" } }),
      getEnvSaveMockHandler(() => {
        throw coded(400, { code: "env.line_break", params: { name: "ZED" }, message: "line break" });
      }),
    );

    renderAt("/settings#env");
    await screen.findByLabelText("ZED");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The value of ZED cannot contain a line break.")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Remove ZED" }));
    await waitFor(() => expect(screen.queryByLabelText("ZED")).toBeNull());
    fireEvent.change(screen.getByLabelText("Name of a new variable"), { target: { value: "ZED" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect((await screen.findByLabelText("ZED")).getAttribute("aria-invalid")).toBe("false");
    expect(screen.queryByText("The value of ZED cannot contain a line break.")).toBeNull();
  });

  it("removes one variable for a double click on its Remove", async () => {
    const saved: EnvChanges[] = [];

    settingsPage();
    network.use(
      getEnvReadMockHandler({ variables: { KEPT: "1", SAME: "2" } }),
      getEnvSaveMockHandler(async ({ request }) => {
        saved.push(await request.json());

        return { variables: { SAME: "2" } };
      }),
    );

    renderAt("/settings#env");
    await screen.findByLabelText("KEPT");

    const remove = screen.getByRole("button", { name: "Remove KEPT" });

    fireEvent.click(remove);
    fireEvent.click(remove);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saved).toEqual([{ updates: {}, remove: ["KEPT"] }]));
  });

  it("adds nothing, and says nothing, for an Enter with no name", async () => {
    settingsPage();
    network.use(getEnvReadMockHandler({ variables: { KEPT: "1" } }));
    renderAt("/settings#env");

    const name = await screen.findByLabelText<HTMLInputElement>("Name of a new variable");

    fireEvent.keyDown(name, { key: "Enter" });

    expect(name.getAttribute("aria-invalid")).toBe("false");
    expect(screen.queryByText(/Invalid variable name/)).toBeNull();
  });

  it("retries a save the server refused, with nothing changed", async () => {
    let isDown = true;
    const calls = countCalls();

    settingsPage();
    network.use(
      getEnvReadMockHandler({ variables: { KEPT: "1" } }),
      getEnvSaveMockHandler(() => {
        if (isDown) {
          throw problem(500, "the disk is full");
        }

        return { variables: { KEPT: "one" } };
      }),
    );

    renderAt("/settings#env");

    fireEvent.change(await screen.findByLabelText("KEPT"), { target: { value: "one" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The disk is full.")).toBeDefined();

    isDown = false;
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("The global environment was saved.")).toBeDefined();
    expect(calls("PUT /api/env")).toBe(2);
  });

  it("refuses a new name compose does not take, before any save", async () => {
    const calls = countCalls();

    settingsPage();
    network.use(getEnvReadMockHandler({ variables: { KEPT: "1" } }), getEnvSaveMockHandler({ variables: {} }));
    renderAt("/settings#env");

    const name = await screen.findByLabelText<HTMLInputElement>("Name of a new variable");

    fireEvent.change(name, { target: { value: "1bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("Invalid variable name: 1BAD.")).toBeDefined();
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByLabelText("1BAD")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getAllByText("Invalid variable name: 1BAD.")).toHaveLength(1));
    expect(calls("PUT /api/env")).toBe(0);
  });
});

describe("/settings tabs", () => {
  it("read their file anew each time they open, as a sync may have changed it", async () => {
    let source = "categories: []\n";

    settingsPage();
    network.use(getConfigReadMockHandler(() => ({ source })));

    renderAt("/settings#config");

    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("categories: []"));
    // The settings' own tab, after the navbar's of the same name.
    fireEvent.click(screen.getAllByRole("tab", { name: "Store" }).at(-1)!);
    source = "categories: [pulled]\n";
    fireEvent.click(await screen.findByRole("tab", { name: "Configuration" }));

    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("categories: [pulled]"));
  });

  it("show no copy cached by an earlier visit when their file cannot be read again, but why, and a Retry", async () => {
    let isDown = false;
    let source = "categories: []\n";

    /** `read`, or the store's refusal while it is down. */
    const unlessDown = <T,>(read: () => T) => {
      if (isDown) {
        throw problem(404, "the store is not cloned yet");
      }

      return read();
    };

    settingsPage();
    network.use(
      getEnvReadMockHandler(() => unlessDown(() => ({ variables: { OLD: "1" } }))),
      getConfigReadMockHandler(() => unlessDown(() => ({ source }))),
    );

    renderAt("/settings#env");
    expect(await screen.findByLabelText("OLD")).toBeDefined();
    fireEvent.click(await screen.findByRole("tab", { name: "Configuration" }));
    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("categories: []"));

    isDown = true;
    fireEvent.click(screen.getByRole("tab", { name: "Environment" }));

    expect(await screen.findByText("Could not show the environment")).toBeDefined();
    expect(screen.getByText("The store is not cloned yet.")).toBeDefined();
    expect(screen.queryByLabelText("OLD")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Configuration" }));

    expect(await screen.findByText("Could not show the configuration")).toBeDefined();
    expect(document.querySelector(".cm-content")).toBeNull();

    isDown = false;
    source = "categories: [pulled]\n";
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("categories: [pulled]"));
  });
});

describe("/settings#config", () => {
  it("takes no typing while a save runs", async () => {
    let answer: () => void = () => {};

    settingsPage();
    network.use(
      getConfigReadMockHandler({ source: "categories: []\n" }),
      getConfigSaveMockHandler(() => new Promise<void>(resolve => (answer = resolve))),
    );

    renderAt("/settings#config");

    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("categories: []"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(document.querySelector(".cm-editor")?.closest("[inert]")).not.toBeNull());
    answer();
    await waitFor(() => expect(document.querySelector(".cm-editor")?.closest("[inert]")).toBeNull());
  });

  it("shows why hangar.yml was refused under the editor, and not in a toast", async () => {
    settingsPage();
    network.use(
      getConfigReadMockHandler({ source: "categories: []\n" }),
      getConfigSaveMockHandler(() => {
        throw problem(400, "invalid hangar.yml: categories[0].color: required");
      }),
    );

    renderAt("/settings#config");

    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("categories: []"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const refusal = await screen.findByText("Invalid hangar.yml: categories[0].color: required.");

    expect(refusal.tagName).toBe("PRE");
    expect(screen.getAllByText("Invalid hangar.yml: categories[0].color: required.")).toHaveLength(1);
  });

  it("retries a save of hangar.yml the server refused, with nothing changed", async () => {
    let isDown = true;
    const calls = countCalls();

    settingsPage();
    network.use(
      getConfigReadMockHandler({ source: "categories: []\n" }),
      getConfigSaveMockHandler(() => {
        if (isDown) {
          throw problem(500, "the disk is full");
        }
      }),
      // What a save makes stale, read again once it succeeds.
      getStoreAppsMockHandler(),
    );

    renderAt("/settings#config");

    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("categories: []"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The disk is full.")).toBeDefined();

    isDown = false;
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("The configuration was saved.")).toBeDefined();
    expect(calls("PUT /api/config")).toBe(2);
  });

  it("shows a code of hangar.yml's under the editor, until the file changes", async () => {
    settingsPage();
    network.use(
      getConfigReadMockHandler({ source: "categories: []\n" }),
      getConfigSaveMockHandler(() => {
        throw coded(400, {
          code: "config.invalid",
          params: { field: "categories[0].color", reason: "required" },
          message: "invalid hangar.yml: categories[0].color: required",
        });
      }),
    );

    renderAt("/settings#config");

    await waitFor(() => expect(document.querySelector(".cm-content")?.textContent).toContain("categories: []"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const refusal = await screen.findByRole("alert");

    expect(refusal.tagName).toBe("PRE");
    expect(refusal.textContent).toContain("categories[0].color");
  });
});

describe("/settings#jobs", () => {
  const check: JobRun = {
    id: 1,
    job: { kind: "image_check" },
    queue: "default",
    state: "failed",
    createdAt: "2026-11-26T12:17:00.000Z",
    startedAt: "2026-11-26T12:17:00.000Z",
    endedAt: "2026-11-26T12:17:01.000Z",
    error: { code: "docker.unavailable", message: "the Docker daemon could not be read. See the server's log." },
  };

  const update: JobRun = { ...check, id: 2, job: { kind: "auto_update" }, state: "completed", error: null };

  /** The job of each row the table lists, in its order. */
  const rows = () =>
    screen
      .getAllByRole("row")
      .slice(1)
      .map(row => within(row).getAllByRole("cell")[0]?.textContent);

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists the runs, the newest first, and says why one failed", async () => {
    settingsPage();
    network.use(getJobsListMockHandler([update, check]));
    renderAt("/settings#jobs");

    await screen.findByText("Update of the apps");

    expect(rows()).toEqual(["Update of the apps", "Image check"]);
    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByText("The Docker daemon could not be read. See the server's log.")).toBeDefined();
    // A run that ended cannot be canceled.
    expect(screen.queryByRole("button", { name: "Cancel the image check" })).toBeNull();
  });

  it("shows a run a cron asked for while no run waited or ran", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    let runs = [update];

    settingsPage();
    network.use(getJobsListMockHandler(() => runs));
    renderAt("/settings#jobs");

    await screen.findByText("Update of the apps");

    runs = [{ ...check, id: 3, state: "running", endedAt: null, error: null }, update];
    await act(() => vi.advanceTimersByTimeAsync(30_000));

    expect(await screen.findByText("Running")).toBeDefined();
  });

  it("names a backup by its app, in the queue of the backups", async () => {
    const backup: JobRun = {
      ...check,
      id: 4,
      job: { kind: "backup", params: { app: "alpha" } },
      queue: "backups",
      state: "running",
      endedAt: null,
      error: null,
    };

    settingsPage();
    network.use(getJobsListMockHandler([backup]));
    renderAt("/settings#jobs");

    expect(await screen.findByText("Backup of alpha")).toBeDefined();
    expect(screen.getByText("backups")).toBeDefined();
    expect(screen.getByRole("button", { name: "Run the backup of alpha again" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Cancel the backup of alpha" })).toBeDefined();
  });

  it("names a job it does not know as the server does", async () => {
    const newer = { ...check, job: { kind: "prune" } } as unknown as JobRun;

    settingsPage();
    network.use(getJobsListMockHandler([newer]));
    renderAt("/settings#jobs");

    expect(await screen.findByText("prune")).toBeDefined();
    expect(screen.getByRole("button", { name: "Run the prune again" })).toBeDefined();
  });

  it("reads the runs again once a job is asked for again, then once a run is canceled", async () => {
    // The card's polling stands still: what it shows next comes from its own reads.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    let runs = [update, check];
    const waiting: JobRun = { ...check, id: 3, state: "waiting", startedAt: null, endedAt: null, error: null };

    const asked: string[] = [];

    settingsPage();
    network.use(
      getJobsListMockHandler(() => runs),
      getJobsRunMockHandler(({ params }) => {
        asked.push(`run ${params.id}`);
        runs = [waiting, ...runs];

        return waiting;
      }),
      getJobsCancelMockHandler(({ params }) => {
        asked.push(`cancel ${params.id}`);
        runs = runs.map(run => (run.id === 3 ? { ...run, state: "canceled" } : run));

        return { ...waiting, state: "canceled" };
      }),
    );

    renderAt("/settings#jobs");

    fireEvent.click(await screen.findByRole("button", { name: "Run the image check again" }));

    expect(await screen.findByText("Image check waits its turn.")).toBeDefined();
    expect(await screen.findByText("Waiting")).toBeDefined();
    expect(rows()).toEqual(["Image check", "Update of the apps", "Image check"]);

    fireEvent.click(screen.getByRole("button", { name: "Cancel the image check" }));

    expect(await screen.findByText("Image check stops.")).toBeDefined();
    expect(await screen.findByText("Canceled")).toBeDefined();
    expect(asked).toEqual(["run 1", "cancel 3"]);
  });

  it("says why a cancel was refused, and reads the runs again", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

    let runs: JobRun[] = [{ ...update, state: "running", endedAt: null }];

    settingsPage();
    network.use(
      getJobsListMockHandler(() => runs),
      getJobsCancelMockHandler(() => {
        runs = [update];

        throw coded(409, { code: "jobs.ended", params: { run: 2 }, message: "the run 2 of a job has ended already" });
      }),
    );

    renderAt("/settings#jobs");

    fireEvent.click(await screen.findByRole("button", { name: "Cancel the update of the apps" }));

    expect(await screen.findByText("This run of a job has ended already.")).toBeDefined();
    expect(await screen.findByText("Completed")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Cancel the update of the apps" })).toBeNull();
  });
});
