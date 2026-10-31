"use client";

import { KeyRoundIcon, PlusIcon, SaveIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useRouter } from "waku";
import type { ActionResult } from "#modules/common/actions/action-result.ts";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { Button } from "#modules/common/ui/button.tsx";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";
import type { EnvPayload } from "#modules/settings/actions/manage-env.ts";
import { SettingsMessages } from "#modules/settings/messages.ts";

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
  const { t } = useTranslation(SettingsMessages);
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

    if (!key || key in values) {
      return;
    }

    setValues(previous => ({ ...previous, [key]: "" }));
    setRemoved(previous => previous.filter(name => name !== key));
    setNewKey("");
  };

  const handleSave = () =>
    run(
      () => saveEnv({ updates: values, remove: removed }),
      { success: t("env.saved"), error: t("env.saveFailed") },
      () => {
        setRemoved([]);
        router.reload();
      },
    );

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>{t("env.title")}</CardTitle>
        <CardDescription>
          {t("env.description.before")}
          <code>.env.global</code>
          {t("env.description.after")}
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
                placeholder={t("env.placeholder")}
                onChange={event => setValues(previous => ({ ...previous, [key]: event.target.value }))}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("env.generate", { key })}
                onClick={() => setValues(previous => ({ ...previous, [key]: randomSecret() }))}
              >
                <KeyRoundIcon />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("env.remove", { key })}
                onClick={() => remove(key)}
              >
                <Trash2Icon />
              </Button>
            </Field>
          ))}
          <Field orientation="horizontal">
            <Input
              value={newKey}
              placeholder={t("env.newVariable")}
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
              {t("env.add")}
            </Button>
          </Field>
          {removed.length > 0 && (
            <FieldDescription>
              {t("env.pendingRemoval")}
              <span className="font-mono">{removed.join(", ")}</span>
            </FieldDescription>
          )}
        </FieldGroup>
      </CardContent>
      <CardFooter>
        <PendingButton
          type="button"
          pending={isPending}
          pendingLabel={t("saving")}
          icon={<SaveIcon data-icon="inline-start" />}
          onClick={handleSave}
        >
          {t("save")}
        </PendingButton>
      </CardFooter>
    </Card>
  );
}
