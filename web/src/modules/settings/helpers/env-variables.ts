import type { EnvChanges } from "#libs/api";
import { settingsMessages } from "#modules/settings/messages.ts";

const words = settingsMessages.env;

/** A variable of the env form: its name, and the value being written. */
export type EnvVariable = { key: string; value: string };

/** What the env form holds: a row per variable, by name, and the name of one to add. */
export type EnvFormValues = { variables: EnvVariable[]; newKey: string };

/** The variables compose takes: letters, digits and `_`, not starting with a digit, as the server checks them. */
const variableName = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The form of the variables `read`, sorted by name, and no new name yet. */
export function envFormValues(read: Record<string, string>): EnvFormValues {
  const variables = Object.entries(read)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return { variables, newKey: "" };
}

/**
 * What a save sends, what changed since the read, so that a change made to the file meanwhile is not undone: the
 * rows of `variables` whose value differs from `read`, the new ones among them, and the variables of `read` no row
 * holds any more. A value edited in the file after the read, or a variable removed from it, is left as the file has it
 * unless it was changed here too.
 */
export function envChanges(read: Record<string, string>, variables: readonly EnvVariable[]): EnvChanges {
  const kept = new Set(variables.map(variable => variable.key));

  const updates = Object.fromEntries(
    variables
      .filter(({ key, value }) => !Object.hasOwn(read, key) || read[key] !== value)
      .map(({ key, value }) => [key, value]),
  );

  return { updates, remove: Object.keys(read).filter(key => !kept.has(key)) };
}

/** Why `name` cannot be added to `variables`: a name compose does not take, or one a row holds already. */
export function newVariableError(name: string, variables: readonly EnvVariable[]): string | undefined {
  if (!variableName.test(name)) {
    return words.invalidName({ name });
  }

  if (variables.some(variable => variable.key === name)) {
    return words.exists({ name });
  }

  return undefined;
}

/** Where `name` goes among `variables`, which are sorted by name: the index of the first that sorts after it. */
export function newVariableIndex(variables: readonly EnvVariable[], name: string): number {
  const after = variables.findIndex(variable => variable.key.localeCompare(name) > 0);

  return after === -1 ? variables.length : after;
}
