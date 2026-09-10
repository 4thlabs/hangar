export class HangarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HangarError";
  }
};