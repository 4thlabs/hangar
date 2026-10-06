import { ChildProcess, spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { type Writable } from "node:stream";
import { logger } from "#libs/logs";
import { HangarRuntimeError } from "../hangar-error.ts";

type RuntimeResult = {
  code: number;
  /** Only filled when `capture` was set. */
  stdout: string;
};

export type RunOptions = {
  /** When set, the child's stdout and stderr are piped here instead of being inherited. */
  pipe?: Writable;
  /**
   * Buffers stdout (without stderr, so it stays parseable) onto the result. A captured run resolves
   * on a non-zero exit as long as it printed something: a partial failure can still be usable.
   */
  capture?: boolean;
  /** Kills the child when aborted. The run then rejects, like any other killed child. */
  signal?: AbortSignal;
};

export interface CommandRunner {
  run: (command: string, args: string[], options?: RunOptions) => Promise<RuntimeResult>;
}

/** Runs child commands, and stops them on Ctrl-C when {@link Runtime.signals} is installed. */
export class Runtime implements CommandRunner {
  private interrupted: boolean = false;

  private children: Set<ChildProcess> = new Set();

  /**
   * Whether a path exists. Any `stat` failure answers `false`; one other than "not there", such
   * as a permission error, is logged so it does not pass silently for a missing path.
   * @param path The path to check
   */
  static async exists(path: string) {
    return stat(path)
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        const isMissing = error.code === "ENOENT" || error.code === "ENOTDIR";

        if (!isMissing) {
          logger.warn("Could not check whether a path exists", { error, path });
        }

        return false;
      });
  }

  /** Installs the SIGINT handler. CLI only: it exits the process, which a server must not do. */
  signals() {
    process.on("SIGINT", () => {
      this.interrupted = true;
      if (this.children.size === 0) {
        process.exit(130);
      }
    });
  }

  /**
   * Spawns a command and resolves with its exit code. The child inherits stdio unless `pipe` (merged
   * output) or `capture` (see {@link RunOptions}) is set.
   * @param command The executable to run
   * @param args Arguments passed to the executable
   * @param options Run options, see {@link RunOptions}
   */
  run(command: string, args: string[], options: RunOptions = {}) {
    return new Promise<RuntimeResult>((resolve, reject) => {
      // Interrupted: don't start anything new, the caller stops on a non-zero code.
      if (this.interrupted) {
        return reject(new HangarRuntimeError(130, "Process interrupted."));
      }

      const { pipe, capture, signal } = options;

      const child = spawn(command, args, {
        stdio: pipe || capture ? ["ignore", "pipe", "pipe"] : ["inherit", "inherit", "inherit"],
        signal,
      });

      // `end: false`: several children can share one stream (a multi-stack compose),
      // so closing it is the caller's job, not the first child's.
      if (pipe) {
        child.stdout?.pipe(pipe, { end: false });
        child.stderr?.pipe(pipe, { end: false });
      }

      let stdout = "";
      let stderr = "";

      if (capture) {
        child.stdout?.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      }

      this.children.add(child);

      child.on("error", err => {
        this.children.delete(child);
        reject(new HangarRuntimeError(1, `Failed to run ${command}: ${err.message}`));
      });

      // A signal means the child was killed (Ctrl-C during an up, or an aborted stream):
      // that is a failure.
      child.on("close", (code, signal) => {
        this.children.delete(child);

        if (signal) {
          return reject(new HangarRuntimeError(130, "Process interrupted."));
        }

        // stderr only surfaces when a captured run printed nothing.
        const succeeded = code === 0;
        const capturedOutput = capture && stdout.trim() !== "";

        if (succeeded || capturedOutput) {
          return resolve({ code: code ?? 0, stdout });
        }

        const message = (capture && stderr.trim()) || "Process exited.";

        return reject(new HangarRuntimeError(code ?? 1, message));
      });
    });
  }
}
