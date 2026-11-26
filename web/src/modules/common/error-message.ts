import { ApiError } from "#libs/api";

/**
 * What the page says of a failed call. The server's errors each have a stable code and its params beside their
 * English message, the problem's detail, so that a catalog can word them in another language later; quoll does not
 * write the code yet (quoll#140), and the page shows the detail. This is the one place that will read the code.
 */
export class ErrorMessage {
  /** What the page says when the server could not be reached, or answered nothing it reads. */
  static readonly Unreachable = "Could not reach the server. Try again.";

  /** The message of `error`, as a sentence: the server's detail, or why the call got no answer. */
  static of(error: unknown): string {
    const detail = error instanceof ApiError ? error.problem?.detail : undefined;

    if (detail === undefined) {
      return ErrorMessage.Unreachable;
    }

    return ErrorMessage.sentence(detail);
  }

  /** `text` with a capital first letter and a final period, as a detail is written neither. */
  private static sentence(text: string): string {
    const capitalized = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

    return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
  }
}
