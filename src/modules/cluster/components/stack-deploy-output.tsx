"use client";

import { StreamOutput, StreamStatusBadge } from "#modules/common/components/stream-output.tsx";
import { useCommandStream } from "#modules/common/hooks/use-command-stream.ts";

type StackDeployOutputProps = {
  stack: string;
  /** Called once the deploy ended, with its exit code (`null` if the stream broke). */
  onFinished: (code: number | null) => void;
};

/** `docker stack deploy` of a store app, run on mount with its output live: a new `key` deploys again. */
export function StackDeployOutput({ stack, onFinished }: StackDeployOutputProps) {
  const { text, status, error } = useCommandStream(
    `/api/docker/swarm/stacks/${encodeURIComponent(stack)}/deploy`,
    onFinished,
  );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">Déploiement</h3>
        <StreamStatusBadge status={status} />
      </div>
      <p className="text-xs text-muted-foreground">
        Fermer ce panneau n’interrompt rien : le déploiement va à son terme côté serveur et dépose une notification.
      </p>
      <div className="flex h-72 flex-col">
        <StreamOutput text={text} error={error} placeholder="Démarrage du déploiement…" />
      </div>
    </section>
  );
}
