import type { ComposeAction } from "#libs/api";
import { commonLabels } from "#modules/common/helpers/common-labels.ts";
import { m } from "#paraglide/messages.js";

/** The compose commands the Apps pages run on an app. */
export type ComposeOperation = ComposeAction["operation"];

/** An option Up can add to `up -d`. */
export type UpFlag = "pull" | "forceRecreate";

/** What each option of Up adds to the command, and how the page words it. */
type UpFlagSpec = {
  arguments: readonly string[];
  /** The checkbox in Up's menu. */
  label: () => string;
  /** What the run is called with this option, as a verb. */
  verb: () => string;
  /** What it did to an app, completing "<app> was …". */
  outcome: () => string;
  /** What confirming commits to, about `count` apps. */
  consequence: (params: { count: number }) => string;
};

// The compose commands of the Apps pages: what the buttons, the confirmations and the output say of each, and the
// command the server is asked for, which runs what the page shows.

/** The order the options take in the command, whatever order they were ticked in. */
export const upFlagOrder: readonly UpFlag[] = ["pull", "forceRecreate"];

/** What each option of Up adds to the command, and how the page words it. */
export const upFlagSpecs: Readonly<Record<UpFlag, UpFlagSpec>> = {
  pull: {
    arguments: ["--pull", "always"],
    label: m.common_pull_label,
    verb: m.common_pull_verb,
    outcome: m.common_pull_outcome,
    consequence: m.common_pull_consequence,
  },
  forceRecreate: {
    arguments: ["--force-recreate"],
    label: m.common_force_recreate_label,
    verb: m.common_force_recreate_verb,
    outcome: m.common_force_recreate_outcome,
    consequence: m.common_force_recreate_consequence,
  },
};

/** A list of words joined as English joins them: "updated from its registry and recreated". */
const conjunction = new Intl.ListFormat("en", { type: "conjunction" });

const operationArguments: Readonly<Record<ComposeOperation, readonly string[]>> = {
  up: ["up", "-d"],
  restart: ["restart"],
  down: ["down"],
};

/** `up -d` with the options of `flags`. */
export function upAction(flags: Iterable<UpFlag> = []): ComposeAction {
  const ticked = new Set(flags);

  return { operation: "up", pull: ticked.has("pull"), forceRecreate: ticked.has("forceRecreate") };
}

/**
 * The action a notification names, by its operation and its options, comma-separated as `pull,forceRecreate`;
 * `null` for an operation this page does not know, from a newer server. An option it does not know is left out.
 */
export function composeActionOfNotification(operation: string, flags: string): ComposeAction | null {
  if (operation === "restart" || operation === "down") {
    return { operation };
  }

  if (operation !== "up") {
    return null;
  }

  const named = new Set(flags.split(","));

  return upAction(upFlagOrder.filter(flag => named.has(flag)));
}

/** What `action` did to `project`, as "jellyfin was updated from its registry and recreated.". */
export function composeOutcome(action: ComposeAction, project: string): string {
  const flags = actionFlags(action);

  const outcomes =
    flags.length === 0 ? [commonLabels.outcomes[action.operation]()] : flags.map(flag => upFlagSpecs[flag].outcome());

  return m.common_compose_outcome({ project, outcomes: conjunction.format(outcomes) });
}

/** The options `action` carries, in their order. */
export function actionFlags(action: ComposeAction): UpFlag[] {
  if (action.operation !== "up") {
    return [];
  }

  return upFlagOrder.filter(flag => action[flag]);
}

/** The command line, as `docker compose up -d --pull always`, for the tooltips and the output. */
export function composeCommandLine(action: ComposeAction): string {
  const options = actionFlags(action).flatMap(flag => upFlagSpecs[flag].arguments);

  return ["docker", "compose", ...operationArguments[action.operation], ...options].join(" ");
}

/** Whether the run takes the apps down, even briefly: anything but a plain `up -d`, which only adds what is missing. */
export function needsConfirmation(action: ComposeAction): boolean {
  return action.operation !== "up" || actionFlags(action).length > 0;
}

/** "Up", "Update", "Update and recreate", "Restart"…: the options' verbs when there are some. */
export function composeLabel(action: ComposeAction): string {
  const flags = actionFlags(action);

  if (flags.length === 0) {
    return commonLabels.operations[action.operation]();
  }

  return capitalized(conjunction.format(flags.map(flag => upFlagSpecs[flag].verb().toLowerCase())));
}

/** `text` with a capital first letter. */
function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** How a confirmation or the output names `apps`: the app's name for one, else how many, as "3 apps". */
export function composeSubject(apps: readonly string[]): string {
  if (apps.length === 1) {
    return apps[0] as string;
  }

  return appCount(apps.length);
}

/** `count` apps, in words: "1 app", "3 apps". */
export function appCount(count: number): string {
  return m.common_compose_app_count({ count });
}

/** The title of the confirmation of `action` on `subject`, an app's name or "3 apps". */
export function confirmationTitle(action: ComposeAction, subject: string): string {
  if (action.operation === "down") {
    return m.common_compose_stop_title({ subject });
  }

  return m.common_compose_confirm_title({ label: composeLabel(action), subject });
}

/** What confirming `action` on `count` apps commits to. */
export function confirmationDescription(action: ComposeAction, count: number): string {
  if (action.operation === "down") {
    return m.common_compose_down_description({ count });
  }

  if (action.operation === "restart") {
    return m.common_compose_restart_description({ count });
  }

  return actionFlags(action)
    .map(flag => upFlagSpecs[flag].consequence({ count }))
    .join(" ");
}
