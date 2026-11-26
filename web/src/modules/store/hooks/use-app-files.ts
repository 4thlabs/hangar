import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getEditorReadQueryOptions, useEditorCreate, useEditorWrite, type AppFile, type SavedFile } from "#libs/api";
import { toastFailure, toastSuccess } from "#modules/common/components/toast.ts";
import { describeError } from "#modules/common/error-message.ts";

export type AppFilesOptions = {
  id: string;
  /** Every file of the app, as paths in its folder */
  files: string[];
  /** The file open on arrival, read with the page so the editor shows it at once */
  initialFile: AppFile;
  /** Runs once a file is written, with what its save reports */
  onSaved: (saved: SavedFile) => void;
};

/**
 * The files of an app, one open at a time. Every file opened keeps its draft: moving to another file loses nothing,
 * and a file whose draft differs from what was last read or saved counts as unsaved.
 */
export function useAppFiles({ id, files, initialFile, onSaved }: AppFilesOptions) {
  const queryClient = useQueryClient();
  const [paths, setPaths] = useState(files);
  const [selectedPath, setSelectedPath] = useState(initialFile.path);
  // Maps, not objects: a file may be named `constructor` or `toString`.
  const [savedSources, setSavedSources] = useState(() => new Map([[initialFile.path, initialFile.source]]));
  const [drafts, setDrafts] = useState(() => new Map([[initialFile.path, initialFile.source]]));
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  // One message per file, shown under the editor while it is open, as compose explains itself over several lines.
  // Keyed by path, so that a read that ends once another file is open stays with its own.
  const [errors, setErrors] = useState(() => new Map<string, string | null>());
  const write = useEditorWrite();
  const create = useEditorCreate();

  const unsavedPaths = new Set([...drafts.keys()].filter(path => drafts.get(path) !== savedSources.get(path)));

  const setError = (path: string, message: string | null) => setErrors(current => new Map(current).set(path, message));

  /** Keeps what a file holds on disk, which its draft then starts from or is compared to. */
  const remember = (path: string, source: string) => {
    setSavedSources(current => new Map(current).set(path, source));
    setDrafts(current => new Map(current).set(path, current.get(path) ?? source));
  };

  const select = (path: string) => {
    setSelectedPath(path);

    if (drafts.has(path)) {
      return;
    }

    setError(path, null);
    setLoadingPath(path);
    // Read anew, never from a cache: another save, or a sync, may have changed it.
    queryClient
      .fetchQuery({ ...getEditorReadQueryOptions(id, { path }), staleTime: 0 })
      .then(file => remember(path, file.source))
      .catch((error: unknown) => setError(path, describeError(error)))
      .finally(() => setLoadingPath(current => (current === path ? null : current)));
  };

  const updateDraft = (source: string) => setDrafts(current => new Map(current).set(selectedPath, source));

  const save = () => {
    const path = selectedPath;
    const source = drafts.get(path);

    if (source === undefined) {
      return;
    }

    write.mutate(
      { id, params: { path }, data: { source } },
      {
        onSuccess: saved => {
          setError(path, null);
          setSavedSources(current => new Map(current).set(path, source));
          toastSuccess("File saved", `${path} was saved.`);
          onSaved(saved);
        },
        onError: error => {
          setError(path, describeError(error));
          toastFailure("File rejected", error);
        },
      },
    );
  };

  /** Creates an empty file, then opens it; one listed already is opened, and the server refuses any other path taken. */
  const createFile = (path: string) => {
    if (paths.includes(path)) {
      select(path);

      return;
    }

    // Until it exists, the new file has no editor to show a refusal under: the open file's does.
    const openPath = selectedPath;

    create.mutate(
      { id, params: { path } },
      {
        onSuccess: () => {
          setError(openPath, null);
          setPaths(current => [...current, path].sort());
          remember(path, "");
          setSelectedPath(path);
          toastSuccess("File created", `${path} was created.`);
        },
        onError: error => {
          setError(openPath, describeError(error));
          toastFailure("File rejected", error);
        },
      },
    );
  };

  return {
    paths,
    selectedPath,
    selectedDraft: drafts.get(selectedPath),
    unsavedPaths,
    error: errors.get(selectedPath) ?? null,
    isLoading: loadingPath === selectedPath,
    isPending: write.isPending || create.isPending,
    select,
    updateDraft,
    save,
    create: createFile,
  };
}
