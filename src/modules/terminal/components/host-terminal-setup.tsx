import type { Translate } from "#libs/i18n";
import { ServerTranslation } from "#libs/i18n/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";
import { TerminalMessages } from "#modules/terminal/messages.ts";

/** What `compose.yml` needs for Hangar to reach the host it runs on, from inside its container. */
class HostTerminalCompose {
  /** The snippet, its account placeholder in the reader's language. */
  static snippet(t: Translate<typeof TerminalMessages.en>) {
    return `services:
  hangar:
    environment:
      - HANGAR_SSH_HOST=host.docker.internal
      - HANGAR_SSH_USER=${t("setup.user")}
      # - HANGAR_SSH_PORT=22
    extra_hosts:
      - host.docker.internal:host-gateway`;
  }
}

/** How to name the host the terminal signs in to, while none is configured. */
export function HostTerminalSetup() {
  const { t } = ServerTranslation.get(TerminalMessages);

  return (
    <Card className="w-full max-w-3xl">
      <CardHeader>
        <CardTitle>{t("setup.title")}</CardTitle>
        <CardDescription>{t("setup.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          {t("setup.instructions.before")}
          <code className="font-mono">compose.yml</code>
          {t("setup.instructions.middle")}
          <code className="font-mono">host.docker.internal</code>
          {t("setup.instructions.after")}
        </p>
        <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
          {HostTerminalCompose.snippet(t)}
        </pre>
      </CardContent>
    </Card>
  );
}
