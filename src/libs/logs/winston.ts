import winston from "winston";

import { formatLine } from "./line.ts";

export const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.label({ label: "Hangar" }),
    winston.format.printf(formatLine),
  ),
  transports: [new winston.transports.Console()],
});
