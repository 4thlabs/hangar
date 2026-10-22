import { logger } from "#libs/logs";
import { hostShells, sshKeys, sshKnownHosts } from "#libs/ssh/server";
import { HostTerminalSetup } from "#modules/terminal/components/host-terminal-setup.tsx";
import { HostTerminal } from "#modules/terminal/components/host-terminal.tsx";
import { SshKeyDialog } from "#modules/terminal/components/ssh-key-dialog.tsx";
import type { ImportedKey } from "#modules/terminal/imported-key.ts";

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

/** /terminal: a shell on the host once it is configured, how to configure it until then. */
export async function HostTerminalContent() {
  const importedKey = await HostTerminalReads.importedKey();
  const hostFingerprint = hostShells ? await HostTerminalReads.hostFingerprint(hostShells.address) : null;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Terminal</h1>
          <p className="text-sm text-muted-foreground">
            {hostShells
              ? `Un shell sur ${hostShells.target.host}, en tant que ${hostShells.target.username}, par SSH.`
              : "Aucun serveur n’est configuré."}
          </p>
        </div>
        <SshKeyDialog importedKey={importedKey} hostFingerprint={hostFingerprint} />
      </div>
      {hostShells ? <HostTerminal /> : <HostTerminalSetup />}
    </>
  );
}
