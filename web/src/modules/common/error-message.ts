import { ApiError, type ErrorDetail } from "#libs/api";

/**
 * What the page says of an error of the server's. Each has a stable code and its params beside its English message,
 * so that a catalog can word them in another language later: this is the one place that will key the words by the
 * code. A body that holds an error, as the sync's, carries it whole, an `ErrorDetail`; a problem carries only its
 * message, its detail, until quoll writes the code (quoll#140).
 */
export class ErrorMessage {
  /** What the page says when the server could not be reached, or answered nothing it reads. */
  static readonly Unreachable = "Could not reach the server. Try again.";

  /** The message of `error`, as a sentence: the server's detail, or why the call got no answer. */
  static describe(error: unknown): string {
    const detail = error instanceof ApiError ? error.problem?.detail : undefined;

    if (detail === undefined) {
      return ErrorMessage.Unreachable;
    }

    return ErrorMessage.sentence(detail);
  }

  /** The message of `detail`, an error a body carries, as a sentence. */
  static describeDetail(detail: ErrorDetail): string {
    return ErrorMessage.sentence(detail.message);
  }

  /** `text` with a capital first letter and a final period, as a detail is written neither. */
  private static sentence(text: string): string {
    const capitalized = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

    return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
  }
}
