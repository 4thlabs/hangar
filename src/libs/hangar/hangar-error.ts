export class HangarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HangarError";
  }
};

export class HangarRuntimeError extends HangarError {
  /** The runtime error code */
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
    this.name = "HangarRuntimeError";
  }
}