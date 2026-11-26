import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppFileList } from "#libs/api";
import { problem, renderAt, serve } from "#app/mock/page.tsx";

const alpha: AppFileList = {
  app: { id: "alpha", name: "Alpha", icon: null, installed: true, swarmReady: false },
  files: ["compose.yml", "config/settings.yml"],
};

/** The answers of alpha's editor, its compose file and its settings. */
const answers = {
  "GET /api/store/apps/alpha/files": () => Response.json(alpha),
  "GET /api/store/apps/alpha/file?path=compose.yml": () =>
    Response.json({ path: "compose.yml", source: "services:\n  alpha: {}\n" }),
  "GET /api/store/apps/alpha/file?path=config%2Fsettings.yml": () =>
    Response.json({ path: "config/settings.yml", source: "level: debug\n" }),
};

/** The text of the open file. */
const editorText = () => document.querySelector(".cm-content")?.textContent ?? "";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("/store/$id/edit", () => {
  it("opens the app on its compose file, and another file from the tree", async () => {
    serve(answers);
    renderAt("/store/alpha/edit");

    expect(await screen.findByRole("heading", { name: "Alpha" })).toBeDefined();
    await waitFor(() => expect(editorText()).toContain("alpha: {}"));

    fireEvent.click(screen.getByRole("button", { name: "settings.yml" }));

    await waitFor(() => expect(editorText()).toContain("level: debug"));
    expect(screen.getByText("config/settings.yml", { selector: "p" })).toBeDefined();
  });

  it("opens a file whatever its name, `constructor` included", async () => {
    serve({
      ...answers,
      "GET /api/store/apps/alpha/files": () => Response.json({ ...alpha, files: ["compose.yml", "constructor"] }),
      "GET /api/store/apps/alpha/file?path=constructor": () =>
        Response.json({ path: "constructor", source: "built\n" }),
    });

    renderAt("/store/alpha/edit");
    await waitFor(() => expect(editorText()).toContain("alpha: {}"));
    fireEvent.click(screen.getByRole("button", { name: "constructor" }));

    await waitFor(() => expect(editorText()).toContain("built"));
    expect(screen.queryByLabelText("unsaved changes")).toBeNull();
  });

  it("saves the open file, and shows why compose refused it under the editor", async () => {
    const saved: unknown[] = [];

    serve({
      ...answers,
      "PUT /api/store/apps/alpha/file?path=compose.yml": body => {
        saved.push(body);

        return problem(400, "docker rejects compose.yml:\nservices.alpha.image must be a string");
      },
    });

    renderAt("/store/alpha/edit");
    await waitFor(() => expect(editorText()).toContain("alpha: {}"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const refusals = await screen.findAllByText(/services\.alpha\.image must be a string/);

    expect(refusals.some(refusal => refusal.tagName === "PRE")).toBe(true);
    expect(saved).toEqual([{ source: "services:\n  alpha: {}\n" }]);
  });

  it("creates a file, then opens it", async () => {
    const created: string[] = [];

    serve({
      ...answers,
      "POST /api/store/apps/alpha/file?path=notes.md": () => {
        created.push("notes.md");

        return Response.json({ path: "notes.md", source: "" }, { status: 201 });
      },
    });

    renderAt("/store/alpha/edit");
    await waitFor(() => expect(editorText()).toContain("alpha: {}"));
    fireEvent.click(screen.getByRole("button", { name: "New file" }));

    const path = screen.getByLabelText("Path of the new file");

    fireEvent.change(path, { target: { value: "notes.md" } });
    fireEvent.submit(path.closest("form")!);

    expect(await screen.findByText("notes.md", { selector: "p" })).toBeDefined();
    expect(created).toEqual(["notes.md"]);
    // Its row in the tree, and the toggle that names the open file below `md`.
    expect(screen.getAllByRole("button", { name: "notes.md" })).toHaveLength(2);
  });

  it("says why an app cannot be edited rather than open its compose file", async () => {
    serve({
      ...answers,
      "GET /api/store/apps/alpha/file?path=compose.yml": () => problem(400, "compose.yml leads outside the app alpha"),
    });

    renderAt("/store/alpha/edit");

    expect(await screen.findByText("This app cannot be edited here")).toBeDefined();
    expect(screen.getByText("Compose.yml leads outside the app alpha.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("says the store has no such app", async () => {
    serve({
      "GET /api/store/apps/delta/files": () => problem(404, "the store has no app delta"),
      "GET /api/store/apps/delta/file?path=compose.yml": () => problem(404, "the store has no app delta"),
    });

    renderAt("/store/delta/edit");

    expect(await screen.findByText("The store has no app delta.")).toBeDefined();
    expect(screen.queryByText("This app cannot be edited here")).toBeNull();
  });
});
