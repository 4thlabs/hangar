import { ChildProcess, spawn } from "node:child_process";
import { type Writable } from "node:stream";
import { HangarRuntimeError } from "../hangar-error.ts";

/** A runtime run result */
type RuntimeResult = {
  code: number;
  /** The child's stdout, captured only when `capture` was set; `""` otherwise. */
  stdout: string;
};

/** Options for a single run */
export type RunOptions = {
  /** When set, the child's stdout and stderr are piped here instead of being inherited. */
  pipe?: Writable;
  /**
   * Buffers stdout and returns it on the result, keeping stderr out of it so the output stays
   * parseable. A captured run resolves whatever the exit code is: asking for the output means
   * owning the code, since a command can fail partially and still print usable output.
   */
  capture?: boolean;
  /** Kills the child when aborted. The run then rejects, like any other killed child. */
  signal?: AbortSignal;
};

/** The command runner interface */
export interface CommandRunner {
  run: (command: string, args: string[], options?: RunOptions) => Promise<RuntimeResult>;
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
   * Spawn a command and resolve with its exit code. Without `pipe` or `capture` the child
   * inherits stdio (the CLI case); with `pipe`, stdout and stderr are merged into the given
   * stream; with `capture`, stdout is buffered onto the result and stderr is kept apart.
   *
   * A captured run resolves even on a non-zero exit as long as the command printed something,
   * so a partial success (`docker inspect` with one id gone) is still usable; it only rejects
   * when nothing came out, which is what a real failure looks like.
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

      // Captured separately: merging stderr into stdout is what makes `pipe` unusable
      // for output meant to be parsed.
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

        // A captured run hands back whatever was produced, exit code included: the caller
        // asked for the output, so it decides whether a non-zero code mattered. Its stderr
        // never joins stdout, but it is worth surfacing when the command produced nothing.
        if (capture) {
          return stdout.trim() || code === 0
            ? resolve({ code: code ?? 0, stdout })
            : reject(new HangarRuntimeError(code ?? 1, stderr.trim() || "Process exited."));
        }

        return (code ?? 1) === 0
          ? resolve({ code: code ?? 0, stdout })
          : reject(new HangarRuntimeError(code ?? 1, "Process exited."));
      });
    });
  }
}
