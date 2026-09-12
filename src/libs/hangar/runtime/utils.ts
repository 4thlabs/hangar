import { stat } from "node:fs/promises"
import { HangarRuntimeError } from "../hangar-error";
import { logger } from "#libs/logs";
import { Hangar } from "../hangar";

/**
 * Check the existance of a file/path
 * @param path The path to check
 */
export const exists = async (path: string) => {
  return stat(path)
    .then(s => s.isDirectory() || s.isSymbolicLink())
    .catch(e => false);
};

/**
 * Runs a function (child process) in sequence, stopping at the first failure
 * @param stacks The stack names to run against
 * @param run The function to run on each stack
 * @param args Arguments passed through to the function
 * @returns The exit code of the first failure, 0 otherwise
 */
export const sequence = async (hangar: Hangar, stacks: string[], run: Function, ...args: string[]) => {
  for (const s of stacks) {
    await run(hangar, s, ...args);
  }
};

/**
 * Run a function (child process) in parallel
 * @param stacks The stack names to run against
 * @param run The function to run on each stack
 * @param args Arguments passed through to the function
 * @returns The first non zero exit code, 0 otherwise
 */
export const parallel = async (hangar: Hangar, stacks: string[], run: Function, ...args: string[]) => {
  await Promise.all(
    stacks.map(s =>
      run(hangar, s, ...args).catch((ex: HangarRuntimeError) => {
        logger.info(ex.message);
      }),
    ),
  );
};