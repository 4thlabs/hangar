import type { Logform } from "winston";

/**
 * One log line: level, time and label, the message, then the error and the rest of the context
 * the caller passed (`logger.warn("…", { error, image })`), so that context is never lost.
 */
export function formatLine({ timestamp, level, message, label, error, ...context }: Logform.TransformableInfo): string {
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  let line = `[${level}] [${timestamp}] [${label}] : ${message}`;

  // Only when there is one: appending it unconditionally printed ", undefined" on every line
  // that carried no error, which is every `info` the app writes.
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-base-to-string
  if (error !== undefined) line += `, ${error}`;

  // Winston's own bookkeeping lives under symbol keys, which `Object.keys` leaves out.
  if (Object.keys(context).length > 0) line += ` ${JSON.stringify(context)}`;

  return line;
}
