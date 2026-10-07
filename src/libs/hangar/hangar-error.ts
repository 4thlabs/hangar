/** An expected operator error (bad config, missing app): the CLI prints its message, not a stack. */
export class HangarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HangarError";
  }
}

/** A requested subject (app, project, container) doesn't exist, or isn't one the caller may see. */
export class NotFoundError extends HangarError {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** A failed or interrupted child command; `code` becomes the CLI's exit code. */
export class HangarRuntimeError extends HangarError {
  /** The child's exit code, or 130 when interrupted. */
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = "HangarRuntimeError";
  }
}
