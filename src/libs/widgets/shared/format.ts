/** Counts, as the widget metrics render them. */
export const integerFormatter = new Intl.NumberFormat("en-US");

/** Bytes as gigabytes, the unit Docker disk usage is read in. */
export const formatGigabytes = (bytes: number) => `${(bytes / 1_073_741_824).toFixed(1)} GB`;

const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** A millisecond timestamp, as widgets date their items: "2 minutes ago". */
export function formatRelativeTime(timestamp: number, now: number = Date.now()) {
  const seconds = (timestamp - now) / 1_000;
  const absoluteSeconds = Math.abs(seconds);

  if (absoluteSeconds < 60) return relativeTimeFormatter.format(Math.round(seconds), "second");
  if (absoluteSeconds < 3_600) return relativeTimeFormatter.format(Math.round(seconds / 60), "minute");
  if (absoluteSeconds < 86_400) return relativeTimeFormatter.format(Math.round(seconds / 3_600), "hour");
  if (absoluteSeconds < 2_592_000) return relativeTimeFormatter.format(Math.round(seconds / 86_400), "day");
  return relativeTimeFormatter.format(Math.round(seconds / 2_592_000), "month");
}
