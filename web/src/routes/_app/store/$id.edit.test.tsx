import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AppFile, AppFileList, FileSource } from "#libs/api";
import {
  getEditorCreateMockHandler,
  getEditorFilesMockHandler,
  getEditorReadMockHandler,
  getEditorWriteMockHandler,
} from "#libs/api/mock";
import { coded, network, problem } from "#mock/network.ts";
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

    // Under the editor alone: a form's refusal is no toast.
    expect(refusals.map(refusal => refusal.tagName)).toEqual(["PRE"]);
    expect(saved).toEqual([{ path: "compose.yml", body: { source: "services:\n  alpha: {}\n" } }]);
  });

  it("shows a refusal of the server under the file its code names", async () => {
    editor();
    network.use(
      getEditorWriteMockHandler(({ request }) => {
        throw coded(400, {
          code: "editor.invalid_file",
          params: { path: pathOf(request), reason: "mapping values are not allowed here" },
          message: "invalid file",
        });
      }),
    );

    renderAt("/store/alpha/edit");
    await waitFor(() => expect(editorText()).toContain("alpha: {}"));
    fireEvent.click(screen.getByRole("button", { name: "settings.yml" }));
    await waitFor(() => expect(editorText()).toContain("level: debug"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const refusal = await screen.findByText("config/settings.yml is not valid: mapping values are not allowed here.");

    expect(refusal.tagName).toBe("PRE");

    // Not the compose file's: it shows none.
    fireEvent.click(screen.getByRole("button", { name: "compose.yml" }));
    await waitFor(() => expect(editorText()).toContain("alpha: {}"));
    expect(screen.queryByText(/is not valid/)).toBeNull();
  });

  it("shows why a new file was refused under its path, which stays to be changed", async () => {
    editor();
    network.use(
      getEditorCreateMockHandler(({ request }) => {
        throw coded(400, { code: "editor.hidden_file", params: { path: pathOf(request) }, message: "hidden file" });
      }),
    );

    renderAt("/store/alpha/edit");
    await waitFor(() => expect(editorText()).toContain("alpha: {}"));
    fireEvent.click(screen.getByRole("button", { name: "New file" }));

    const path = screen.getByLabelText<HTMLInputElement>("Path of the new file");

    fireEvent.change(path, { target: { value: ".secret" } });
    fireEvent.submit(path.closest("form")!);

    const refusal = await screen.findByText(".secret leads to a hidden file.");

    expect(path.value).toBe(".secret");
    expect(path.getAttribute("aria-invalid")).toBe("true");
    expect(path.getAttribute("aria-describedby")).toBe(refusal.id);
    expect(screen.getAllByText(".secret leads to a hidden file.")).toHaveLength(1);

    fireEvent.change(path, { target: { value: "notes.md" } });

    expect(screen.queryByText(".secret leads to a hidden file.")).toBeNull();
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
