import { Spinner } from "#app/components/ui/spinner.tsx";

/**
 * What a page shows while its own server components are still awaiting.
 *
 * Fills the page body: `main` is a `flex-1` column, so this centres in whatever the navbar and
 * padding leave. The shell around it — navbar, title, layout — is already on screen, which is
 * the point: a Waku navigation keeps the previous route up until the destination's elements
 * resolve, so without a boundary to paint this, clicking a slow page looks like nothing happened.
 */
export function PageSpinner() {
  return (
    <div className="flex flex-1 items-center justify-center" aria-busy="true">
      <Spinner className="size-6 text-muted-foreground" />
    </div>
  );
}
