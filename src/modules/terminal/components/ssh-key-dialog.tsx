"use client";

import { KeyRoundIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useRef, type ChangeEvent } from "react";
import { useRouter } from "waku";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { Button } from "#modules/common/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#modules/common/ui/dialog.tsx";
import { importSshKey, removeSshKey } from "#modules/terminal/actions/manage-ssh-key.ts";
import type { ImportedKey } from "#modules/terminal/imported-key.ts";

type SshKeyDialogProps = {
  importedKey: ImportedKey;
  /** The host key trusted since the first connection; `null` before it, or while no host is configured. */
  hostFingerprint: string | null;
};

/** The key the terminal signs in with, to import, replace or remove, and the host key Hangar trusts. */
export function SshKeyDialog({ importedKey, hostFingerprint }: SshKeyDialogProps) {
  const router = useRouter();
  const action = useServerAction();
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    // Cleared, so choosing the same file again still fires a change.
    event.target.value = "";

    if (!file) {
      return;
    }

    const source = await file.text();

    action.run(
      () => importSshKey(source),
      { success: "Clé importée", error: "Import : échec" },
      () => router.reload(),
    );
  }

  function remove() {
    action.run(removeSshKey, { success: "Clé supprimée", error: "Suppression : échec" }, () => router.reload());
  }

  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" variant="outline" />}>
        <KeyRoundIcon data-icon="inline-start" />
        Clé SSH
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Connexion SSH</DialogTitle>
          <DialogDescription>
            Sans clé, le terminal demande le mot de passe du compte à chaque connexion. Avec une clé que son
            ~/.ssh/authorized_keys autorise, il l’essaie d’abord.
          </DialogDescription>
        </DialogHeader>

        <section className="flex flex-col gap-2">
          <h3 className="font-medium">Clé privée</h3>
          <p className="text-sm text-muted-foreground">
            <ImportedKeySummary importedKey={importedKey} />
          </p>
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            aria-label="Fichier de la clé privée"
            onChange={event => void upload(event)}
          />
          <div className="flex flex-wrap gap-2">
            <PendingButton
              type="button"
              size="sm"
              variant="outline"
              pending={action.isPending}
              pendingLabel="Import…"
              icon={<UploadIcon data-icon="inline-start" />}
              onClick={() => fileInput.current?.click()}
            >
              {importedKey === null ? "Importer une clé" : "Remplacer la clé"}
            </PendingButton>
            {importedKey !== null && (
              <Button type="button" size="sm" variant="ghost" disabled={action.isPending} onClick={remove}>
                <Trash2Icon data-icon="inline-start" />
                Supprimer
              </Button>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-medium">Empreinte du serveur</h3>
          {hostFingerprint ? (
            <>
              <code className="rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">{hostFingerprint}</code>
              <p className="text-sm text-muted-foreground">
                Enregistrée à la première connexion ; une autre clé sera refusée. Comparez-la à{" "}
                <code className="font-mono">ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code> sur le serveur.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Aucune encore : Hangar enregistrera la clé que le serveur présentera à la première connexion.
            </p>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

function ImportedKeySummary({ importedKey }: { importedKey: ImportedKey }) {
  if (importedKey === null) {
    return "Aucune clé importée.";
  }

  if (importedKey === "unreadable") {
    return "La clé importée est illisible : remplacez-la, ou supprimez-la. Le détail est dans les logs du serveur.";
  }

  if (importedKey.encrypted) {
    return "Une clé protégée par une phrase de passe, demandée à chaque connexion.";
  }

  return (
    <>
      Clé {importedKey.type}, <code className="font-mono break-all">{importedKey.fingerprint}</code>.
    </>
  );
}
