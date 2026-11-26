import { focusManager, QueryErrorResetBoundary } from "@tanstack/react-query";
import { CatchBoundary } from "@tanstack/react-router";
import { CircleAlertIcon } from "lucide-react";
import { Suspense, useEffect, type ReactNode } from "react";
import { ApiError } from "#libs/api";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { Button } from "#modules/common/ui/button.tsx";

/** What a region that failed is shown: why, and what starts it over. */
export type RegionFailure = {
  error: unknown;
  /** Renders the region again, its failed queries asked again. */
  retry: () => void;
};

type RegionProps = {
  /**
   * What the region shows once it failed: the title of an alert, which says why when the server did and offers to try
   * again, or a render of its own.
   */
  failure: string | ((failure: RegionFailure) => ReactNode);
  /** What it shows while a query in it reads its first data. */
  fallback?: ReactNode;
  /** What the region shows: when it changes, a region that failed renders again, as when its data is read again. */
  resetKey?: unknown;
  children: ReactNode;
};

/**
 * A part of a page that loads and fails on its own, as a card or a widget (ADR 0002, decision 4): its `fallback` while a
 * `useSuspenseQuery` in it reads its first data, and its `failure` once a query in it fails without data or a component
 * in it throws as it renders, while the rest of the page stands. React logs the error. A query that had data keeps it
 * when it is read again and that fails: a suspense query throws only without data.
 *
 * A region that failed tries again when its retry is asked for, and when the window gets the focus back, as a query
 * would: its failed queries are asked again.
 */
export function Region({ failure, fallback = null, resetKey, children }: RegionProps) {
  return (
    <QueryErrorResetBoundary>
      {({ reset: resetQueries }) => (
        <CatchBoundary
          getResetKey={() => resetKey}
          errorComponent={({ error, reset }) => (
            <RegionFailureView
              error={error}
              retry={() => {
                resetQueries();
                reset();
              }}
              failure={failure}
            />
          )}
        >
          <Suspense fallback={fallback}>{children}</Suspense>
        </CatchBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}

/** A failed region: its own failure, or an alert, and a retry once the window gets the focus back. */
function RegionFailureView({ error, retry, failure }: RegionFailure & Pick<RegionProps, "failure">) {
  useEffect(
    () =>
      focusManager.subscribe(isFocused => {
        if (isFocused) {
          retry();
        }
      }),
    [retry],
  );

  if (typeof failure !== "string") {
    return failure({ error, retry });
  }

  return (
    <Alert variant="destructive">
      <CircleAlertIcon aria-hidden="true" />
      <AlertTitle>{failure}</AlertTitle>
      {/* Only the server says why: an error of the page's own, as a component that threw, means nothing to its reader. */}
      {error instanceof ApiError && <AlertDescription>{describeError(error)}</AlertDescription>}
      <AlertAction>
        <Button type="button" variant="outline" size="sm" onClick={retry}>
          Retry
        </Button>
      </AlertAction>
    </Alert>
  );
}
