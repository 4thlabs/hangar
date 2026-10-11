"use client";

import { LogInIcon, NetworkIcon } from "lucide-react";
import type { FormEvent } from "react";
import { useRouter } from "waku";
import { initSwarm, joinSwarm } from "#modules/cluster/actions/manage-cluster.ts";
import { ClusterLabels } from "#modules/cluster/labels.ts";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "#modules/common/ui/field.tsx";
import { Input } from "#modules/common/ui/input.tsx";

/** Creating a swarm, or joining one: what /cluster offers a node that is in none. */
export function SwarmSetup() {
  const router = useRouter();
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
      { success: "Cluster créé", error: "Création : échec" },
      () => router.reload(),
    );
  }

  function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);

    joining.run(
      () => joinSwarm(text(form, "manager"), text(form, "token"), text(form, "advertise")),
      { success: "Cluster rejoint", error: "Jonction : échec" },
      () => router.reload(),
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Créer le cluster</CardTitle>
          <CardDescription>Ce nœud en deviendra le premier manager.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={create}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="init-advertise">Adresse annoncée</FieldLabel>
                <Input id="init-advertise" name="advertise" placeholder="192.168.1.10" disabled={isBusy} />
                <FieldDescription>{ClusterLabels.AdvertiseHint}</FieldDescription>
              </Field>
              <PendingButton
                type="submit"
                pending={creation.isPending}
                pendingLabel="Création…"
                disabled={isBusy}
                icon={<NetworkIcon data-icon="inline-start" />}
              >
                Créer le cluster
              </PendingButton>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rejoindre un cluster</CardTitle>
          <CardDescription>
            Le token et l&apos;adresse viennent de <code>docker swarm join-token worker</code> sur un manager.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={join}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="join-manager">Adresse d&apos;un manager</FieldLabel>
                <Input id="join-manager" name="manager" placeholder="192.168.1.10:2377" required disabled={isBusy} />
              </Field>
              <Field>
                <FieldLabel htmlFor="join-token">Token</FieldLabel>
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
                <FieldLabel htmlFor="join-advertise">Adresse annoncée</FieldLabel>
                <Input id="join-advertise" name="advertise" placeholder="192.168.1.11" disabled={isBusy} />
                <FieldDescription>{ClusterLabels.AdvertiseHint}</FieldDescription>
              </Field>
              <PendingButton
                type="submit"
                pending={joining.isPending}
                pendingLabel="Connexion…"
                disabled={isBusy}
                icon={<LogInIcon data-icon="inline-start" />}
              >
                Rejoindre
              </PendingButton>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
