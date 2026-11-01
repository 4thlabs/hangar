// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "#modules/common/mock/locale-provider.tsx";

// Tells React the updates below are wrapped in `act`.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("waku", () => ({ useRouter: () => ({ reload: () => {} }) }));
// The services come from Docker through a server action: none here.
vi.mock("#modules/store/hooks/use-app-services.ts", () => ({ useAppServices: () => null }));
// CodeMirror stands in as a textarea: the test reads and changes the draft, not the editor's rendering.
vi.mock("#modules/common/ui/code-editor.tsx", () => ({
  CodeEditor: ({ defaultValue, onChange }: { defaultValue: string; onChange: (value: string) => void }) => (
    <textarea defaultValue={defaultValue} onChange={event => onChange(event.target.value)} />
  ),
}));

const { AppEditor } = await import("./app-editor.tsx");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const saveFile = vi.fn(async () => ({ success: true as const, message: "Saved", composeChanged: false }));

/** The editor of `id`, opened on its compose file, as the page renders it. */
async function renderEditor(id: string, files: string[], composeSource: string) {
  await act(async () => {
    root.render(
      <LocaleProvider locale="en">
        <AppEditor
          id={id}
          files={files}
          initialFile={{ path: "compose.yml", source: composeSource }}
          readFile={async () => ({ success: true, source: "" })}
          saveFile={saveFile}
          createFile={async () => ({ success: true, message: "Created" })}
        />
      </LocaleProvider>,
    );
  });
}

const treeLabels = () => [...container.querySelectorAll("li button span.truncate")].map(span => span.textContent);

const draft = () => container.querySelector("textarea");

async function typeDraft(value: string) {
  const textarea = draft();

  if (!textarea) {
    throw new Error("No open file");
  }

  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;

    setValue?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("AppEditor", () => {
  it("starts over on the next app's files when the page moves to another app's editor", async () => {
    await renderEditor("alpha", ["alpha-only.env", "compose.yml"], "name: alpha\n");
    await typeDraft("name: alpha-edited\n");

    expect(treeLabels()).toEqual(["alpha-only.env", "compose.yml"]);
    expect(container.querySelector('[aria-label="unsaved changes"]')).not.toBeNull();

    await renderEditor("beta", ["compose.yml"], "name: beta\n");

    expect(treeLabels()).toEqual(["compose.yml"]);
    expect(draft()?.value).toBe("name: beta\n");
    expect(container.querySelector('[aria-label="unsaved changes"]')).toBeNull();
  });

  it("saves the draft of the app on screen under that app", async () => {
    await renderEditor("alpha", ["compose.yml"], "name: alpha\n");
    await typeDraft("name: alpha-edited\n");
    await renderEditor("beta", ["compose.yml"], "name: beta\n");

    const save = [...container.querySelectorAll("button")].find(button => button.textContent === "Save");

    await act(async () => save?.click());

    expect(saveFile).toHaveBeenLastCalledWith("beta", "compose.yml", "name: beta\n");
  });
});
