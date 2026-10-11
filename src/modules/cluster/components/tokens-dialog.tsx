"use client";

import { CopyIcon, KeyRoundIcon, RefreshCwIcon } from "lucide-react";
import { useState, useTransition } from "react";
import type { SwarmJoinCommands } from "#libs/docker";
import { revealJoinCommands, rotateJoinToken } from "#modules/cluster/actions/manage-cluster.ts";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { Alert, AlertDescription } from "#modules/common/ui/alert.tsx";
import { Button } from "#modules/common/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#modules/common/ui/dialog.tsx";
import { Spinner } from "#modules/common/ui/spinner.tsx";
import { toast } from "#modules/common/ui/toast.tsx";

type Role = keyof SwarmJoinCommands;

const RoleTitle: Record<Role, string> = {
  worker: "Ajouter un worker",
  manager: "Ajouter un manager",
};

/**
 * The join commands, behind a click: they carry the tokens, so they are only read when asked for,
 * and forgotten when the dialog closes.
 */
export function TokensDialog() {
  const [commands, setCommands] = useState<SwarmJoinCommands | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRevealing, startRevealing] = useTransition();
  const rotation = useServerAction();

  function reveal() {
    startRevealing(async () => {
      try {
        const result = await revealJoinCommands();

        setCommands(result.commands ?? null);
        setError(result.success ? null : result.message);
      } catch (cause) {
        console.error("Server action failed", cause);
        setError("Impossible de contacter le serveur.");
      }
    });
  }

  function rotate(role: Role) {
    rotation.run(() => rotateJoinToken(role), { success: "Token régénéré", error: "Régénération : échec" }, reveal);
  }

  function forget(open: boolean) {
    if (!open) {
      setCommands(null);
      setError(null);
    }
  }

  async function copy(command: string) {
    try {
      await navigator.clipboard.writeText(command);
      toast.add({ title: "Commande copiée" });
    } catch (cause) {
      console.error("Clipboard write failed", cause);
      toast.add({ title: "Copie impossible", description: "Sélectionnez la commande à la main.", type: "error" });
    }
  }

  return (
    <Dialog onOpenChange={forget}>
      <DialogTrigger render={<Button type="button" variant="outline" />}>
        <KeyRoundIcon data-icon="inline-start" />
        Tokens
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Rejoindre le cluster</DialogTitle>
          <DialogDescription>
            Lancez une de ces commandes sur la machine à ajouter. Elles contiennent les tokens : quiconque les a peut
            ajouter un nœud au cluster.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {commands ? (
          (Object.keys(RoleTitle) as Role[]).map(role => (
            <section key={role} className="flex flex-col gap-2">
              <h3 className="font-medium">{RoleTitle[role]}</h3>
              <code className="rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">{commands[role]}</code>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void copy(commands[role])}>
                  <CopyIcon data-icon="inline-start" />
                  Copier
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={rotation.isPending || isRevealing}
                  onClick={() => rotate(role)}
                >
                  <RefreshCwIcon data-icon="inline-start" />
                  Régénérer
                </Button>
              </div>
            </section>
          ))
        ) : (
          <Button type="button" disabled={isRevealing} onClick={reveal}>
            {isRevealing ? <Spinner data-icon="inline-start" /> : <KeyRoundIcon data-icon="inline-start" />}
            Afficher les commandes
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
