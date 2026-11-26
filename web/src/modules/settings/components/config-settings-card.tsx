import { useQueryClient } from "@tanstack/react-query";
import { SaveIcon } from "lucide-react";
import { getConfigReadQueryKey, getStoreAppsQueryKey, useConfigRead, useConfigSave } from "#libs/api";
import { ActionToast } from "#modules/common/action-toast.ts";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { ErrorMessage } from "#modules/common/error-message.ts";
import { useYamlEditor } from "#modules/common/hooks/use-yaml-editor.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";

/** `hangar.yml`, edited as it is written, and checked by the server before it is saved. */
export function ConfigSettingsCard() {
  // Read anew each time the tab opens, as a sync or an install may have changed the file since, and shown from that
  // read alone; not when the window gets the focus back, which would load the file over what is being typed.
  const { data, dataUpdatedAt, isFetchedAfterMount, error } = useConfigRead({
    query: { staleTime: Infinity, refetchOnMount: "always", refetchOnWindowFocus: false },
  });

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>CONFIGURATION</CardTitle>
        <CardDescription>
          The store's <code>hangar.yml</code> file: categories, shared files and dashboard widgets. It is validated
          before it is written.
        </CardDescription>
      </CardHeader>
      {error && (
        <CardContent>
          <p className="text-sm text-destructive">{ErrorMessage.describe(error)}</p>
        </CardContent>
      )}
      {data && isFetchedAfterMount && <ConfigEditor key={dataUpdatedAt} source={data.source} />}
    </Card>
  );
}

/** The file being edited, and its save. */
function ConfigEditor({ source }: { source: string }) {
  const queryClient = useQueryClient();
  const { editor, value, setRefusal } = useYamlEditor({ source, className: "h-[60vh]" });

  const save = useConfigSave({
    mutation: {
      onSuccess: async () => {
        setRefusal(null);
        ActionToast.success("Configuration saved", "The configuration was saved.");
        // The file as written, and the apps it links, are read again; the save stays pending until they are, so
        // that the editor, which takes no typing meanwhile, opens on what was saved.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: getConfigReadQueryKey() }),
          queryClient.invalidateQueries({ queryKey: getStoreAppsQueryKey() }),
        ]);
      },
      onError: failure => {
        setRefusal(ErrorMessage.describe(failure));
        ActionToast.failure("Configuration rejected", failure);
      },
    },
  });

  return (
    <>
      {/* Inert while the save runs: the editor opens again on the file saved, which would drop what is typed meanwhile. */}
      <CardContent className="flex flex-col gap-3" inert={save.isPending}>
        {editor}
      </CardContent>
      <CardFooter>
        <PendingButton
          type="button"
          pending={save.isPending}
          pendingLabel="Saving…"
          icon={<SaveIcon data-icon="inline-start" />}
          onClick={() => save.mutate({ data: { source: value } })}
        >
          Save
        </PendingButton>
      </CardFooter>
    </>
  );
}
