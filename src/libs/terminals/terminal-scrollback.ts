/**
 * The latest output of a kept session, replayed to the client that reattaches: the screen it left, give or
 * take what scrolled past the capacity. Cut at a chunk boundary when it can, at a byte otherwise.
 */
export class TerminalScrollback {
  private readonly capacity: number;

  /** Appended at the end; the dropped ones before {@link head} are let go of in batches, not one by one. */
  private chunks: Buffer[] = [];

  /** The oldest chunk still kept. */
  private head = 0;

  private length = 0;

  /**
   * @param capacity How many of the latest bytes it keeps
   */
  constructor(capacity: number) {
    this.capacity = capacity;
  }

  append(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.length += chunk.length;

    // Drops the oldest chunks while what remains still fills the capacity.
    while (this.chunks.length - this.head > 1 && this.length - this.chunks[this.head]!.length >= this.capacity) {
      this.length -= this.chunks[this.head]!.length;
      this.head += 1;
    }

    // Once most of the array is dropped chunks: one copy for many drops, where `shift` copied at each.
    if (this.head * 2 > this.chunks.length) {
      this.chunks = this.chunks.slice(this.head);
      this.head = 0;
    }
  }

  /** The latest bytes, at most the capacity. */
  contents(): Buffer {
    const kept = Buffer.concat(this.chunks.slice(this.head));

    return kept.subarray(Math.max(0, kept.length - this.capacity));
  }
}
