import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EyeIcon, EyeOffIcon, KeyRoundIcon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { QueryRegion } from "#modules/common/components/region.tsx";
import { toastSuccess } from "#modules/common/components/toast.ts";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { errorText, formErrorsOf, submitAfterRefusal, type FieldsByCode } from "#modules/common/helpers/form-errors.ts";
import { Button } from "#modules/common/ui/button.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";
import { settingsMutations, settingsQueries } from "#modules/settings/api/settings-queries.ts";
import {
  envChanges,
  envFormValues,
  newVariableError,
  newVariableIndex,
  type EnvVariable,
} from "#modules/settings/helpers/env-variables.ts";
import { settingsMessages } from "#modules/settings/messages.ts";

const words = settingsMessages.env;

/** A secret for a variable, of the shape of `openssl rand -hex 32`. */
function randomSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * `.env.global`: every variable, its value hidden until shown, as most are secrets, to change, generate or remove,
 * and new ones to add. A save merges into the file as it is on disk: a variable added by hand meanwhile is kept.
 */
export function EnvSettingsCard() {
  const env = useQuery(settingsQueries.env());
  // Shown from a read of this mount alone: a copy cached by an earlier visit may be older than the file, and a save
  // from it would write it back. Not `isFetchedAfterMount`, which a failed read sets too.
  const [cachedAt] = useState(env.dataUpdatedAt);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{words.title}</CardTitle>
        <CardDescription>
          The variables every stack shares, written to <code>.env.global</code>. Variables added by hand outside this
          page are kept.
        </CardDescription>
      </CardHeader>
      <QueryRegion query={env} readAfter={cachedAt} failure={words.showFailed}>
        {read => (
          <>
            {env.error && (
              <CardContent>
                <p className="text-sm text-destructive">{describeError(env.error)}</p>
              </CardContent>
            )}
            {/* Keyed by the read: a save, which gives the file as written, starts the form again from it. */}
            <EnvForm key={env.dataUpdatedAt} variables={read.variables} />
          </>
        )}
      </QueryRegion>
    </Card>
  );
}

/** The field of the value of a row of the env form, by its index: never by its name, which may hold a `.`. */
type ValueField = `variables[${number}].value`;

/** Where the server's codes go: a variable's under the value of its row, any other under the form. */
function fieldsByCode(variables: readonly EnvVariable[]): FieldsByCode<ValueField> {
  const valueOf = (name: string): ValueField | undefined => {
    const index = variables.findIndex(variable => variable.key === name);

    return index === -1 ? undefined : `variables[${index}].value`;
  };

  return {
    "env.invalid_name": ({ name }) => valueOf(name),
    "env.line_break": ({ name }) => valueOf(name),
    "env.unwritable_value": ({ name }) => valueOf(name),
    "env.updated_and_removed": ({ name }) => valueOf(name),
  };
}

