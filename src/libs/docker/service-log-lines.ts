import { Transform, type TransformCallback } from "node:stream";
import { StringDecoder } from "node:string_decoder";

/**
 * Rewrites the lines of `GET /services/{id}/logs` asked with `details` and `timestamps`: the daemon puts
 * the swarm context between the timestamp and the message, as `key=value` pairs, and this swaps it for
 * the task's name and node, the way `docker service logs` prints it:
 *
 * ```text
 * 2026-10-11T10:00:00.000Z com.docker.swarm.node.id=n1,com.docker.swarm.service.id=s1,com.docker.swarm.task.id=t1 ready
 * 2026-10-11T10:00:00.000Z miniflux_miniflux.1@nas | ready
 * ```
 */
export class ServiceLogLines extends Transform {
  /** The context key naming the task a line comes from. */
  private static readonly TaskKey = "com.docker.swarm.task.id";

  /** How much of an unknown task id is shown, as `docker service ps` shortens it. */
  private static readonly ShortIdLength = 12;

  /** The task names, by task id, as {@link ServiceLogLines.format} prints them. */
  private readonly taskLabels: ReadonlyMap<string, string>;

  /** Keeps a character split between two chunks whole. */
  private readonly decoder = new StringDecoder("utf8");

  /** The end of the last chunk, until its line is complete. */
  private pending = "";

  /**
   * @param taskLabels `<service>.<slot>@<node>` by task id, for the tasks known when the stream opened
   */
  constructor(taskLabels: ReadonlyMap<string, string>) {
    super();
    this.taskLabels = taskLabels;
  }

  /**
   * One line, its context swapped for the task's label. A line without the expected context is left as
   * it is, and a task started after the stream opened shows by its short id.
   */
  static format(line: string, taskLabels: ReadonlyMap<string, string>): string {
    const afterTimestamp = line.indexOf(" ");
    const afterContext = line.indexOf(" ", afterTimestamp + 1);

    if (afterTimestamp === -1) {
      return line;
    }

    const contextEnd = afterContext === -1 ? line.length : afterContext;
    const context = new URLSearchParams(line.slice(afterTimestamp + 1, contextEnd).replaceAll(",", "&"));
    const taskId = context.get(ServiceLogLines.TaskKey);

    if (!taskId) {
      return line;
    }

    const label = taskLabels.get(taskId) ?? taskId.slice(0, ServiceLogLines.ShortIdLength);
    const message = line.slice(contextEnd + 1);

    return `${line.slice(0, afterTimestamp)} ${label} | ${message}`;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback) {
    const lines = (this.pending + this.decoder.write(chunk)).split("\n");

    this.pending = lines.pop() ?? "";

    for (const line of lines) {
      this.push(`${ServiceLogLines.format(line, this.taskLabels)}\n`);
    }

    done();
  }

  override _flush(done: TransformCallback) {
    const rest = this.pending + this.decoder.end();

    if (rest) {
      this.push(ServiceLogLines.format(rest, this.taskLabels));
    }

    done();
  }
}
