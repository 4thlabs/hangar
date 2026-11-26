import { useQueryClient } from "@tanstack/react-query";
import { EyeIcon, EyeOffIcon, KeyRoundIcon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { getEnvReadQueryKey, useEnvRead, useEnvSave } from "#libs/api";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { toastFailure, toastSuccess } from "#modules/common/components/toast.ts";
import { describeError } from "#modules/common/error-message.ts";
import { Button } from "#modules/common/ui/button.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";
import { envChanges } from "#modules/settings/env-changes.ts";

/** A secret for a variable, of the shape of `openssl rand -hex 32`. */
function randomSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * `.env.global`: every variable, its value hidden until shown, as most are secrets, to change, generate or remove,
 * and new ones to add. A save merges into the file as it is on disk: a variable added by hand meanwhile is kept.
 */
export function EnvSettingsCard() {
  // Read anew each time the tab opens, as a sync or an install may have changed the file since, and shown from that
  // read alone; not when the window gets the focus back, which would load the file over what is being typed.
  const { data, dataUpdatedAt, isFetchedAfterMount, error } = useEnvRead({
    query: { staleTime: Infinity, refetchOnMount: "always", refetchOnWindowFocus: false },
  });

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>ENVIRONMENT</CardTitle>
        <CardDescription>
          The variables every stack shares, written to <code>.env.global</code>. Variables added by hand outside this
          page are kept.
        </CardDescription>
      </CardHeader>
      {error && (
        <CardContent>
          <p className="text-sm text-destructive">{describeError(error)}</p>
        </CardContent>
      )}
      {/* Keyed by the read: a save, which gives the file as written, starts the form again from it. */}
      {data && isFetchedAfterMount && <EnvForm key={dataUpdatedAt} variables={data.variables} />}
    </Card>
  );
}

/** The variables as they are being changed. */
function EnvForm({ variables }: { variables: Record<string, string> }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState(variables);
  const [removed, setRemoved] = useState<string[]>([]);
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const [newKey, setNewKey] = useState("");

  const save = useEnvSave({
    mutation: {
      onSuccess: written => {
        queryClient.setQueryData(getEnvReadQueryKey(), written);
        toastSuccess("Environment saved", "The global environment was saved.");
      },
      onError: failure => toastFailure("Save failed", failure),
    },
  });

  const keys = Object.keys(values).sort();

  const setValue = (key: string, value: string) => setValues(previous => ({ ...previous, [key]: value }));

  const toggleShown = (key: string) =>
    setShown(previous => {
      const next = new Set(previous);

      if (!next.delete(key)) {
        next.add(key);
      }

      return next;
    });

  /** Staged, not written: a variable only disappears once the save goes through. */
  const remove = (key: string) => {
    setValues(({ [key]: _dropped, ...rest }) => rest);
    setRemoved(previous => [...previous, key]);
  };

  const add = () => {
    const key = newKey.trim();

    if (!key || key in values) {
      return;
    }

    setValue(key, "");
    setShown(previous => new Set(previous).add(key));
    setRemoved(previous => previous.filter(name => name !== key));
    setNewKey("");
  };

  return (
    <>
      {/* Inert while the save runs: the form starts again from the file written, which would drop what is typed
          meanwhile. */}
      <CardContent inert={save.isPending}>
        <FieldGroup>
          {keys.map(key => (
            <Field key={key} orientation="horizontal">
              <FieldLabel htmlFor={`env-${key}`} className="w-72 shrink-0 font-mono text-xs">
                {key}
              </FieldLabel>
              <Input
                id={`env-${key}`}
                type={shown.has(key) ? "text" : "password"}
                autoComplete="off"
                spellCheck={false}
                value={values[key]}
                placeholder="to fill in"
                onChange={event => setValue(key, event.target.value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={shown.has(key) ? `Hide the value of ${key}` : `Show the value of ${key}`}
                aria-pressed={shown.has(key)}
                onClick={() => toggleShown(key)}
              >
                {shown.has(key) ? <EyeOffIcon /> : <EyeIcon />}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Generate a secret for ${key}`}
                onClick={() => setValue(key, randomSecret())}
              >
                <KeyRoundIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${key}`}
                onClick={() => remove(key)}
              >
                <Trash2Icon />
              </Button>
            </Field>
          ))}
          <Field orientation="horizontal">
            <Input
              value={newKey}
              placeholder="NEW_VARIABLE"
              aria-label="Name of a new variable"
              className="w-72 shrink-0 font-mono text-xs"
              onChange={event => setNewKey(event.target.value.toUpperCase())}
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
            />
            <Button type="button" variant="outline" onClick={add} disabled={newKey.trim().length === 0}>
              <PlusIcon data-icon="inline-start" />
              Add
            </Button>
          </Field>
          {removed.length > 0 && (
            <FieldDescription>
              To remove on save: <span className="font-mono">{removed.join(", ")}</span>
            </FieldDescription>
          )}
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <PendingButton
          type="button"
          pending={save.isPending}
          pendingLabel="Saving…"
          icon={<SaveIcon data-icon="inline-start" />}
          onClick={() => save.mutate({ data: envChanges(variables, values, removed) })}
        >
          Save
        </PendingButton>
      </CardFooter>
    </>
  );
}
