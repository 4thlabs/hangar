import { useMutation, useQuery } from "@tanstack/react-query";
import { SaveIcon } from "lucide-react";
import { useState } from "react";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { QueryRegion } from "#modules/common/components/region.tsx";
import { toastFailure, toastSuccess } from "#modules/common/components/toast.ts";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { useYamlEditor } from "#modules/common/hooks/use-yaml-editor.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { settingsMutations, settingsQueries } from "#modules/settings/api/settings-queries.ts";
import { settingsMessages } from "#modules/settings/messages.ts";

const words = settingsMessages.config;

/** `hangar.yml`, edited as it is written, and checked by the server before it is saved. */
export function ConfigSettingsCard() {
  const config = useQuery(settingsQueries.config());
  // Shown from a read of this mount alone: a copy cached by an earlier visit may be older than the file, and a save
  // from it would write it back. Not `isFetchedAfterMount`, which a failed read sets too.
  const [cachedAt] = useState(config.dataUpdatedAt);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{words.title}</CardTitle>
        <CardDescription>
          The store's <code>hangar.yml</code> file: categories, shared files and dashboard widgets. It is validated
          before it is written.
        </CardDescription>
      </CardHeader>
      <QueryRegion query={config} readAfter={cachedAt} failure={words.showFailed}>
        {read => (
          <>
            {config.error && (
              <CardContent>
                <p className="text-sm text-destructive">{describeError(config.error)}</p>
              </CardContent>
            )}
            {/* Keyed by the read: a save, which reads the file again, opens the editor on what was saved. */}
            <ConfigEditor key={config.dataUpdatedAt} source={read.source} />
          </>
        )}
      </QueryRegion>
    </Card>
  );
}

/** The file being edited, and its save. */
function ConfigEditor({ source }: { source: string }) {
  const { editor, value, setRefusal } = useYamlEditor({ source, className: "h-[60vh]" });
  const save = useMutation(settingsMutations.saveConfig());

  // Awaited, as a save reads the file again before it ends, which opens a new editor: this one's callbacks would go
  // with it.
  async function handleSave() {
    try {
      await save.mutateAsync({ data: { source: value } });
      setRefusal(null);
      toastSuccess(words.saved, words.savedDescription);
    } catch (failure) {
      setRefusal(describeError(failure));
      toastFailure(words.rejected, failure);
    }
  }

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
          pendingLabel={settingsMessages.saving}
          icon={<SaveIcon data-icon="inline-start" />}
          onClick={() => void handleSave()}
        >
          {settingsMessages.save}
        </PendingButton>
      </CardFooter>
    </>
  );
}
