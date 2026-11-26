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
  // Read once: a read again, when the window gets the focus back, would load the file over what is being typed.
  const { data, dataUpdatedAt, error } = useConfigRead({ query: { staleTime: Infinity, refetchOnWindowFocus: false } });

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
          <p className="text-sm text-destructive">{ErrorMessage.of(error)}</p>
        </CardContent>
      )}
      {data && <ConfigEditor key={dataUpdatedAt} source={data.source} />}
    </Card>
  );
}

/** The file being edited, and its save. */
function ConfigEditor({ source }: { source: string }) {
  const queryClient = useQueryClient();
  const { editor, value, setRefusal } = useYamlEditor({ source, className: "h-[60vh]" });

  const save = useConfigSave({
    mutation: {
      onSuccess: () => {
        setRefusal(null);
        ActionToast.success("Configuration saved", "The configuration was saved.");
        // The file as written, and the apps it links, are read again.
        void queryClient.invalidateQueries({ queryKey: getConfigReadQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getStoreAppsQueryKey() });
      },
      onError: failure => {
        setRefusal(ErrorMessage.of(failure));
        ActionToast.failure("Configuration rejected", failure);
      },
    },
  });

  return (
    <>
      <CardContent className="flex flex-col gap-3">{editor}</CardContent>
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
