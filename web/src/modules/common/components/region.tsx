import type { UseQueryResult } from "@tanstack/react-query";
import { CatchBoundary } from "@tanstack/react-router";
import { CircleAlertIcon } from "lucide-react";
import { createContext, use, type ReactNode } from "react";
import { ApiError } from "#libs/api";
import { describeError } from "#modules/common/helpers/error-message.ts";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "#modules/common/ui/alert.tsx";
import { Button } from "#modules/common/ui/button.tsx";

/** What a region that failed is shown: what failed, why, and what starts it over. */
export type RegionFailure = {
  /** `read` when its query failed with no data, `render` when what it shows threw as it rendered. */
  cause: "read" | "render";
  error: unknown;
  /** Reads its query again, or renders it again when it reads nothing. */
  retry: () => void;
};

/**
 * What a region shows once it failed: the title of an alert, which says why when the server did and offers to try
 * again, or a render of its own, which offers `retry` too.
 */
type Failure = string | ((failure: RegionFailure) => ReactNode);

type QueryRegionProps<TData> = {
  /** The caller's `useQuery`: its observer lives above the region, which no failure unmounts. */
  query: UseQueryResult<TData | undefined>;
  /**
   * Data read at this time or before, as `dataUpdatedAt` counts it, is not shown. An edited file passes the
   * `dataUpdatedAt` its mount found, so that it shows the read of this mount alone, never an older copy from the cache.
   */
  readAfter?: number;
  failure: Failure;
  /** What it shows until the query has data or has failed. */
  fallback?: ReactNode;
  /** What it shows of the data. `undefined` data, as a `select` that keeps nothing, shows the fallback. */
  children: (data: TData) => ReactNode;
};

/**
 * A card or a widget that reads, and fails on its own while the rest of the page stands (ADR 0002, decision 4). It
 * shows the result of the caller's `useQuery` in TanStack's order: the data once there is some, even when a later read
 * failed; else the failure of the read, with a Retry; else the fallback. What the data renders sits in a boundary,
 * which shows the failure when it throws and renders again once the query's data changes. React logs the error.
 *
 * The region holds no state: the query comes back as any `useQuery` does, when a feed or a mutation makes it stale,
 * when the window gets the focus back, when the card mounts again, and on the Retry.
 */
export function QueryRegion<TData>({ query, readAfter, failure, fallback = null, children }: QueryRegionProps<TData>) {
  // Joins a read in flight rather than cancel it: a click during a focus read, or a second click, reads once.
  const readAgain = () => void query.refetch({ cancelRefetch: false });

  if (query.data !== undefined && (readAfter === undefined || query.dataUpdatedAt > readAfter)) {
    const data = query.data;

    return (
      <Caught resetKey={query.dataUpdatedAt} failure={failure} retry={readAgain}>
        <Rendered render={() => children(data)} />
      </Caught>
    );
  }

  if (query.isError) {
    return <RegionFailureView cause="read" error={query.error} retry={readAgain} failure={failure} />;
  }

  return fallback;
}

type RenderRegionProps = {
  failure: Failure;
  /** What it shows: when it changes, a region that failed renders again. */
  resetKey?: unknown;
  children: ReactNode;
};

/** A card that reads nothing, as the clock, and fails on its own when it throws as it renders. */
export function RenderRegion({ failure, resetKey, children }: RenderRegionProps) {
  return (
    <Caught resetKey={resetKey} failure={failure}>
      {children}
    </Caught>
  );
}

type CaughtProps = RenderRegionProps & {
  /** What its Retry does, rendering its children again when none is given. */
  retry?: () => void;
};

/** What the failure of a boundary shows, and what its Retry does: given by context to its stable error component. */
type CaughtContext = { failure: Failure; retry: (() => void) | undefined };

const CaughtFailureContext = createContext<CaughtContext>({ failure: "", retry: undefined });

/** TanStack Router's boundary, showing the region's failure in place of what threw. */
function Caught({ failure, resetKey, retry, children }: CaughtProps) {
  return (
    <CaughtFailureContext value={{ failure, retry }}>
      <CatchBoundary getResetKey={() => resetKey} errorComponent={CaughtFailure}>
        {children}
      </CatchBoundary>
    </CaughtFailureContext>
  );
}

/**
 * The failure a boundary caught. A component of the module, never an arrow written in `Caught`: the boundary creates
 * its element from it, and a new function at each render of the parent would be a new type, which mounts the failure
 * again, and its Retry loses the focus.
 */
function CaughtFailure({ error, reset }: { error: unknown; reset: () => void }) {
  const { failure, retry } = use(CaughtFailureContext);

  return <RegionFailureView cause="render" error={error} retry={retry ?? reset} failure={failure} />;
}

/** Calls `render` inside the boundary, so that a `children` function that throws is caught too. */
function Rendered({ render }: { render: () => ReactNode }) {
  return render();
}

/** A failed region: its own failure, or an alert with a Retry. */
function RegionFailureView({ failure, ...shown }: RegionFailure & { failure: Failure }) {
  if (typeof failure !== "string") {
    return failure(shown);
  }

  return (
    <Alert variant="destructive">
      <CircleAlertIcon aria-hidden="true" />
      <AlertTitle>{failure}</AlertTitle>
      {/* Only the server says why: an error of the page's own, as a component that threw, means nothing to its reader. */}
      {shown.error instanceof ApiError && <AlertDescription>{describeError(shown.error)}</AlertDescription>}
      <AlertAction>
        <RetryButton retry={shown.retry} />
      </AlertAction>
    </Alert>
  );
}

/** The button that reads a failed region again, or renders it again. */
export function RetryButton({ retry }: { retry: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={retry}>
      Retry
    </Button>
  );
}
