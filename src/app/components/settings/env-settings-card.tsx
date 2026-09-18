"use client";

import { useState } from "react";
import type { ActionResult } from "#app/actions/action-result.ts";
import type { EnvPayload } from "#app/actions/store/manage-env.ts";
import { KeyRoundIcon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { Button } from "#app/components/ui/button.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "#app/components/ui/field.tsx";
import { Input } from "#app/components/ui/input.tsx";
import { Spinner } from "#app/components/ui/spinner.tsx";
import { useServerAction } from "#app/hooks/use-server-action.ts";
import { useRouter } from "waku";

type EnvSettingsCardProps = {
  variables: Record<string, string>;
  saveEnv: (payload: EnvPayload) => Promise<ActionResult>;
};

/** Same shape as `openssl rand -hex 32`. */
const randomSecret = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");

export function EnvSettingsCard({ variables, saveEnv }: EnvSettingsCardProps) {
  const router = useRouter();
  const { run, isPending } = useServerAction();
  const [values, setValues] = useState(variables);
  const [removed, setRemoved] = useState<string[]>([]);
  const [newKey, setNewKey] = useState("");

  const keys = Object.keys(values).sort();

  /** Staged, not written: a variable only disappears once the save goes through. */
  const remove = (key: string) => {
    setValues(({ [key]: _dropped, ...rest }) => rest);
    setRemoved(previous => [...previous, key]);
  };

  const add = () => {
    const key = newKey.trim();

    if (!key || key in values) return;

    setValues(previous => ({ ...previous, [key]: "" }));
    setRemoved(previous => previous.filter(name => name !== key));
    setNewKey("");
  };

  const handleSave = () =>
    run(
      () => saveEnv({ updates: values, remove: removed }),
      { success: "Environnement enregistré", error: "Échec de l’enregistrement" },
      () => {
        setRemoved([]);
        router.reload();
      },
    );

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>ENVIRONNEMENT</CardTitle>
        <CardDescription>
          Les variables partagées par toutes les piles, écrites dans <code>.env.global</code>. Les variables ajoutées à
          la main hors de cette page sont conservées.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {keys.map(key => (
            <Field key={key} orientation="horizontal">
              <FieldLabel htmlFor={`env-${key}`} className="w-72 shrink-0 font-mono text-xs">
                {key}
              </FieldLabel>
              <Input
                id={`env-${key}`}
                value={values[key]}
                placeholder="à remplir"
                onChange={event => setValues(previous => ({ ...previous, [key]: event.target.value }))}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Générer un secret pour ${key}`}
                onClick={() => setValues(previous => ({ ...previous, [key]: randomSecret() }))}
              >
                <KeyRoundIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Supprimer ${key}`}
                onClick={() => remove(key)}
              >
                <Trash2Icon />
              </Button>
            </Field>
          ))}
          <Field orientation="horizontal">
            <Input
              value={newKey}
              placeholder="NOUVELLE_VARIABLE"
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
              Ajouter
            </Button>
          </Field>
          {removed.length > 0 && (
            <FieldDescription>
              À supprimer à l’enregistrement : <span className="font-mono">{removed.join(", ")}</span>
            </FieldDescription>
          )}
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <Button type="button" disabled={isPending} onClick={handleSave}>
          {isPending ? <Spinner data-icon="inline-start" /> : <SaveIcon data-icon="inline-start" />}
          {isPending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </CardFooter>
    </Card>
  );
}
