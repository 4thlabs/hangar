"use client";

import { KeyRoundIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useRef, type ChangeEvent } from "react";
import { useRouter } from "waku";
import { PendingButton } from "#modules/common/components/pending-button.tsx";
import { useServerAction } from "#modules/common/hooks/use-server-action.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
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
import { TerminalMessages } from "#modules/terminal/messages.ts";

type SshKeyDialogProps = {
  importedKey: ImportedKey;
  /** The host key trusted since the first connection; `null` before it, or while no host is configured. */
  hostFingerprint: string | null;
};

/** The key the terminal signs in with, to import, replace or remove, and the host key Hangar trusts. */
export function SshKeyDialog({ importedKey, hostFingerprint }: SshKeyDialogProps) {
  const router = useRouter();
  const action = useServerAction();
  const { t } = useTranslation(TerminalMessages);
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
      { success: t("key.imported"), error: t("key.importFailed") },
      () => router.reload(),
    );
  }

  function remove() {
    action.run(removeSshKey, { success: t("key.deleted"), error: t("key.deleteFailed") }, () => router.reload());
  }

  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" variant="outline" />}>
        <KeyRoundIcon data-icon="inline-start" />
        {t("key.trigger")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("key.title")}</DialogTitle>
          <DialogDescription>{t("key.description")}</DialogDescription>
        </DialogHeader>

        <section className="flex flex-col gap-2">
          <h3 className="font-medium">{t("key.privateKey")}</h3>
          <p className="text-sm text-muted-foreground">
            <ImportedKeySummary importedKey={importedKey} />
          </p>
          <input
            ref={fileInput}
            type="file"
            className="hidden"
            aria-label={t("key.file")}
            onChange={event => void upload(event)}
          />
          <div className="flex flex-wrap gap-2">
            <PendingButton
              type="button"
              size="sm"
              variant="outline"
              pending={action.isPending}
              pendingLabel={t("key.importing")}
              icon={<UploadIcon data-icon="inline-start" />}
              onClick={() => fileInput.current?.click()}
            >
              {importedKey === null ? t("key.import") : t("key.replace")}
            </PendingButton>
            {importedKey !== null && (
              <Button type="button" size="sm" variant="ghost" disabled={action.isPending} onClick={remove}>
                <Trash2Icon data-icon="inline-start" />
                {t("key.delete")}
              </Button>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="font-medium">{t("key.fingerprint")}</h3>
          {hostFingerprint ? (
            <>
              <code className="rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">{hostFingerprint}</code>
              <p className="text-sm text-muted-foreground">
                {t("key.fingerprintHint.before")}
                <code className="font-mono">ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code>
                {t("key.fingerprintHint.after")}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("key.noFingerprint")}</p>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

function ImportedKeySummary({ importedKey }: { importedKey: ImportedKey }) {
  const { t } = useTranslation(TerminalMessages);

  if (importedKey === null) {
    return t("key.none");
  }

  if (importedKey === "unreadable") {
    return t("key.unreadable");
  }

  if (importedKey.encrypted) {
    return t("key.encrypted");
  }

  const summary = t("key.summary", { type: importedKey.type });

  return (
    <>
      {summary.before}
      <code className="font-mono break-all">{importedKey.fingerprint}</code>
      {summary.after}
    </>
  );
}
