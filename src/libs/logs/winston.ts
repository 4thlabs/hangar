import winston from "winston";

export const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.label({ label: "Hangar" }),
    winston.format.printf(({ timestamp, level, message, label, error }) => {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      const base = `[${level}] [${timestamp}] [${label}] : ${message}`;

      // Only when there is one: appending it unconditionally printed ", undefined" on every line
      // that carried no error, which is every `info` the app writes.
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-base-to-string
      return error === undefined ? base : `${base}, ${error}`;
    }),
  ),
  transports: [new winston.transports.Console()],
});
