import ssh2, {
  type AnyAuthMethod,
  type AuthenticationType,
  type AuthHandlerMiddleware,
  type KeyboardInteractiveCallback,
  type ParsedKey,
  type Prompt,
} from "ssh2";
import type { HostShellWords } from "./host-shell-words.ts";
import type { SshTerminal } from "./ssh-terminal.ts";

/** Who signs in, where, and with which key: `null` when none was imported. */
export type SshAccount = { username: string; host: string; privateKey: string | null };

/**
 * How Hangar signs in to the host, one step at a time as ssh2 asks for the next, the way `ssh` does: the
 * imported key first, its passphrase asked in the terminal when it has one, then what the account's
 * password goes through, asked there too. Nothing typed is kept beyond the attempt it was typed for.
 */
export class SshSignIn {
  /** As `ssh`'s `NumberOfPasswordPrompts`. */
  private static readonly Attempts = 3;

  /** What ssh2 says of an encrypted key it was given no passphrase for. */
  private static readonly EncryptedMessage = /no passphrase given/;

  /** Whether the operator gave up with Ctrl+C, rather than the host refusing them. */
  cancelled = false;

  private readonly terminal: SshTerminal;

  private readonly username: string;

  /** `user@host`, as the questions name the account. */
  private readonly account: string;

  private readonly privateKey: string | null;

  private readonly words: HostShellWords;

  private keyTried = false;

  /** Rounds that asked the operator something (a password, a code), so far. */
  private attempts = 0;

  /** Whether the round under way asked the operator anything: one that did not is no attempt of theirs. */
  private asked = false;

  /** Whether the round under way went through keyboard-interactive. */
  private keyboardRound = false;

  /** Until a keyboard-interactive round fails without asking anything, as hosts without PAM do. */
  private keyboardInteractive = true;

  /**
   * @param words What Hangar says in the terminal while signing in, in the reader's language
   */
  constructor(terminal: SshTerminal, { username, host, privateKey }: SshAccount, words: HostShellWords) {
    this.terminal = terminal;
    this.username = username;
    this.account = `${username}@${host}`;
    this.privateKey = privateKey;
    this.words = words;
  }

  /** ssh2's `authHandler`: called first with no methods known, then after each refusal with those left. */
  readonly handler: AuthHandlerMiddleware = (methodsLeft, _partialSuccess, next) => {
    // ssh2's types leave out what it does: `null` methods on the first call, and `false` to give up.
    void this.next(methodsLeft as AuthenticationType[] | null).then(method => next(method as AnyAuthMethod));
  };

  private async next(methodsLeft: AuthenticationType[] | null): Promise<AnyAuthMethod | false> {
    const offered = (method: AuthenticationType) => methodsLeft === null || methodsLeft.includes(method);

    if (this.privateKey !== null && !this.keyTried && offered("publickey")) {
      this.keyTried = true;

      const key = await this.unlock(this.privateKey);

      if (key) {
        return { type: "publickey", username: this.username, key };
      }
    }

    if (this.cancelled) {
      return false;
    }

    // Asks the host which methods it takes, as `ssh` does, before asking anything of the operator.
    if (methodsLeft === null) {
      return { type: "none", username: this.username };
    }

    return this.secret(offered);
  }

  /**
   * The next password attempt, through keyboard-interactive when the host takes it, as `ssh` prefers. Called
   * after each refusal: the previous round says whether the operator was refused, or never asked.
   */
  private async secret(offered: (method: AuthenticationType) => boolean): Promise<AnyAuthMethod | false> {
    const refused = this.asked;

    if (this.keyboardRound && !this.asked) {
      this.keyboardInteractive = false;
    }

    this.asked = false;
    this.keyboardRound = false;

    if (this.attempts >= SshSignIn.Attempts) {
      return false;
    }

    if (refused) {
      this.terminal.print(`${this.words.retry}\r\n`);
    }

    if (this.keyboardInteractive && offered("keyboard-interactive")) {
      this.keyboardRound = true;

      return {
        type: "keyboard-interactive",
        username: this.username,
        prompt: (name, instructions, _language, prompts, finish) =>
          void this.answer(name, instructions, prompts, finish),
      };
    }

    if (!offered("password")) {
      return false;
    }

    this.attempts += 1;
    this.asked = true;

    const password = await this.terminal.ask(this.words.password({ account: this.account }), false);

    if (password === null) {
      this.cancelled = true;

      return false;
    }

    return { type: "password", username: this.username, password };
  }

  /** Shows the host's keyboard-interactive questions (a password, a one-time code) and sends back the answers. */
  private async answer(name: string, instructions: string, prompts: Prompt[], finish: KeyboardInteractiveCallback) {
    const heading = [name, instructions].filter(Boolean).join("\r\n");
    const answers: string[] = [];

    if (heading) {
      this.terminal.print(`${heading}\r\n`);
    }

    // A round may ask in several steps (a password, then a code): it counts once.
    if (prompts.length > 0 && !this.asked) {
      this.attempts += 1;
      this.asked = true;
    }

    for (const { prompt, echo } of prompts) {
      const answer = await this.terminal.ask(prompt, echo ?? false);

      if (answer === null) {
        this.cancelled = true;
        finish([]);

        return;
      }

      answers.push(answer);
    }

    finish(answers);
  }

  /**
   * The key, decrypted with a passphrase asked in the terminal when it has one.
   * @returns `null` to skip the key: an empty passphrase, three wrong ones, Ctrl+C, or a file ssh2 cannot read
   */
  private async unlock(source: string): Promise<ParsedKey | null> {
    const plain = ssh2.utils.parseKey(source);

    if (!(plain instanceof Error)) {
      return plain;
    }

    if (!SshSignIn.EncryptedMessage.test(plain.message)) {
      this.terminal.print(`${this.words.importedKeyIgnored}\r\n`);

      return null;
    }

    for (let attempt = 0; attempt < SshSignIn.Attempts; attempt++) {
      const passphrase = await this.terminal.ask(this.words.passphrase, false);

      if (passphrase === null) {
        this.cancelled = true;

        return null;
      }

      if (passphrase === "") {
        return null;
      }

      const unlocked = ssh2.utils.parseKey(source, passphrase);

      if (!(unlocked instanceof Error)) {
        return unlocked;
      }

      this.terminal.print(`${this.words.wrongPassphrase}\r\n`);
    }

    return null;
  }
}
