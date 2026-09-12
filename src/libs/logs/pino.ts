import pino from "pino";

export const logger = pino(
  pino.destination({
    minLength: 4096,
    sync: false,
  }),
);
