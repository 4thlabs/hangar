import type { ComposeEvent, ComposeReport, ComposeStatus, ErrorDetail } from "#libs/api";

/** Where the command is on an app: not started yet, running, or how it ended. */
export type AppRunStatus = "waiting" | "running" | ComposeStatus;

/** The command on one app of a batch, as its output panel shows it. */
export type AppRun = {
  app: string;
  status: AppRunStatus;
  /** Its lines, the last ones when there are too many. */
  lines: readonly string[];
  /** Why it failed, when it did. */
  error: ErrorDetail | null;
};

/** What the panel shows of a batch: each app with its lines and outcome, in the order they run. */
export type ComposeOutputState = {
  apps: readonly AppRun[];
  /** How many events the server no longer kept when this page read them: the start of the output is gone. */
  skipped: number;
  /** How the batch ended, once it did. */
  report: ComposeReport | null;
};

/** A batch's output, folded from its events. */
export class ComposeOutput {
  /** The most lines kept per app: an update pulls many layers, each a line of progress. */
  static readonly MaxLines = 2_000;

  /** The output of a batch over `apps`, in the order they run, before its first event: none until its `batch` says. */
  static create(apps: readonly string[]): ComposeOutputState {
    return {
      apps: apps.map(ComposeOutput.waiting),
      skipped: 0,
      report: null,
    };
  }

  /** `state` once `events` came, in their order. */
  static apply(state: ComposeOutputState, events: readonly ComposeEvent[]): ComposeOutputState {
    return events.reduce(ComposeOutput.applyOne, state);
  }

  /** How many apps the command failed on or did not run on, once the batch ended. */
  static failures(report: ComposeReport): number {
    return report.apps.filter(outcome => outcome.status !== "succeeded").length;
  }

  private static applyOne(state: ComposeOutputState, event: ComposeEvent): ComposeOutputState {
    switch (event.kind) {
      case "batch":
        // The apps in the order the batch runs them, which the page that asked for it did not know.
        return {
          ...state,
          apps: event.apps.map(app => state.apps.find(run => run.app === app) ?? ComposeOutput.waiting(app)),
        };
      case "started":
        return ComposeOutput.update(state, event.app, run => ({ ...run, status: "running" }));
      case "line":
        return ComposeOutput.update(state, event.app, run => ({
          ...run,
          lines: [...run.lines, event.line].slice(-ComposeOutput.MaxLines),
        }));
      case "finished":
        return ComposeOutput.update(state, event.app, run => ({
          ...run,
          status: event.status,
          error: event.error,
        }));
      case "skipped":
        return { ...state, skipped: state.skipped + event.events };
      case "end":
        // The report says how every app ended, those whose `finished` this page missed included.
        return {
          ...event.apps.reduce(
            (ended, outcome) =>
              ComposeOutput.update(ended, outcome.app, run => ({
                ...run,
                status: outcome.status,
                error: outcome.error,
              })),
            state,
          ),
          report: { apps: event.apps },
        };
    }
  }

  /** An app the command has not started on. */
  private static waiting(app: string): AppRun {
    return { app, status: "waiting", lines: [], error: null };
  }

  /** `state` with the run of `app` changed by `change`, added last if the batch did not list it. */
  private static update(state: ComposeOutputState, app: string, change: (run: AppRun) => AppRun): ComposeOutputState {
    const isListed = state.apps.some(run => run.app === app);
    const apps = isListed ? state.apps : [...state.apps, ComposeOutput.waiting(app)];

    return { ...state, apps: apps.map(run => (run.app === app ? change(run) : run)) };
  }
}