/** The variables as they are being changed. */
function EnvForm({ variables }: { variables: Record<string, string> }) {
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const save = useMutation(settingsMutations.saveEnv());

  const form = useForm({
    defaultValues: envFormValues(variables),
    // Awaited, as the file a save writes starts a new form, keyed by its read: this one would go with its callbacks.
    onSubmit: async ({ value, formApi }) => {
      try {
        await save.mutateAsync({ data: envChanges(variables, value.variables) });
        toastSuccess(words.saved, words.savedDescription);
      } catch (failure) {
        formApi.setErrorMap({ onSubmit: formErrorsOf(failure, fieldsByCode(value.variables)) });
      }
    },
  });

  const toggleShown = (key: string) =>
    setShown(previous => {
      const next = new Set(previous);

      if (!next.delete(key)) {
        next.add(key);
      }

      return next;
    });

  /**
   * Adds the new name typed in, once it is one compose takes and no row holds; else says why, under it. Nothing for no
   * name. Inserted in its place, not validated: the rows' meta moves with them, so a refusal stays with its variable.
   */
  const add = () => {
    const name = form.getFieldValue("newKey").trim();
    const rows = form.getFieldValue("variables");

    if (name.length === 0) {
      return;
    }

    const error = newVariableError(name, rows);

    if (error !== undefined) {
      form.setFieldMeta("newKey", meta => ({ ...meta, errorMap: { ...meta.errorMap, onSubmit: error } }));

      return;
    }

    void form.insertFieldValue(
      "variables",
      newVariableIndex(rows, name),
      { key: name, value: "" },
      { dontValidate: true },
    );

    form.setFieldValue("newKey", "", { dontValidate: true });
    setShown(previous => new Set(previous).add(name));
  };

  return (
    <form
      onSubmit={event => {
        event.preventDefault();
        void submitAfterRefusal(form);
      }}
    >
      {/* Inert while the save runs: the form starts again from the file written, which would drop what is typed
          meanwhile. */}
      <CardContent inert={save.isPending}>
        <FieldGroup>
          <form.Field name="variables" mode="array">
            {rows =>
              rows.state.value.map((variable, index) => (
                // Keyed by index, as the field is named: TanStack Form moves the meta of the rows, a refusal included,
                // as they move.
                <form.Field key={index} name={`variables[${index}].value`}>
                  {field => {
                    const id = `env-${variable.key}`;
                    const error = errorText(field.state.meta.errors);
                    const isShown = shown.has(variable.key);

                    return (
                      <Field orientation="horizontal" data-invalid={error !== undefined}>
                        <FieldLabel htmlFor={id} className="w-72 shrink-0 font-mono text-xs">
                          {variable.key}
                        </FieldLabel>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <Input
                            id={id}
                            type={isShown ? "text" : "password"}
                            autoComplete="off"
                            spellCheck={false}
                            value={field.state.value}
                            placeholder={words.valuePlaceholder}
                            aria-invalid={error !== undefined}
                            aria-describedby={error === undefined ? undefined : `${id}-error`}
                            onChange={event => field.handleChange(event.target.value)}
                          />
                          {error !== undefined && <FieldError id={`${id}-error`}>{error}</FieldError>}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={
                            isShown ? words.hideValue({ name: variable.key }) : words.showValue({ name: variable.key })
                          }
                          aria-pressed={isShown}
                          onClick={() => toggleShown(variable.key)}
                        >
                          {isShown ? <EyeOffIcon /> : <EyeIcon />}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={words.generate({ name: variable.key })}
                          onClick={() => field.handleChange(randomSecret())}
                        >
                          <KeyRoundIcon />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={words.remove({ name: variable.key })}
                          // Staged, not written: a variable only disappears once the save goes through.
                          // Not validated: a validation would clear the refusals of the rows after it.
                          onClick={() => rows.removeValue(index, { dontValidate: true })}
                        >
                          <Trash2Icon />
                        </Button>
                      </Field>
                    );
                  }}
                </form.Field>
              ))
            }
          </form.Field>
          <form.Field
            name="newKey"
            // A name typed and refused stops the save too, so that it is not taken for one added.
            validators={{
              onSubmit: ({ value, fieldApi }) =>
                value.trim() === ""
                  ? undefined
                  : newVariableError(value.trim(), fieldApi.form.getFieldValue("variables")),
            }}
          >
            {field => {
              const error = errorText(field.state.meta.errors);

              return (
                <Field orientation="horizontal" data-invalid={error !== undefined}>
                  <div className="flex w-72 shrink-0 flex-col gap-1">
                    <Input
                      value={field.state.value}
                      placeholder={words.newNamePlaceholder}
                      aria-label={words.newName}
                      aria-invalid={error !== undefined}
                      aria-describedby={error === undefined ? undefined : "env-new-name-error"}
                      className="font-mono text-xs"
                      onChange={event => field.handleChange(event.target.value.toUpperCase())}
                      onKeyDown={event => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          add();
                        }
                      }}
                    />
                    {error !== undefined && <FieldError id="env-new-name-error">{error}</FieldError>}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={add}
                    disabled={field.state.value.trim().length === 0}
                  >
                    <PlusIcon data-icon="inline-start" />
                    {words.add}
                  </Button>
                </Field>
              );
            }}
          </form.Field>
          <form.Subscribe selector={state => state.values.variables}>
            {rows => {
              const removed = envChanges(variables, rows).remove ?? [];

              return (
                removed.length > 0 && (
                  <FieldDescription>
                    {words.toRemove} <span className="font-mono">{removed.join(", ")}</span>
                  </FieldDescription>
                )
              );
            }}
          </form.Subscribe>
          <form.Subscribe selector={state => errorText([state.errorMap.onSubmit])}>
            {error => error !== undefined && <FieldError>{error}</FieldError>}
          </form.Subscribe>
        </FieldGroup>
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
