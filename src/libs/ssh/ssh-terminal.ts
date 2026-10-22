import { Duplex } from "node:stream";
import type { ClientChannel } from "ssh2";
import type { TerminalSize } from "#libs/terminals";

/** A question waiting for its answer, typed into the terminal. */
type PendingQuestion = {
  echo: boolean;
  answer: string;
  resolve: (answer: string | null) => void;
};

/**
 * The terminal of a shell on the host: Hangar's own questions while it signs in (the password, the key's
 * passphrase), then the shell's channel. One stream, as `TerminalSessions` expects: what is written is
 * typed, what is read is shown.
 */
export class SshTerminal {
  private static readonly Enter = /[\r\n]/;

  private static readonly Interrupt = "\x03";

  private static readonly EndOfInput = "\x04";

  private static readonly KillLine = "\x15";

  private static readonly Erase = ["\x7f", "\b"];

  /** Arrows and function keys: a line editor this small has no use for them. */
  private static readonly Escape = "\x1b";

  /** Below it, a control character the questions ignore. */
  private static readonly FirstPrintable = 0x20;

  /** Typed into the session, shown by the client. */
  readonly stream: Duplex;

  private channel: ClientChannel | null = null;

  private question: PendingQuestion | null = null;

  private currentSize: TerminalSize;

  constructor(size: TerminalSize) {
    this.currentSize = size;
    this.stream = new Duplex({
      decodeStrings: false,
      read() {},
      write: (chunk: string | Buffer, _encoding, callback) => {
        this.type(chunk.toString());
        callback();
      },
    });

    // Ended once its output is read, closed then, which is what closes the session.
    this.stream.once("end", () => this.stream.destroy());
    // The client left while a question waited: nobody will answer it.
    this.stream.once("close", () => this.settle(null));
  }

  /** The client's latest size: the shell opens to it. */
  get size(): TerminalSize {
    return this.currentSize;
  }

  /** Shows `output` as is: line ends are `\r\n`, as a TTY writes them. Bytes from the shell stay bytes. */
  print(output: string | Buffer): void {
    if (!this.stream.readableEnded && !this.stream.destroyed) {
      this.stream.push(output);
    }
  }

  /**
   * Asks a question, and reads the line typed back: shown as it is typed when `echo`, hidden otherwise.
   * @returns `null` on Ctrl+C, on Ctrl+D before any input, or when the client left
   */
  ask(question: string, echo: boolean): Promise<string | null> {
    this.print(question);

    return new Promise(resolve => {
      this.question = { echo, answer: "", resolve };
    });
  }

  /** Hands the terminal over to the shell: its output shown, the keys typed sent to it. */
  attach(channel: ClientChannel): void {
    if (this.stream.destroyed) {
      channel.close();

      return;
    }

    this.channel = channel;
    channel.on("data", (data: Buffer) => this.print(data));
    channel.stderr.on("data", (data: Buffer) => this.print(data));
    channel.on("close", () => this.finish());
    channel.setWindow(this.currentSize.rows, this.currentSize.cols, 0, 0);
  }

  /** Keeps the size for the shell to come, and resizes the one open. */
  resize(size: TerminalSize): void {
    this.currentSize = size;
    this.channel?.setWindow(size.rows, size.cols, 0, 0);
  }

  /** Ends the output once shown: the session closes, and with it the connection. */
  finish(): void {
    if (!this.stream.readableEnded && !this.stream.destroyed) {
      this.stream.push(null);
    }
  }

  private type(input: string): void {
    if (this.channel) {
      this.channel.write(input);

      return;
    }

    // Typed while Hangar connects, or once the sign-in failed: no question takes it.
    if (!this.question || input.startsWith(SshTerminal.Escape)) {
      return;
    }

    for (const character of input) {
      if (!this.edit(this.question, character)) {
        return;
      }
    }
  }

  /** Applies one key to the answer being typed. @returns whether the question still waits for more */
  private edit(question: PendingQuestion, character: string): boolean {
    if (SshTerminal.Enter.test(character)) {
      this.print("\r\n");
      this.settle(question.answer);

      return false;
    }

    const interrupted =
      character === SshTerminal.Interrupt || (character === SshTerminal.EndOfInput && question.answer === "");

    if (interrupted) {
      this.print("^C\r\n");
      this.settle(null);

      return false;
    }

    if (SshTerminal.Erase.includes(character)) {
      this.erase(question, 1);
    } else if (character === SshTerminal.KillLine) {
      this.erase(question, [...question.answer].length);
    } else if (character.codePointAt(0)! >= SshTerminal.FirstPrintable) {
      question.answer += character;

      if (question.echo) {
        this.print(character);
      }
    }

    return true;
  }

  /** Removes the last `count` characters typed, from the screen too when they were shown. */
  private erase(question: PendingQuestion, count: number): void {
    const characters = [...question.answer];
    const erased = Math.min(count, characters.length);

    question.answer = characters.slice(0, characters.length - erased).join("");

    if (question.echo) {
      this.print("\b \b".repeat(erased));
    }
  }

  private settle(answer: string | null): void {
    const question = this.question;

    this.question = null;
    question?.resolve(answer);
  }
}
