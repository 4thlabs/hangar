"use client";

import { IntlFormats } from "#libs/i18n";
import { useInBrowser } from "#modules/common/hooks/use-in-browser.ts";
import { useLocale } from "#modules/common/hooks/use-translation.ts";

/** How a moment is written. */
class LocalTime {
  /** Spelled out: the browser's default and the server's, which names its zone, would differ otherwise */
  static readonly Fields: Intl.DateTimeFormatOptions = {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  };
}

/**
 * A moment, written in the reader's time zone and language. The server only knows its own: it writes the moment
 * in UTC, saying so, and the browser rewrites it in its own zone once hydrated, without a mismatch.
 * @param value `null` writes a dash
 */
export function LocalDateTime({ value }: { value: Date | string | null }) {
  const inBrowser = useInBrowser();
  const locale = useLocale();

  if (value === null) {
    return "—";
  }

  const date = new Date(value);
  const zone: Intl.DateTimeFormatOptions = inBrowser ? {} : { timeZone: "UTC", timeZoneName: "short" };

  return (
    <time dateTime={date.toISOString()}>
      {IntlFormats.dateTime(locale, { ...LocalTime.Fields, ...zone }).format(date)}
    </time>
  );
}
