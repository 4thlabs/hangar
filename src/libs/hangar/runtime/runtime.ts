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
  /** Buffers stdout (without stderr, so it stays parseable) onto the result. */
  capture?: boolean;
  /** Kills the child when aborted. The run then rejects, like any other killed child. */
  signal?: AbortSignal;
  /** Variables set for the child on top of this process's own, which it otherwise inherits as they are. */
  env?: Record<string, string>;
};

export interface CommandRunner {
  run: (command: string, args: string[], options?: RunOptions) => Promise<RuntimeResult>;
}

/** Runs child commands, and stops them on Ctrl-C when {@link Runtime.signals} is installed. */
export class Runtime implements CommandRunner {
  /** How much of a failed run's stderr becomes its error message: the end, where the cause is. */
  private static readonly FailureStderrLines = 20;

  /** How much of stderr a run keeps while it goes, enough for {@link FailureStderrLines}: a pull's progress is long. */
  private static readonly StderrTailChars = 8_000;

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

      const { pipe, capture, signal, env } = options;

      const child = spawn(command, args, {
        stdio: pipe || capture ? ["ignore", "pipe", "pipe"] : ["inherit", "inherit", "inherit"],
        signal,
        env: env && { ...process.env, ...env },
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
      }

      // Only its end is kept, whenever it is not inherited: a failure reports it.
      child.stderr?.on(
        "data",
        (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-Runtime.StderrTailChars)),
      );

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

        // Any non-zero exit fails, whatever was printed: `docker stack deploy` prints its progress
        // before a failure, which must not pass for a success.
        if (code === 0) {
          return resolve({ code, stdout });
        }

        const tail = stderr.trim().split("\n").slice(-Runtime.FailureStderrLines).join("\n");

        return reject(new HangarRuntimeError(code ?? 1, tail || "Process exited."));
      });
    });
  }
}
