import type { LocaleCode } from "#libs/preferences";
import type { Catalog } from "./catalog.ts";

/** A message: words as they are, or a function of its parameters. */
type Leaf = string | ((...args: never[]) => unknown);

/** Every dotted path from the root of `Messages` down to a message: `"env.generate"`, `"tabs.store"`. */
export type MessagePath<Messages> = {
  [Key in keyof Messages & string]: Messages[Key] extends Leaf ? Key : `${Key}.${MessagePath<Messages[Key]>}`;
}[keyof Messages & string];

/** The message at `Path`. */
type MessageAt<Messages, Path extends string> = Path extends `${infer Head}.${infer Rest}`
  ? Head extends keyof Messages
    ? MessageAt<Messages[Head], Rest>
    : never
  : Path extends keyof Messages
    ? Messages[Path]
    : never;

/** What `t` takes after the path: the message's parameters, or nothing for words without any. */
type MessageArguments<Message> = Message extends (...args: infer Arguments) => unknown ? Arguments : [];

/** What `t` returns: the words, or whatever the message function renders. */
type MessageResult<Message> = Message extends (...args: never[]) => infer Result ? Result : string;

/**
 * Looks a message up by its path and renders it: `t("env.generate", { key })`. A path the catalog lacks, or a
 * parameter missing, is a type error.
 */
export type Translate<Messages> = <Path extends MessagePath<Messages>>(
  path: Path,
  ...args: MessageArguments<MessageAt<Messages, Path>>
) => MessageResult<MessageAt<Messages, Path>>;

/** Builds the `t` of a catalog in one language, for the hook, the server and code that is neither. */
export class Translation {
  /**
   * The `t` of `catalog` in `locale`.
   */
  static create<Messages>(catalog: Catalog<Messages>, locale: LocaleCode): Translate<Messages> {
    const messages = catalog[locale];

    return ((path: string, ...args: unknown[]) => {
      const message = Translation.lookUp(messages, path);

      if (typeof message === "function") {
        return (message as (...params: unknown[]) => unknown)(...args);
      }

      return message;
    }) as Translate<Messages>;
  }

  /** The message at `path`. The type only lets through paths that exist: a miss is a bug, not a missing word. */
  private static lookUp(messages: unknown, path: string) {
    let node = messages;

    for (const key of path.split(".")) {
      node = (node as Record<string, unknown> | undefined)?.[key];
    }

    if (typeof node !== "string" && typeof node !== "function") {
      throw new Error(`No message at "${path}"`);
    }

    return node;
  }
}
