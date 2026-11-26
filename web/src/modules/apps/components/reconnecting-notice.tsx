import { Spinner } from "#modules/common/ui/spinner.tsx";

/** What a page says while its stream of the daemon's changes is lost: what it shows may be out of date. */
export function ReconnectingNotice({ isReconnecting }: { isReconnecting: boolean }) {
  if (!isReconnecting) {
    return null;
  }

  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner />
      Reconnecting to the server: what this page shows may be out of date.
    </p>
  );
}
