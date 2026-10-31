import type { Translate } from "#libs/i18n";
import type { AppsMessages } from "#modules/apps/messages.ts";

/** The compose commands Hangar runs on an app. */
export type AppOperation = "up" | "restart" | "down";

/** A flag Up can add to `up -d`. */
export type UpFlag = "pull" | "forceRecreate";

/** One compose run: the operation, and for `up` the flags it carries, in {@link AppCommands.FlagOrder}. */
export type AppCommand = { operation: AppOperation; flags: readonly UpFlag[] };

/** What each Up flag adds to the command. Adding a flag is adding an entry here, and its words in `AppsMessages`. */
type UpFlagSpec = {
  arguments: readonly string[];
};

/** The words of the commands, in the reader's language. */
type AppsTranslate = Translate<typeof AppsMessages.en>;

/**
 * The compose commands of the Apps pages, shared by the client (labels, confirmations, the query it
 * sends) and the route (validation, arguments), so what the UI shows is what runs.
 */
export class AppCommands {
  static readonly Operations: readonly AppOperation[] = ["up", "restart", "down"];

  /** The order flags take in the command, whatever order they were ticked in. */
  static readonly FlagOrder: readonly UpFlag[] = ["pull", "forceRecreate"];

  static readonly OperationArguments: Record<AppOperation, readonly string[]> = {
    up: ["up", "-d"],
    restart: ["restart"],
    down: ["down"],
  };

  static readonly Flags: Record<UpFlag, UpFlagSpec> = {
    pull: { arguments: ["--pull", "always"] },
    forceRecreate: { arguments: ["--force-recreate"] },
  };

  static create(operation: AppOperation, flags: Iterable<UpFlag> = []): AppCommand {
    const ticked = new Set(flags);

    return { operation, flags: AppCommands.FlagOrder.filter(flag => ticked.has(flag)) };
  }

  /**
   * The command a request asks for, or `null` when it is not one Hangar runs: an unknown operation
   * or flag, a flag repeated, or flags on anything but `up`.
   * @param flags Comma-separated, as {@link query} writes them; empty for none
   */
  static parse(operation: string, flags: string): AppCommand | null {
    const requested = flags.split(",").filter(Boolean);
    const knownOperation = AppCommands.Operations.find(candidate => candidate === operation);
    const knownFlags = requested.filter((flag): flag is UpFlag => AppCommands.FlagOrder.some(known => known === flag));
    const repeated = new Set(requested).size !== requested.length;

    if (!knownOperation || knownFlags.length !== requested.length || repeated) {
      return null;
    }

    if (knownOperation !== "up" && knownFlags.length > 0) {
      return null;
    }

    return AppCommands.create(knownOperation, knownFlags);
  }

  /** The query string the compose route reads back with {@link parse}. */
  static query(command: AppCommand) {
    const parameters = new URLSearchParams({ operation: command.operation });

    if (command.flags.length > 0) {
      parameters.set("flags", command.flags.join(","));
    }

    return parameters.toString();
  }

  /** The `docker compose` arguments the command runs. */
  static arguments(command: AppCommand): string[] {
    return [
      ...AppCommands.OperationArguments[command.operation],
      ...command.flags.flatMap(flag => AppCommands.Flags[flag].arguments),
    ];
  }

  /** The command line, for tooltips and the output sheet. */
  static commandLine(command: AppCommand) {
    return `docker compose ${AppCommands.arguments(command).join(" ")}`;
  }

  /** Whether the run takes the apps down, even briefly: anything but a plain `up -d`, which only adds what is missing. */
  static needsConfirmation(command: AppCommand) {
    return command.operation !== "up" || command.flags.length > 0;
  }

  /** "Up", "Update", "Update and recreate"…: the flags' verbs when there are some. */
  static label(command: AppCommand, t: AppsTranslate) {
    if (command.flags.length === 0) {
      return t(`commands.operation.${command.operation}`);
    }

    const clauses = AppCommands.joinClauses(
      command.flags.map(flag => t(`commands.flags.${flag}.verb`)),
      t,
    );

    return clauses.charAt(0).toUpperCase() + clauses.slice(1);
  }

  /** What the run did to `project`, for the notification filed when it ends. */
  static outcome(command: AppCommand, project: string, t: AppsTranslate) {
    const outcomes =
      command.flags.length === 0
        ? [t(`commands.operationOutcome.${command.operation}`)]
        : command.flags.map(flag => t(`commands.flags.${flag}.outcome`));

    return t("commands.outcome", { project, outcomes: AppCommands.joinClauses(outcomes, t) });
  }

  /** "Update" + "Recreate" → "update and recreate", lowercase to sit inside a sentence. */
  private static joinClauses(clauses: readonly string[], t: AppsTranslate) {
    return clauses.map(clause => clause.charAt(0).toLowerCase() + clause.slice(1)).join(` ${t("commands.and")} `);
  }
}
