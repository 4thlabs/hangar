import { ChildProcess, spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { HangarRuntimeError } from "../hangar-error";
import { logger } from "#libs/logs";

let interrupted = false;
const childs: Set<ChildProcess> = new Set();

process.on("SIGINT", () => {
  interrupted = true;
  if (childs.size === 0) process.exit(130);
});

type RuntimeResult = {
  code: number;
};

/**
 * Spawn a command, inheriting stdio, and resolve with its exit code.
 * TODO: Output streaming mode
 * @param command The executable to run
 * @param args Arguments passed to the executable
 */
export const run = (command: string, ...args: string[]) => {
  return new Promise<RuntimeResult>((resolve, rejects) => {
    // Interrupted: don't start anything new, the caller stops on a non-zero code.
    if (interrupted) {
      rejects(new HangarRuntimeError(130, "Process interrupted."));
    }

    const child = spawn(command, args, {
      stdio: ["inherit", "inherit", "inherit"],
    });

    childs.add(child);

    child.on("error", err => {
      childs.delete(child);
      rejects(new HangarRuntimeError(1, `Failed to run ${command}: ${err.message}`));
    });

    // A signal means the child was killed (Ctrl-C during an up): that is a failure.
    child.on("close", (code, signal) => {
      childs.delete(child);
      if (signal) {
        rejects(new HangarRuntimeError(130, "Process interrupted."));
      }

      (code ?? 1) == 0 ? resolve({ code: code ?? 0 }) : rejects(new HangarRuntimeError(1, "Process exited."));
    });
  });
};

/**
 * Check the existance of a file/path
 * @param path The path to check
 */
export const exists = async (path: string) => {
  return await access(path)
    .then(() => true)
    .catch(e => false);
};

/**
 * Runs a function (child process) in sequence, stopping at the first failure
 * @param stacks The stack names to run against
 * @param run The function to run on each stack
 * @param args Arguments passed through to the function
 * @returns The exit code of the first failure, 0 otherwise
 */
export const sequence = async (stacks: string[], run: Function, ...args: string[]) => {
  for (const s of stacks) {
    await run(s, ...args);
  }
};

/**
 * Run a function (child process) in parallel
 * @param stacks The stack names to run against
 * @param run The function to run on each stack
 * @param args Arguments passed through to the function
 * @returns The first non zero exit code, 0 otherwise
 */
export const parallel = async (stacks: string[], run: Function, ...args: string[]) => {
  await Promise.all(
    stacks.map(s =>
      run(s, ...args).catch((ex: HangarRuntimeError) => {
        logger.info(ex.message);
      }),
    ),
  );
};
