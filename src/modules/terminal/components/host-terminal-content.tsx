import { Suspense } from "react";
import { ServerTranslation } from "#libs/i18n/server";
import { logger } from "#libs/logs";
import { hostShells, sshKeys, sshKnownHosts } from "#libs/ssh/server";
import { HostTerminalDialog } from "#modules/terminal/components/host-terminal-dialog.tsx";
import { HostTerminalSetup } from "#modules/terminal/components/host-terminal-setup.tsx";
import { HostTerminal } from "#modules/terminal/components/host-terminal.tsx";
import { SshKeyDialog } from "#modules/terminal/components/ssh-key-dialog.tsx";
import type { ImportedKey } from "#modules/terminal/imported-key.ts";
import { TerminalMessages } from "#modules/terminal/messages.ts";

/** What the page reads of Hangar's SSH folder; a file it cannot read is logged and shown as such. */
class HostTerminalReads {
  static async importedKey(): Promise<ImportedKey> {
    try {
      return await sshKeys.info();
    } catch (error) {
      logger.error("Failed to read the imported SSH key", { error, file: sshKeys.file });

      return "unreadable";
    }
  }

  /** The host key recorded for `address`; unreadable, the terminal says so when it connects. */
  static async hostFingerprint(address: string): Promise<string | null> {
    try {
      return await sshKnownHosts.recorded(address);
    } catch (error) {
      logger.error("Failed to read the SSH known hosts", { error, file: sshKnownHosts.file });

      return null;
    }
  }
}

/** The navbar's terminal: a shell on the host once it is configured, how to configure it until then. */
export function HostTerminalContent() {
  const { t } = ServerTranslation.get(TerminalMessages);

  return (
    <HostTerminalDialog
      description={
        hostShells
          ? t("description", { host: hostShells.target.host, username: hostShells.target.username })
          : t("notConfigured")
      }
      // The layout renders it on every page: what it reads streams in, rather than holding the page back.
      sshKey={
        <Suspense fallback={null}>
          <SshKeyContent />
        </Suspense>
      }
    >
      {hostShells ? <HostTerminal /> : <HostTerminalSetup />}
    </HostTerminalDialog>
  );
}

/** The **SSH key** dialog, with what it shows of Hangar's SSH folder. */
async function SshKeyContent() {
  // Neither read waits for the other.
  const [importedKey, hostFingerprint] = await Promise.all([
    HostTerminalReads.importedKey(),
    hostShells ? HostTerminalReads.hostFingerprint(hostShells.address) : null,
  ]);

  return <SshKeyDialog importedKey={importedKey} hostFingerprint={hostFingerprint} />;
}
