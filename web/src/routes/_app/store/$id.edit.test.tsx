import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AppFile, AppFileList, FileSource } from "#libs/api";
import {
  getEditorCreateMockHandler,
  getEditorFilesMockHandler,
  getEditorReadMockHandler,
  getEditorWriteMockHandler,
} from "#libs/api/mock";
import { network, problem } from "#mock/network.ts";
import { renderAt } from "#mock/page.tsx";

const alpha: AppFileList = {
  app: { id: "alpha", name: "Alpha", icon: null, installed: true, swarmReady: false },
  files: ["compose.yml", "config/settings.yml"],
};

/** The files of alpha, by path: its compose file and its settings. */
const files: Record<string, string> = {
  "compose.yml": "services:\n  alpha: {}\n",
  "config/settings.yml": "level: debug\n",
};

/** The `path` a call to a file of the editor names in its query. */
function pathOf(request: Request): string {
  return new URL(request.url).searchParams.get("path") ?? "";
}

/** What alpha's editor reads: its file list, `list`, and each of `sources`, by path. */
function editor({ list = alpha, sources = files }: { list?: AppFileList; sources?: Record<string, string> } = {}) {
  network.use(
    getEditorFilesMockHandler(list),
    getEditorReadMockHandler(({ request }): AppFile => {
      const path = pathOf(request);
      const source = sources[path];

      if (source === undefined) {
        throw problem(404, `the app alpha has no file ${path}`);
      }

      return { path, source };
    }),
  );
}

/** The text of the open file. */
const editorText = () => document.querySelector(".cm-content")?.textContent ?? "";

afterEach(() => {
  cleanup();
});

describe("/store/$id/edit", () => {
  it("opens the app on its compose file, and another file from the tree", async () => {
    editor();
    renderAt("/store/alpha/edit");

    expect(await screen.findByRole("heading", { name: "Alpha" })).toBeDefined();
    await waitFor(() => expect(editorText()).toContain("alpha: {}"));

    fireEvent.click(screen.getByRole("button", { name: "settings.yml" }));

    await waitFor(() => expect(editorText()).toContain("level: debug"));
    expect(screen.getByText("config/settings.yml", { selector: "p" })).toBeDefined();
  });

  it("opens a file whatever its name, `constructor` included", async () => {
    editor({
      list: { ...alpha, files: ["compose.yml", "constructor"] },
      sources: { ...files, constructor: "built\n" },
    });

    renderAt("/store/alpha/edit");
    await waitFor(() => expect(editorText()).toContain("alpha: {}"));
    fireEvent.click(screen.getByRole("button", { name: "constructor" }));

    await waitFor(() => expect(editorText()).toContain("built"));
    expect(screen.queryByLabelText("unsaved changes")).toBeNull();
  });

  it("saves the open file, and shows why compose refused it under the editor", async () => {
    const saved: { path: string; body: FileSource }[] = [];

    editor();
    network.use(
      getEditorWriteMockHandler(async ({ request }) => {
        saved.push({ path: pathOf(request), body: await request.json() });

        throw problem(400, "docker rejects compose.yml:\nservices.alpha.image must be a string");
      }),
    );

    renderAt("/store/alpha/edit");
    await waitFor(() => expect(editorText()).toContain("alpha: {}"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const refusals = await screen.findAllByText(/services\.alpha\.image must be a string/);

    expect(refusals.some(refusal => refusal.tagName === "PRE")).toBe(true);
    expect(saved).toEqual([{ path: "compose.yml", body: { source: "services:\n  alpha: {}\n" } }]);
  });

  it("creates a file, then opens it", async () => {
    const created: string[] = [];

    editor();
    network.use(
      getEditorCreateMockHandler(({ request }) => {
        created.push(pathOf(request));

        return { path: pathOf(request), source: "" };
      }),
    );

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
    editor();
    network.use(
      getEditorReadMockHandler(() => {
        throw problem(400, "compose.yml leads outside the app alpha");
      }),
    );

    renderAt("/store/alpha/edit");

    expect(await screen.findByText("This app cannot be edited here")).toBeDefined();
    expect(screen.getByText("Compose.yml leads outside the app alpha.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("says the store has no such app", async () => {
    const noDelta = () => {
      throw problem(404, "the store has no app delta");
    };

    network.use(getEditorFilesMockHandler(noDelta), getEditorReadMockHandler(noDelta));

    renderAt("/store/delta/edit");

    expect(await screen.findByText("The store has no app delta.")).toBeDefined();
    expect(screen.queryByText("This app cannot be edited here")).toBeNull();
  });
});
