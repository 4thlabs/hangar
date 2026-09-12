import { ChildProcess, spawn } from "node:child_process";
import { HangarRuntimeError } from "../hangar-error.ts";
import { logger } from "#libs/logs";

/** A runtime run result */
type RuntimeResult = {
  code: number;
};

/** the run options */
type RuntimeOptions = {

};

/** The command runner interface */
export interface CommandRunner {
  run: (command: string, ...args: string[]) => Promise<RuntimeResult>
}

/**
 * An object for running and managing child commands.
 */
export class Runtime implements CommandRunner {
  /** Interrupted state */
  private interrupted: boolean = false;

  /** A set of the running childs */
  private childs: Set<ChildProcess> = new Set();

  /**
   * Installs signals handler
   */
  signals () {
    process.on("SIGINT", () => {
      this.interrupted = true;
      if (this.childs.size === 0) process.exit(130);
    });
  }

  /**
   * Spawn a command, inheriting stdio, and resolve with its exit code.
   * TODO: Output streaming mode
   * @param command The executable to run
   * @param args Arguments passed to the executable
   */
  run (command: string, ...args: string[]) {
    return new Promise<RuntimeResult>((resolve, rejects) => {
      // Interrupted: don't start anything new, the caller stops on a non-zero code.
      if (this.interrupted) {
        rejects(new HangarRuntimeError(130, "Process interrupted."));
      }

      const child = spawn(command, args, {
        stdio: ["inherit", "inherit", "inherit"],
      });

      this.childs.add(child);

      child.on("error", err => {
        this.childs.delete(child);
        rejects(new HangarRuntimeError(1, `Failed to run ${command}: ${err.message}`));
      });

      // A signal means the child was killed (Ctrl-C during an up): that is a failure.
      child.on("close", (code, signal) => {
        this.childs.delete(child);

        if (signal) {
          rejects(new HangarRuntimeError(130, "Process interrupted."));
        }

        (code ?? 1) == 0 ? resolve({ code: code ?? 0 }) : rejects(new HangarRuntimeError(code ?? 1, "Process exited."));
      });
    });
  };
};
