import { Spinner } from "#modules/common/ui/spinner.tsx";

/** Page-body fallback, so a slow navigation shows progress: Waku keeps the previous route up until it resolves. */
export function PageSpinner() {
  return (
    <div className="flex flex-1 items-center justify-center" aria-busy="true">
      <Spinner className="size-6 text-muted-foreground" />
    </div>
  );
}
