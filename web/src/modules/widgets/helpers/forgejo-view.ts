import type { ForgejoRepository, ForgejoRun } from "#libs/api";

/** How many of the repositories updated last the card lists. */
const recentCount = 3;

/** A run as the card lists it. */
export type ForgejoRunView = ForgejoRun & {
  /** Whether it waits for a runner or an approval, rather than runs. */
  isQueued: boolean;
  /** When it started, or, until it does, when it was queued, in RFC 3339. */
  since: string;
};

/** What the CI card shows of Forgejo. */
export type ForgejoView = {
  /** How many repositories the card covers, archived ones too. */
  repositoryCount: number;
  /** Every run not finished yet: running ones first, then newest first, by when they were queued. */
  activeRuns: ForgejoRunView[];
  /** The repositories updated last, newest first, archived ones left out: archiving bumps the time too. */
  recentRepositories: ForgejoRepository[];
};

/** The moment of `time`, RFC 3339 as Forgejo writes it, or the earliest there is for one that is not, sorted last. */
function momentOf(time: string): number {
  const moment = Date.parse(time);

  return Number.isNaN(moment) ? Number.NEGATIVE_INFINITY : moment;
}

/** The order of two times, newest first, as `toSorted` takes it: a time that does not parse comes last. */
function newestFirst(first: string, second: string): number {
  const difference = momentOf(second) - momentOf(first);

  // Two times that do not parse are both the earliest: they keep their order.
  return Number.isNaN(difference) ? 0 : difference;
}

/** The CI card of Forgejo's `repositories` and of the `runs` not finished in them. */
export function forgejoView(repositories: readonly ForgejoRepository[], runs: readonly ForgejoRun[]): ForgejoView {
  const activeRuns = runs
    .map(run => ({ ...run, isQueued: run.status !== "running", since: run.startedAt ?? run.createdAt }))
    .toSorted(
      (first, second) =>
        Number(first.isQueued) - Number(second.isQueued) || newestFirst(first.createdAt, second.createdAt),
    );

  const recentRepositories = repositories
    .filter(repository => !repository.archived)
    .toSorted((first, second) => newestFirst(first.updatedAt, second.updatedAt))
    .slice(0, recentCount);

  return { repositoryCount: repositories.length, activeRuns, recentRepositories };
}
