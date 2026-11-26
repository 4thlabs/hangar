import { queryOptions, type QueryClient, type QueryKey } from "@tanstack/react-query";
import {
  getConfigReadQueryKey,
  getConfigReadQueryOptions,
  getConfigSaveMutationOptions,
  getEnvReadQueryKey,
  getEnvReadQueryOptions,
  getEnvSaveMutationOptions,
  getJobsCancelMutationOptions,
  getJobsListQueryKey,
  getJobsRunMutationOptions,
  getStoreAppsQueryKey,
  getStoreStatusQueryKey,
  getStoreSyncMutationOptions,
  jobsList,
  storeStatus,
  type StoreStatus,
} from "#libs/api";
import { jobsPollDelay } from "#modules/settings/helpers/job-text.ts";
import { syncPollMs } from "#modules/settings/helpers/store-sync.ts";

/**
 * How a file the page edits is read: anew each time its card opens, as a sync or an install may have changed it since,
 * and shown from that read alone (`isFetchedAfterMount`); not when the window gets the focus back, nor once the network
 * is back, which would load the file over what is being typed.
 */
const editedFile = { staleTime: Infinity, refetchOnMount: "always", refetchOnWindowFocus: false } as const;

/** The reads of the settings' cards. */
export const settingsQueries = {
  /** `.env.global`, edited. */
  env: () => getEnvReadQueryOptions({ query: editedFile }),
  /** `hangar.yml`, edited. */
  config: () => getConfigReadQueryOptions({ query: editedFile }),
  // The two below are read in their cards' regions, and warmed by the route's loader: they are built on orval's key and
  // fetcher, as orval's options type their function as possibly `skipToken`, which a suspense query and
  // `prefetchQuery` refuse under `exactOptionalPropertyTypes`.

  /** The store's URL, whether it is cloned, and its sync: read again each second while a sync runs. */
  storeStatus: () =>
    queryOptions({
      queryKey: getStoreStatusQueryKey(),
      queryFn: ({ signal }) => storeStatus({ signal }),
      refetchInterval: query => (query.state.data?.sync?.state === "running" ? syncPollMs : false),
    }),
  /** The runs of the server's jobs: read again each second while one waits or runs, and every 30 seconds otherwise. */
  jobs: () =>
    queryOptions({
      queryKey: getJobsListQueryKey(),
      queryFn: ({ signal }) => jobsList({ signal }),
      refetchInterval: query => jobsPollDelay(query.state.data ?? []),
    }),
};

/** What a sync that ended may have changed: the apps it linked, the hangar.yml it brought, the .env.global it seeded. */
export const staleAfterSync: readonly QueryKey[] = [
  getStoreAppsQueryKey(),
  getConfigReadQueryKey(),
  getEnvReadQueryKey(),
];

/** The changes of the settings' cards. */
export const settingsMutations = {
  /** Saves `.env.global`: the answer is the file as written, which the card starts again from. */
  saveEnv: () =>
    getEnvSaveMutationOptions({
      mutation: {
        onSuccess: (written, _variables, _onMutateResult, { client }) =>
          client.setQueryData(getEnvReadQueryKey(), written),
      },
    }),
  /**
   * Saves `hangar.yml`: the file as written, and the apps it links, are read again, and the save stays pending until
   * they are, so that the editor, which takes no typing meanwhile, opens on what was saved.
   */
  saveConfig: () =>
    getConfigSaveMutationOptions({
      mutation: { meta: { invalidates: [getConfigReadQueryKey(), getStoreAppsQueryKey()] } },
    }),
  /** Starts a sync of the store: the answer is the sync as it starts, which the status holds from then on. */
  syncStore: () =>
    getStoreSyncMutationOptions({
      mutation: {
        onSuccess: (started, _variables, _onMutateResult, { client }) =>
          client.setQueryData(getStoreStatusQueryKey(), (previous: StoreStatus | undefined) =>
            previous ? { ...previous, sync: started } : previous,
          ),
      },
    }),
  /** Asks for a run again; the runs are read again whatever the outcome, as a run refused has changed since. */
  runJob: () =>
    getJobsRunMutationOptions({
      mutation: { onSettled: (_data, _error, _variables, _onMutateResult, { client }) => readJobsAgain(client) },
    }),
  /** Cancels a run; the runs are read again whatever the outcome, as a run that ended has changed since. */
  cancelJob: () =>
    getJobsCancelMutationOptions({
      mutation: { onSettled: (_data, _error, _variables, _onMutateResult, { client }) => readJobsAgain(client) },
    }),
};

/** Reads the runs of the jobs again. */
function readJobsAgain(client: QueryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: getJobsListQueryKey() });
}
