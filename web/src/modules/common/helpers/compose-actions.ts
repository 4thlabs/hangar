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
    consequence: m.common_pull_consequence,
  },
  forceRecreate: {
    arguments: ["--force-recreate"],
    label: m.common_force_recreate_label,
    consequence: m.common_force_recreate_consequence,
  },
};

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

/** Each case of a compose command its words tell apart: the operation, and for Up the options it carries. */
export type ComposeCase = ComposeOperation | "upPull" | "upRecreate" | "upPullRecreate";

/** The case of `action`, which its words are chosen by. */
export function composeCase(action: ComposeAction): ComposeCase {
  switch (action.operation) {
    case "up":
      if (action.pull) {
        return action.forceRecreate ? "upPullRecreate" : "upPull";
      }

      return action.forceRecreate ? "upRecreate" : "up";
    case "restart":
      return "restart";
    case "down":
      return "down";
  }
}

/** What `action` did to `project`, as "jellyfin was updated from its registry and recreated.". */
export function composeOutcome(action: ComposeAction, project: string): string {
  return commonLabels.outcomes[composeCase(action)]({ project });
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

/** "Up", "Update", "Update and recreate", "Restart"…: the operation's name, or what its options do when it has some. */
export function composeLabel(action: ComposeAction): string {
  const composed = composeCase(action);

  if (composed === "up" || composed === "restart" || composed === "down") {
    return commonLabels.operations[composed]();
  }

  return commonLabels.combined[composed]();
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
