import type { ComposeAction } from "#libs/api";

/** The compose commands the Apps pages run on an app. */
export type ComposeOperation = ComposeAction["operation"];

/** An option Up can add to `up -d`. */
export type UpFlag = "pull" | "forceRecreate";

/** What each option of Up adds to the command, and how the page words it. */
type UpFlagSpec = {
  arguments: readonly string[];
  /** The checkbox in Up's menu. */
  label: string;
  /** What the run is called with this option, as a verb. */
  verb: string;
  /** What it did to an app, completing "<app> was …". */
  outcome: string;
  /** What confirming commits to, about `apps` ("this app", "these apps"). */
  consequence: (apps: string) => string;
};

// The compose commands of the Apps pages: what the buttons, the confirmations and the output say of each, and the
// command the server is asked for, which runs what the page shows.

/** The order the options take in the command, whatever order they were ticked in. */
export const upFlagOrder: readonly UpFlag[] = ["pull", "forceRecreate"];

/** What each option of Up adds to the command, and how the page words it. */
export const upFlags: Readonly<Record<UpFlag, UpFlagSpec>> = {
  pull: {
    arguments: ["--pull", "always"],
    label: "Update the images",
    verb: "Update",
    outcome: "updated from its registry",
    consequence: () => "The images will be pulled from the registry and the containers recreated.",
  },
  forceRecreate: {
    arguments: ["--force-recreate"],
    label: "Force recreation",
    verb: "Recreate",
    outcome: "recreated",
    consequence: apps => `Every container of ${apps} will be recreated, even if its configuration did not change.`,
  },
};

const operationLabels: Readonly<Record<ComposeOperation, string>> = {
  up: "Up",
  restart: "Restart",
  down: "Down",
};

/** What each run without options did to an app, completing "<app> was …". */
const operationOutcomes: Readonly<Record<ComposeOperation, string>> = {
  up: "started or updated",
  restart: "restarted",
  down: "stopped and removed",
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
  const flags = upFlagsOf(action);

  const outcomes =
    flags.length === 0 ? [operationOutcomes[action.operation]] : flags.map(flag => upFlags[flag].outcome);

  return `${project} was ${outcomes.join(" and ")}.`;
}

/** The options `action` carries, in their order. */
export function upFlagsOf(action: ComposeAction): UpFlag[] {
  if (action.operation !== "up") {
    return [];
  }

  return upFlagOrder.filter(flag => action[flag]);
}

/** The command line, as `docker compose up -d --pull always`, for the tooltips and the output. */
export function composeCommandLine(action: ComposeAction): string {
  const options = upFlagsOf(action).flatMap(flag => upFlags[flag].arguments);

  return ["docker", "compose", ...operationArguments[action.operation], ...options].join(" ");
}

/** Whether the run takes the apps down, even briefly: anything but a plain `up -d`, which only adds what is missing. */
export function needsConfirmation(action: ComposeAction): boolean {
  return action.operation !== "up" || upFlagsOf(action).length > 0;
}

/** "Up", "Update", "Update and recreate", "Restart"…: the options' verbs when there are some. */
export function composeLabel(action: ComposeAction): string {
  const flags = upFlagsOf(action);

  if (flags.length === 0) {
    return operationLabels[action.operation];
  }

  const clauses = flags.map(flag => upFlags[flag].verb.toLowerCase()).join(" and ");

  return `${clauses.charAt(0).toUpperCase()}${clauses.slice(1)}`;
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
  return `${count} ${count === 1 ? "app" : "apps"}`;
}

/** The title of the confirmation of `action` on `subject`, an app's name or "3 apps". */
export function confirmationTitle(action: ComposeAction, subject: string): string {
  if (action.operation === "down") {
    return `Stop ${subject}?`;
  }

  return `${composeLabel(action)} ${subject}?`;
}

/** What confirming `action` on `count` apps commits to. */
export function confirmationDescription(action: ComposeAction, count: number): string {
  const apps = count > 1 ? "these apps" : "this app";

  if (action.operation === "down") {
    const staysListed = count > 1 ? "They stay listed" : "It stays listed";

    return `Docker Compose will remove the containers and networks of ${apps}. ${staysListed}, stopped.`;
  }

  if (action.operation === "restart") {
    return `The containers of ${apps} will be restarted without being recreated: a changed configuration will not apply.`;
  }

  return upFlagsOf(action)
    .map(flag => upFlags[flag].consequence(apps))
    .join(" ");
}
