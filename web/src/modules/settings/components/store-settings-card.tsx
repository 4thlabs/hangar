import { useMutation, useQuery } from "@tanstack/react-query";
import { DownloadIcon, RefreshCwIcon } from "lucide-react";
import type { StoreStatus } from "#libs/api";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { QueryRegion } from "#modules/common/components/region.tsx";
import { toastFailure, toastSuccess } from "#modules/common/components/toast.ts";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";
import { Skeleton } from "#modules/common/ui/skeleton.tsx";
import { settingsMutations, settingsQueries } from "#modules/settings/api/settings-queries.ts";
import { describeSync, syncStartedText } from "#modules/settings/helpers/store-sync.ts";
import { useSyncEnd } from "#modules/settings/hooks/use-sync-end.ts";
import { m } from "#paraglide/messages.js";

/**
 * The store's URL, whether it is cloned, and its sync: started here, run by the server apart from the request, and
 * read again until it ends, by this page or another that comes back to it.
 */
export function StoreSettingsCard() {
  const status = useQuery(settingsQueries.storeStatus());

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>{m.settings_store_title()}</CardTitle>
        <CardDescription>{m.settings_store_description()}</CardDescription>
      </CardHeader>
      <QueryRegion
        query={status}
        failure={m.settings_store_read_failed()}
        fallback={
          <CardContent>
            <Skeleton className="h-16 w-full" />
          </CardContent>
        }
      >
        {read => <StoreStatusContent status={read} error={status.error} />}
      </QueryRegion>
    </Card>
  );
}

type StoreStatusContentProps = {
  status: StoreStatus;
  /** Why the last read failed, when the status shown is that of an earlier one. */
  error: Error | null;
};

/** The store as the server last said, and its sync; a read again that fails says why under the URL. */
function StoreStatusContent({ status, error }: StoreStatusContentProps) {
  const sync = useMutation(settingsMutations.syncStore());
  const isRunning = status.sync?.state === "running";

  useSyncEnd(isRunning);

  const start = () =>
    sync.mutate(undefined, {
      onSuccess: started => toastSuccess(m.settings_store_sync_started(), syncStartedText(started)),
      onError: failure => toastFailure(m.settings_store_launch_failed(), failure),
    });

  return (
    <>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="store-url">{m.settings_store_url()}</FieldLabel>
            <Input id="store-url" value={status.url} readOnly aria-describedby="store-status" />
            <FieldDescription id="store-status">
              {error && describeError(error)}
              {status.installed ? m.settings_store_installed() : m.settings_store_not_installed()}
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
          pendingLabel={m.settings_store_synchronizing()}
          icon={
            status.installed ? <RefreshCwIcon data-icon="inline-start" /> : <DownloadIcon data-icon="inline-start" />
          }
          onClick={start}
        >
          {status.installed ? m.settings_store_update() : m.settings_store_install()}
        </PendingButton>
      </CardFooter>
    </>
  );
}
