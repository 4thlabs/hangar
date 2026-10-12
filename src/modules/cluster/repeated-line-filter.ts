import { Transform, type TransformCallback } from "node:stream";
import { StringDecoder } from "node:string_decoder";

/**
 * Drops each line identical to the one before it. Without a terminal, `docker stack deploy` prints
 * every progress refresh as a new line ("overall progress: 0 out of 2 tasks", dozens of times) where a
 * terminal would redraw one.
 */
export class RepeatedLineFilter extends Transform {
  private readonly decoder = new StringDecoder("utf8");
  /** The end of the last chunk, until its line is complete. */
  private partial = "";
  private previous: string | null = null;

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
    const lines = `${this.partial}${this.decoder.write(chunk)}`.split("\n");

    this.partial = lines.pop() ?? "";
    this.pushNew(lines.map(line => `${line}\n`));
    callback();
  }

  override _flush(callback: TransformCallback) {
    const last = `${this.partial}${this.decoder.end()}`;

    if (last) {
      this.pushNew([last]);
    }

    callback();
  }

  /** Pushes the lines that differ from the one before them, each with its own line break, if any. */
  private pushNew(lines: string[]) {
    const kept = lines.filter(line => {
      const repeated = line.trimEnd() === this.previous;

      this.previous = line.trimEnd();

      return !repeated;
    });

    if (kept.length > 0) {
      this.push(kept.join(""));
    }
  }
}
