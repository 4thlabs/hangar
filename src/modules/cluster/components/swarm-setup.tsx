"use client";

import { LogInIcon, NetworkIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useRouter } from "waku";
import { initSwarm, joinSwarm } from "#modules/cluster/actions/manage-cluster.ts";
import { ClusterMessages } from "#modules/cluster/messages.ts";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";

/** Creating a swarm, or joining one: what /cluster offers a node that is in none. */
export function SwarmSetup() {
  const router = useRouter();
  const { t } = useTranslation(ClusterMessages);
  const creation = useServerAction();
  const joining = useServerAction();
  const isBusy = creation.isPending || joining.isPending;

  /** A form field's text, empty when the field was left out. */
  const text = (form: FormData, name: string) => String(form.get(name) ?? "");

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);

    creation.run(
      () => initSwarm(text(form, "advertise")),
      { success: t("setup.created"), error: t("setup.createFailed") },
      () => router.reload(),
    );
  }

  function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);

    joining.run(
      () => joinSwarm(text(form, "manager"), text(form, "token"), text(form, "advertise")),
      { success: t("setup.joined"), error: t("setup.joinFailed") },
      () => router.reload(),
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{t("setup.createTitle")}</CardTitle>
          <CardDescription>{t("setup.createDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={create}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="init-advertise">{t("setup.advertise")}</FieldLabel>
                <Input id="init-advertise" name="advertise" placeholder="192.168.1.10" disabled={isBusy} />
                <FieldDescription>{t("setup.advertiseHint")}</FieldDescription>
              </Field>
              <PendingButton
                type="submit"
                pending={creation.isPending}
                pendingLabel={t("setup.creating")}
                disabled={isBusy}
                icon={<NetworkIcon data-icon="inline-start" />}
              >
                {t("setup.createTitle")}
              </PendingButton>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("setup.joinTitle")}</CardTitle>
          <CardDescription>
            {t("setup.joinDescription.before")}
            <code>docker swarm join-token worker</code>
            {t("setup.joinDescription.after")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={join}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="join-manager">{t("setup.managerAddress")}</FieldLabel>
                <Input id="join-manager" name="manager" placeholder="192.168.1.10:2377" required disabled={isBusy} />
              </Field>
              <Field>
                <FieldLabel htmlFor="join-token">{t("setup.token")}</FieldLabel>
                <Input
                  id="join-token"
                  name="token"
                  placeholder="SWMTKN-1-…"
                  autoComplete="off"
                  spellCheck={false}
                  required
                  disabled={isBusy}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="join-advertise">{t("setup.advertise")}</FieldLabel>
                <Input id="join-advertise" name="advertise" placeholder="192.168.1.11" disabled={isBusy} />
                <FieldDescription>{t("setup.advertiseHint")}</FieldDescription>
              </Field>
              <PendingButton
                type="submit"
                pending={joining.isPending}
                pendingLabel={t("setup.connecting")}
                disabled={isBusy}
                icon={<LogInIcon data-icon="inline-start" />}
              >
                {t("setup.join")}
              </PendingButton>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
