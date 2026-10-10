"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "#modules/common/actions/action-result.ts";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import type { AppFileResult } from "#modules/store/actions/app-file-result.ts";

const SAVE_TITLES = { success: "Fichier enregistré", error: "Fichier refusé" };
const CREATE_TITLES = { success: "Fichier créé", error: "Fichier refusé" };
const READ_FAILED = "Impossible de lire ce fichier. Réessayez.";

export type AppFilesOptions = {
  id: string;
  /** Every file of the app, as paths relative to its folder */
  files: string[];
  /** The file open on arrival, read by the page so the editor shows it without a round trip */
  initialFile: { path: string; source: string };
  readFile: (id: string, relativePath: string) => Promise<AppFileResult>;
  saveFile: (id: string, relativePath: string, source: string) => Promise<ActionResult>;
  /** Runs once a file is written, with its path */
  onSaved: (relativePath: string) => void;
};

/**
 * The files of an app, one open at a time. Every opened file keeps its draft: switching files loses
 * nothing, and a file whose draft differs from what was last read or saved counts as unsaved.
 */
export function useAppFiles({ id, files, initialFile, readFile, saveFile, onSaved }: AppFilesOptions) {
  const { run, isPending } = useServerAction();
  const [isLoading, startLoading] = useTransition();
  const [paths, setPaths] = useState(files);
  const [selectedPath, setSelectedPath] = useState(initialFile.path);
  const [savedSources, setSavedSources] = useState<Record<string, string>>({ [initialFile.path]: initialFile.source });
  const [drafts, setDrafts] = useState<Record<string, string>>({ [initialFile.path]: initialFile.source });
  // One message, for the open file: a refusal stays under the editor, as `docker compose config` explains itself over several lines.
  const [error, setError] = useState<string | null>(null);

  const unsavedPaths = new Set(Object.keys(drafts).filter(path => drafts[path] !== savedSources[path]));

  /** Stores what a file holds on disk, which its draft then starts from or is compared to. */
  const remember = (relativePath: string, source: string) => {
    setSavedSources(current => ({ ...current, [relativePath]: source }));
    setDrafts(current => ({ ...current, [relativePath]: current[relativePath] ?? source }));
  };

  const select = (relativePath: string) => {
    setSelectedPath(relativePath);
    setError(null);

    if (relativePath in drafts) {
      return;
    }

    startLoading(async () => {
      try {
        const result = await readFile(id, relativePath);

        if (result.source === undefined) {
          setError(result.message);

          return;
        }

        remember(relativePath, result.source);
      } catch (readError) {
        console.error("Reading an app file failed", readError);
        setError(READ_FAILED);
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
      SAVE_TITLES,
      result => {
        setError(result && !result.success ? result.message : null);

        if (result?.success) {
          setSavedSources(current => ({ ...current, [relativePath]: source }));
          onSaved(relativePath);
        }
      },
    );
  };

  /** Creates an empty file through the same validated write, then opens it; an existing one is just opened. */
  const create = (relativePath: string) => {
    if (paths.includes(relativePath)) {
      select(relativePath);

      return;
    }

    run(
      () => saveFile(id, relativePath, ""),
      CREATE_TITLES,
      result => {
        setError(result && !result.success ? result.message : null);

        if (result?.success) {
          setPaths(current => [...current, relativePath].sort());
          remember(relativePath, "");
          setSelectedPath(relativePath);
        }
      },
    );
  };

  return {
    paths,
    selectedPath,
    selectedDraft: drafts[selectedPath],
    unsavedPaths,
    error,
    isLoading,
    isPending,
    select,
    updateDraft,
    save,
    create,
  };
}
