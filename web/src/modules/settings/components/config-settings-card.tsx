import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SaveIcon } from "lucide-react";
import { useState } from "react";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { QueryRegion } from "#modules/common/components/region.tsx";
import { toastSuccess } from "#modules/common/components/toast.ts";
import { YamlEditor } from "#modules/common/components/yaml-editor.tsx";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { errorText, formErrorsOf, submitAfterRefusal, type FieldsByCode } from "#modules/common/helpers/form-errors.ts";
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

/** Where the server's codes go: `hangar.yml`'s own refusals under the file, any other under the form, beside it. */
const fieldsByCode: FieldsByCode<"source"> = {
  "config.syntax": () => "source",
  "config.invalid": () => "source",
};

/** The file being edited, and its save. */
function ConfigEditor({ source }: { source: string }) {
  const save = useMutation(settingsMutations.saveConfig());

  const form = useForm({
    defaultValues: { source },
    // Awaited, as a save reads the file again before it ends, which opens a new editor: this one would go with its
    // callbacks.
    onSubmit: async ({ value, formApi }) => {
      try {
        await save.mutateAsync({ data: { source: value.source } });
        toastSuccess(words.saved, words.savedDescription);
      } catch (failure) {
        formApi.setErrorMap({ onSubmit: formErrorsOf(failure, fieldsByCode) });
      }
    },
  });

  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        void submitAfterRefusal(form);
      }}
    >
      {/* Inert while the save runs: the editor opens again on the file saved, which would drop what is typed meanwhile. */}
      <CardContent className="flex flex-col gap-3" inert={save.isPending}>
        <form.Subscribe selector={state => errorText([state.errorMap.onSubmit])}>
          {formError => (
            <form.Field name="source">
              {field => (
                <YamlEditor
                  source={source}
                  className="h-[60vh]"
                  onChange={field.handleChange}
                  refusal={errorText(field.state.meta.errors) ?? formError}
                />
              )}
            </form.Field>
          )}
        </form.Subscribe>
      </CardContent>
      <CardFooter>
        <PendingButton
          type="submit"
          pending={save.isPending}
          pendingLabel={settingsMessages.saving}
          icon={<SaveIcon data-icon="inline-start" />}
        >
          {settingsMessages.save}
        </PendingButton>
      </CardFooter>
    </form>
  );
}
