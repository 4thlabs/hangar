import type { Logform } from "winston";

/** One log line: level, time, label and message, then the error and any other context passed. */
export function formatLine({ timestamp, level, message, label, error, ...context }: Logform.TransformableInfo): string {
  let line = `[${level}] [${timestamp}] [${label}] : ${message}`;

  if (error !== undefined) {
    line += `, ${error}`;
  }

  // Winston's own bookkeeping lives under symbol keys, which `Object.keys` leaves out.
  if (Object.keys(context).length > 0) {
    line += ` ${JSON.stringify(context)}`;
  }

  return line;
}
