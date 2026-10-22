import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";

/** What `compose.yml` needs for Hangar to reach the host it runs on, from inside its container. */
class HostTerminalCompose {
  static readonly Snippet = `services:
  hangar:
    environment:
      - HANGAR_SSH_HOST=host.docker.internal
      - HANGAR_SSH_USER=votre-utilisateur
      # - HANGAR_SSH_PORT=22
    extra_hosts:
      - host.docker.internal:host-gateway`;
}

/** How to name the host the terminal signs in to, while none is configured. */
export function HostTerminalSetup() {
  return (
    <Card className="w-full max-w-3xl">
      <CardHeader>
        <CardTitle>Configurer l’accès au serveur</CardTitle>
        <CardDescription>
          Hangar ouvre le terminal en SSH sur le compte de votre choix, et demande son mot de passe dans le terminal.
          Une clé importée (bouton Clé SSH) évite de le taper.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Indiquez le serveur dans le <code className="font-mono">compose.yml</code> de Hangar, puis recréez son
          conteneur. <code className="font-mono">host.docker.internal</code> désigne la machine qui l’héberge ; une
          autre adresse convient aussi.
        </p>
        <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
          {HostTerminalCompose.Snippet}
        </pre>
      </CardContent>
    </Card>
  );
}
