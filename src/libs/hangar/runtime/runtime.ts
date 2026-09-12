import { ChildProcess, spawn } from "node:child_process";
import { HangarRuntimeError } from "../hangar-error.ts";

/** A runtime run result */
type RuntimeResult = {
  code: number;
};

/** The command runner interface */
export interface CommandRunner {
  run: (command: string, ...args: string[]) => Promise<RuntimeResult>;
}

/**
 * An object for running and managing child commands.
 */
export class Runtime implements CommandRunner {
  /** Interrupted state */
  private interrupted: boolean = false;

  /** A set of the running children */
  private children: Set<ChildProcess> = new Set();

  /**
   * Installs the SIGINT handler.
   *
   * Call this from the CLI only: it exits the process, which a long-lived
   * server must not do. Without it `interrupted` never flips and the guard
   * in `run` is unreachable.
   */
  signals() {
    process.on("SIGINT", () => {
      this.interrupted = true;
      if (this.children.size === 0) process.exit(130);
    });
  }

  /**
   * Spawn a command, inheriting stdio, and resolve with its exit code.
   * TODO: Output streaming mode
   * @param command The executable to run
   * @param args Arguments passed to the executable
   */
  run(command: string, ...args: string[]) {
    return new Promise<RuntimeResult>((resolve, reject) => {
      // Interrupted: don't start anything new, the caller stops on a non-zero code.
      if (this.interrupted) {
        return reject(new HangarRuntimeError(130, "Process interrupted."));
      }

      const child = spawn(command, args, {
        stdio: ["inherit", "inherit", "inherit"],
      });

      this.children.add(child);

      child.on("error", err => {
        this.children.delete(child);
        reject(new HangarRuntimeError(1, `Failed to run ${command}: ${err.message}`));
      });

      // A signal means the child was killed (Ctrl-C during an up): that is a failure.
      child.on("close", (code, signal) => {
        this.children.delete(child);

        if (signal) {
          return reject(new HangarRuntimeError(130, "Process interrupted."));
        }

        return (code ?? 1) === 0
          ? resolve({ code: code ?? 0 })
          : reject(new HangarRuntimeError(code ?? 1, "Process exited."));
      });
    });
  }
}
