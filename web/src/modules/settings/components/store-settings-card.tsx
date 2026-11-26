import { useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  getConfigReadQueryKey,
  getEnvReadQueryKey,
  getStoreAppsQueryKey,
  getStoreStatusQueryKey,
  useStoreStatus,
  useStoreSync,
  type StoreStatus,
} from "#libs/api";
import { ActionToast } from "#modules/common/action-toast.ts";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { ErrorMessage } from "#modules/common/error-message.ts";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";
import { StoreSyncText } from "#modules/settings/store-sync-text.ts";

/**
 * The store's URL, whether it is cloned, and its sync: started here, run by the server apart from the request, and
 * read again until it ends, by this page or another that comes back to it.
 */
export function StoreSettingsCard() {
  const queryClient = useQueryClient();

  const { data: status, error } = useStoreStatus({
    query: { refetchInterval: query => (query.state.data?.sync?.state === "running" ? StoreSyncText.PollMs : false) },
  });

  const sync = useStoreSync({
    mutation: {
      onSuccess: started => {
        queryClient.setQueryData(getStoreStatusQueryKey(), (previous: StoreStatus | undefined) =>
          previous ? { ...previous, sync: started } : previous,
        );

        ActionToast.success("Synchronization started", StoreSyncText.started(started));
      },
      onError: failure => ActionToast.failure("Launch failed", failure),
    },
  });

  const isRunning = status?.sync?.state === "running";
  const wasRunning = useRef(false);

  // A sync that ended may have linked other apps, brought another hangar.yml and seeded .env.global.
  useEffect(() => {
    if (wasRunning.current && !isRunning) {
      for (const queryKey of [getStoreAppsQueryKey(), getConfigReadQueryKey(), getEnvReadQueryKey()]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    }

    wasRunning.current = isRunning;
  }, [isRunning, queryClient]);

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>STORE</CardTitle>
        <CardDescription>See the configured repository and synchronize its local copy.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="store-url">Store URL</FieldLabel>
            <Input id="store-url" value={status?.url ?? ""} readOnly aria-describedby="store-status" />
            <FieldDescription id="store-status">
              {error && ErrorMessage.of(error)}
              {status && (status.installed ? "The store is installed locally." : "The store is not installed yet.")}
              {status?.sync && (
                <>
                  <br />
                  <span role="status">{StoreSyncText.of(status.sync)}</span>
                </>
              )}
            </FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <PendingButton
          type="button"
          pending={sync.isPending || isRunning}
          pendingLabel="Synchronizing…"
          disabled={!status}
          icon={
            status?.installed ? <RefreshCwIcon data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />
          }
          onClick={() => sync.mutate()}
        >
          {status?.installed ? "Update" : "Install"}
        </PendingButton>
      </CardFooter>
    </Card>
  );
}
