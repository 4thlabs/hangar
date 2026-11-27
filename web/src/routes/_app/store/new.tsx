import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SaveIcon } from "lucide-react";
import type { StoreApp } from "#libs/api";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { toastSuccess } from "#modules/common/components/toast.ts";
import { YamlEditor } from "#modules/common/components/yaml-editor.tsx";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { errorText, formErrorsOf, submitAfterRefusal, type FieldsByCode } from "#modules/common/helpers/form-errors.ts";
import { Field, FieldDescription, FieldError, FieldLabel } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";
import { storeMutations, storeQueries } from "#modules/store/api/store-queries.ts";
import { appIdError } from "#modules/store/helpers/app-id.ts";
import { m } from "#paraglide/messages.js";

/**
 * `/store/new`, a new app of the store. A page of its own beside `/store`, not a child rendered inside it: the
 * section has no layout route.
 */
export const Route = createFileRoute("/_app/store/new")({
  // Warmed, not waited for: the page shows the template once read, and why it was not. The template does not change
  // while the server runs, so the page reads it from the cache.
  loader: ({ context }) => void context.queryClient.prefetchQuery(storeQueries.newApp()),
  component: NewAppPage,
});

/** `/store/new`: the id of a new app, and its `compose.yml`, which starts from the server's template. */
function NewAppPage() {
  const { data: template, error } = useQuery(storeQueries.newApp());

  return (
    <main>
      <title>{m.store_new_app_document_title()}</title>
      <h1 className="text-2xl font-semibold">{m.store_new_app_title()}</h1>
      {error && <p className="text-sm text-destructive">{describeError(error)}</p>}
      {template && <NewAppEditor source={template.compose} />}
    </main>
  );
}

/** The fields of a new app: its id, and its `compose.yml`. */
type NewAppField = "id" | "compose";

/** Where the server's codes go: the id's under the id, compose's under the file, any other under the form. */
const fieldsByCode: FieldsByCode<NewAppField> = {
  "editor.invalid_app_id": () => "id",
  "editor.app_exists": () => "id",
  "editor.compose_rejected": () => "compose",
  "editor.invalid_file": () => "compose",
};

/** Writes a new app's `compose.yml` under the id typed in, then opens the app's own editor. */
function NewAppEditor({ source }: { source: string }) {
  const navigate = useNavigate();
  // The options have the store's apps read again, which lists the new one, before the call ends.
  const create = useMutation(storeMutations.createApp());

  const form = useForm({
    defaultValues: { id: "", compose: source },
    onSubmit: async ({ value, formApi }) => {
      let app: StoreApp;

      try {
        app = await create.mutateAsync({ data: { id: value.id, compose: value.compose } });
      } catch (failure) {
        formApi.setErrorMap({ onSubmit: formErrorsOf(failure, fieldsByCode) });

        return;
      }

      toastSuccess(m.store_new_app_saved(), m.store_new_app_saved_description({ id: app.id }));
      // The new app gets its own editor, so that a second save edits it rather than create it again.
      await navigate({ to: "/store/$id/edit", params: { id: app.id } });
    },
  });

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={event => {
        event.preventDefault();
        void submitAfterRefusal(form);
      }}
    >
      <form.Field name="id" validators={{ onSubmit: ({ value }) => appIdError(value) }}>
        {field => {
          const error = errorText(field.state.meta.errors);

          return (
            <Field className="max-w-sm" data-invalid={error !== undefined}>
              <FieldLabel htmlFor="app-id">{m.store_new_app_identifier()}</FieldLabel>
              <Input
                id="app-id"
                value={field.state.value}
                placeholder={m.store_new_app_identifier_placeholder()}
                className="font-mono"
                aria-invalid={error !== undefined}
                aria-describedby={error === undefined ? "app-id-description" : "app-id-error"}
                onChange={event => field.handleChange(event.target.value.toLowerCase())}
              />
              <FieldDescription id="app-id-description">{m.store_new_app_identifier_description()}</FieldDescription>
              {error !== undefined && <FieldError id="app-id-error">{error}</FieldError>}
            </Field>
          );
        }}
      </form.Field>
      <form.Subscribe selector={state => errorText([state.errorMap.onSubmit])}>
        {formError => (
          <form.Field name="compose">
            {field => (
              <YamlEditor
                source={source}
                className="h-[65vh]"
                onChange={field.handleChange}
                refusal={errorText(field.state.meta.errors) ?? formError}
              />
            )}
          </form.Field>
        )}
      </form.Subscribe>
      <form.Subscribe selector={state => state.values.id.length === 0}>
        {isIdEmpty => (
          <PendingButton
            type="submit"
            className="self-start"
            pending={create.isPending}
            pendingLabel={m.store_editor_validating()}
            icon={<SaveIcon data-icon="inline-start" />}
            disabled={isIdEmpty}
          >
            {m.store_editor_save()}
          </PendingButton>
        )}
      </form.Subscribe>
    </form>
  );
}
