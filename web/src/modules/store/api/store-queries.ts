import {
  getEditorCreateAppMutationOptions,
  getEditorCreateMutationOptions,
  getEditorFilesQueryOptions,
  getEditorReadQueryOptions,
  getEditorWriteMutationOptions,
  getEnvReadQueryKey,
  getStoreAppsQueryKey,
  getStoreAppsQueryOptions,
  getStoreInstallMutationOptions,
  getStoreNewAppQueryOptions,
  getStoreUninstallMutationOptions,
  type AppFilter,
} from "#libs/api";

/**
 * How the editor reads an app: anew each time its page opens, as a sync or an install may have changed it since, and
 * shown from that read alone (`isFetchedAfterMount`); not when the window gets the focus back, which would load the file
 * over what is being typed. A file opened from the tree is read with `staleTime: 0`, never from the cache.
 */
const editedFile = { staleTime: Infinity, refetchOnMount: "always", refetchOnWindowFocus: false } as const;

/** The reads of the store and of its editor. */
export const storeQueries = {
  /** The store's apps and their counts, by the filters the server applies; all of them for none. */
  apps: (filters: readonly AppFilter[]) =>
    getStoreAppsQueryOptions(filters.length > 0 ? { filter: [...filters] } : undefined),
  /** The template of a new app's `compose.yml`, which does not change while the server runs. */
  newApp: () => getStoreNewAppQueryOptions({ query: { staleTime: Infinity } }),
  /** Every file of the app `id`, as paths in its folder. */
  files: (id: string) => getEditorFilesQueryOptions(id, { query: editedFile }),
  /** The file at `path` of the app `id`, as the editor opens it. */
  file: (id: string, path: string) => getEditorReadQueryOptions(id, { path }, { query: editedFile }),
  /** The file at `path` of the app `id`, read anew from the server, never from the cache: another save may have changed it. */
  freshFile: (id: string, path: string) => getEditorReadQueryOptions(id, { path }, { query: { staleTime: 0 } }),
};

/** The changes of the store and of its editor. */
export const storeMutations = {
  /**
   * Installs an app. The list and its counts follow, whatever the outcome, as another process may have made the change
   * meanwhile, and so does `.env.global`, which an install seeds with the variables the app references, even one that
   * fails after the seed.
   */
  install: () =>
    getStoreInstallMutationOptions({
      mutation: {
        onSettled: (_data, _error, _variables, _onMutateResult, { client }) =>
          Promise.all([
            client.invalidateQueries({ queryKey: getStoreAppsQueryKey() }),
            client.invalidateQueries({ queryKey: getEnvReadQueryKey() }),
          ]),
      },
    }),
  /** Uninstalls an app. The list and its counts follow, whatever the outcome. */
  uninstall: () =>
    getStoreUninstallMutationOptions({
      mutation: {
        onSettled: (_data, _error, _variables, _onMutateResult, { client }) =>
          client.invalidateQueries({ queryKey: getStoreAppsQueryKey() }),
      },
    }),
  /** Adds a new app to the store, which lists it from then on. */
  createApp: () => getEditorCreateAppMutationOptions({ mutation: { meta: { invalidates: [getStoreAppsQueryKey()] } } }),
  /**
   * Writes a file of an app. A compose file may rename the app or change its icon, which the editor and the store show:
   * the server says so, as a symlink or another case may lead to it, and the store's apps are read again, the app's
   * files under them. The drafts stay, as the editor is keyed on the app alone.
   */
  writeFile: () =>
    getEditorWriteMutationOptions({
      mutation: {
        onSuccess: ({ composeChanged }, _variables, _onMutateResult, { client }) => {
          if (composeChanged) {
            void client.invalidateQueries({ queryKey: getStoreAppsQueryKey() });
          }
        },
      },
    }),
  /** Creates an empty file in an app. */
  createFile: () => getEditorCreateMutationOptions(),
};
