"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "#modules/common/actions/action-result.ts";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import type { AppFileResult, SaveAppFileResult } from "#modules/store/actions/manage-app.ts";
import { StoreMessages } from "#modules/store/messages.ts";

export type AppFilesOptions = {
  id: string;
  /** Every file of the app, as paths relative to its folder */
  files: string[];
  /** The file open on arrival, read by the page so the editor shows it without a round trip */
  initialFile: { path: string; source: string };
  readFile: (id: string, relativePath: string) => Promise<AppFileResult>;
  saveFile: (id: string, relativePath: string, source: string) => Promise<SaveAppFileResult>;
  createFile: (id: string, relativePath: string) => Promise<ActionResult>;
  /** Runs once a file is written, with what its save reports */
  onSaved: (result: SaveAppFileResult) => void;
};

/**
 * The files of an app, one open at a time. Every opened file keeps its draft: switching files loses
 * nothing, and a file whose draft differs from what was last read or saved counts as unsaved.
 */
export function useAppFiles({ id, files, initialFile, readFile, saveFile, createFile, onSaved }: AppFilesOptions) {
  const { run, isPending } = useServerAction();
  const { t } = useTranslation(StoreMessages);
  const [isLoading, startLoading] = useTransition();
  const [paths, setPaths] = useState(files);
  const [selectedPath, setSelectedPath] = useState(initialFile.path);
  const [savedSources, setSavedSources] = useState<Record<string, string>>({ [initialFile.path]: initialFile.source });
  const [drafts, setDrafts] = useState<Record<string, string>>({ [initialFile.path]: initialFile.source });
  // One message per file, shown under the editor while it is open, as `docker compose config` explains itself over
  // several lines. Keyed by path, a read that ends after the user moved to another file stays with its own.
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const unsavedPaths = new Set(Object.keys(drafts).filter(path => drafts[path] !== savedSources[path]));

  const setError = (relativePath: string, message: string | null) =>
    setErrors(current => ({ ...current, [relativePath]: message }));

  /** Shows why a write was refused under `relativePath`, or runs `onWritten` once it went through. */
  const settleWrite =
    <Result extends ActionResult>(relativePath: string, onWritten: (result: Result) => void) =>
    (result: Result | null) => {
      setError(relativePath, result && !result.success ? result.message : null);

      if (result?.success) {
        onWritten(result);
      }
    };

  /** Stores what a file holds on disk, which its draft then starts from or is compared to. */
  const remember = (relativePath: string, source: string) => {
    setSavedSources(current => ({ ...current, [relativePath]: source }));
    setDrafts(current => ({ ...current, [relativePath]: current[relativePath] ?? source }));
  };

  const select = (relativePath: string) => {
    setSelectedPath(relativePath);

    if (relativePath in drafts) {
      return;
    }

    setError(relativePath, null);
    startLoading(async () => {
      try {
        const result = await readFile(id, relativePath);

        if (!result.success) {
          setError(relativePath, result.message);

          return;
        }

        remember(relativePath, result.source);
      } catch (readError) {
        console.error("Reading an app file failed", readError);
        setError(relativePath, t("editor.readFailed"));
      }
    });
  };

  const updateDraft = (source: string) => setDrafts(current => ({ ...current, [selectedPath]: source }));

  const save = () => {
    const relativePath = selectedPath;
    const source = drafts[relativePath];

    if (source === undefined) {
      return;
    }

    run(
      () => saveFile(id, relativePath, source),
      { success: t("editor.fileSaved"), error: t("editor.fileRejected") },
      settleWrite(relativePath, result => {
        setSavedSources(current => ({ ...current, [relativePath]: source }));
        onSaved(result);
      }),
    );
  };

  /** Creates an empty file, then opens it; a listed one is just opened, and the server refuses any other existing path. */
  const create = (relativePath: string) => {
    if (paths.includes(relativePath)) {
      select(relativePath);

      return;
    }

    run(
      () => createFile(id, relativePath),
      { success: t("editor.fileCreated"), error: t("editor.fileRejected") },
      // Until it exists, the new file has no editor to show a refusal under: the open file's does.
      settleWrite(selectedPath, () => {
        setPaths(current => [...current, relativePath].sort());
        remember(relativePath, "");
        setSelectedPath(relativePath);
      }),
    );
  };

  return {
    paths,
    selectedPath,
    selectedDraft: drafts[selectedPath],
    unsavedPaths,
    error: errors[selectedPath] ?? null,
    isLoading,
    isPending,
    select,
    updateDraft,
    save,
    create,
  };
}
