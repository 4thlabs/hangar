"use client";

import { ClusterMessages } from "#modules/cluster/messages.ts";
import { StreamOutput, StreamStatusBadge } from "#modules/common/components/stream-output.tsx";
import { useCommandStream } from "#modules/common/hooks/use-command-stream.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";

type StackDeployOutputProps = {
  stack: string;
  /** Called once the deploy ended, with its exit code (`null` if the stream broke). */
  onFinished: (code: number | null) => void;
};

/** `docker stack deploy` of a store app, run on mount with its output live: a new `key` deploys again. */
export function StackDeployOutput({ stack, onFinished }: StackDeployOutputProps) {
  const { t } = useTranslation(ClusterMessages);

  const { text, status, error } = useCommandStream(
    `/api/docker/swarm/stacks/${encodeURIComponent(stack)}/deploy`,
    onFinished,
  );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{t("deploy.title")}</h3>
        <StreamStatusBadge status={status} />
      </div>
      <p className="text-xs text-muted-foreground">{t("deploy.hint")}</p>
      <div className="flex h-72 flex-col">
        <StreamOutput text={text} error={error} placeholder={t("deploy.starting")} />
      </div>
    </section>
  );
}
