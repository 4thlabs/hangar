import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { DownloadIcon, RefreshCwIcon } from "lucide-react";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { Region } from "#modules/common/components/region.tsx";
import { toastFailure, toastSuccess } from "#modules/common/components/toast.ts";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";
import { Skeleton } from "#modules/common/ui/skeleton.tsx";
import { settingsMutations, settingsQueries } from "#modules/settings/api/settings-queries.ts";
import { describeSync, syncStartedText } from "#modules/settings/helpers/store-sync.ts";
import { useSyncEnd } from "#modules/settings/hooks/use-sync-end.ts";

/**
 * The store's URL, whether it is cloned, and its sync: started here, run by the server apart from the request, and
 * read again until it ends, by this page or another that comes back to it.
 */
export function StoreSettingsCard() {
  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>STORE</CardTitle>
        <CardDescription>See the configured repository and synchronize its local copy.</CardDescription>
      </CardHeader>
      <Region
        failure="Could not read the store"
        fallback={
          <CardContent>
            <Skeleton className="h-16 w-full" />
          </CardContent>
        }
      >
        <StoreStatusContent />
      </Region>
    </Card>
  );
}

/** The store as the server last said, and its sync; a read again that fails says why under the URL. */
function StoreStatusContent() {
  const { data: status, error } = useSuspenseQuery(settingsQueries.storeStatus());
  const sync = useMutation(settingsMutations.syncStore());
  const isRunning = status.sync?.state === "running";

  useSyncEnd(isRunning);

  const start = () =>
    sync.mutate(undefined, {
      onSuccess: started => toastSuccess("Synchronization started", syncStartedText(started)),
      onError: failure => toastFailure("Launch failed", failure),
    });

  return (
    <>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="store-url">Store URL</FieldLabel>
            <Input id="store-url" value={status.url} readOnly aria-describedby="store-status" />
            <FieldDescription id="store-status">
              {error && describeError(error)}
              {status.installed ? "The store is installed locally." : "The store is not installed yet."}
              {status.sync && (
                <>
                  <br />
                  <span role="status">{describeSync(status.sync)}</span>
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
          icon={
            status.installed ? <RefreshCwIcon data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />
          }
          onClick={start}
        >
          {status.installed ? "Update" : "Install"}
        </PendingButton>
      </CardFooter>
    </>
  );
}
