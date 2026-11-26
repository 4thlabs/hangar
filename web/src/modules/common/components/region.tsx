import { focusManager, QueryErrorResetBoundary, QueryObserver, useQueryClient } from "@tanstack/react-query";
import { CatchBoundary } from "@tanstack/react-router";
import { CircleAlertIcon } from "lucide-react";
import { Suspense, useEffect, useEffectEvent, useState, type ReactNode } from "react";
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
   * again, or a render of its own, which offers `retry` too.
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
 * A failed region comes back as a query in a component would:
 * - as it mounts again, its failed queries are read again, not shown failed from the cache;
 * - while it shows its failure, a failed query that is made stale (by a feed, a mutation) or that a focus reads again
 *   brings it back once that read succeeds;
 * - when the window gets the focus back, and on its Retry, it renders again, its failed queries asked again.
 */
export function Region({ failure, fallback = null, resetKey, children }: RegionProps) {
  return (
    <QueryErrorResetBoundary>
      {({ reset: resetQueries }) => (
        <ResetOnMount reset={resetQueries}>
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
        </ResetOnMount>
      )}
    </QueryErrorResetBoundary>
  );
}

/**
 * Resets the region's queries as it mounts, before its children render. A boundary that was not reset has a suspense
 * query that failed throw its cached error at once, with no read: a region left and opened again within the query's
 * `gcTime` would show the old failure.
 */
function ResetOnMount({ reset, children }: { reset: () => void; children: ReactNode }) {
  useState(() => {
    reset();

    return true;
  });

  return children;
}

/** A failed region: its own failure, or an alert, and the ways it comes back. */
function RegionFailureView({ error, retry, failure }: RegionFailure & Pick<RegionProps, "failure">) {
  const queryClient = useQueryClient();
  const comeBack = useEffectEvent(retry);

  useEffect(
    () =>
      focusManager.subscribe(isFocused => {
        if (isFocused) {
          comeBack();
        }
      }),
    [],
  );

  // A failed query has no observer while its region shows its failure, so that neither an invalidation nor a focus
  // reads it again: one is kept here, which reads nothing as it subscribes, and the region comes back on a success.
  useEffect(() => {
    const failed = queryClient
      .getQueryCache()
      .getAll()
      .find(query => query.state.error === error);

    if (failed === undefined) {
      return;
    }

    // Its own options, its function, retries and focus policy included.
    const observer = new QueryObserver(queryClient, {
      ...failed.options,
      queryKey: failed.queryKey,
      retryOnMount: false,
      refetchOnMount: false,
    });

    return observer.subscribe(result => {
      if (result.isSuccess) {
        comeBack();
      }
    });
  }, [queryClient, error]);

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
        <RetryButton retry={retry} />
      </AlertAction>
    </Alert>
  );
}

/** The button that renders a failed region again. */
export function RetryButton({ retry }: { retry: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={retry}>
      Retry
    </Button>
  );
}
