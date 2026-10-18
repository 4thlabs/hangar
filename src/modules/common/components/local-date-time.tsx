"use client";

import { useSyncExternalStore } from "react";

/** How a moment is written, and whether the browser writes it yet. */
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

  /** Nothing to listen to: whether the browser renders only changes once, at hydration. */
  static subscribe() {
    return () => {};
  }

  static inBrowser() {
    return true;
  }

  static onServer() {
    return false;
  }
}

/**
 * A moment, written in the reader's time zone. The server only knows its own: it writes the moment
 * in UTC, saying so, and the browser rewrites it in its own zone once hydrated, without a mismatch.
 * @param value `null` writes a dash
 */
export function LocalDateTime({ value }: { value: Date | string | null }) {
  const inBrowser = useSyncExternalStore(LocalTime.subscribe, LocalTime.inBrowser, LocalTime.onServer);

  if (value === null) {
    return "—";
  }

  const date = new Date(value);
  const zone: Intl.DateTimeFormatOptions = inBrowser ? {} : { timeZone: "UTC", timeZoneName: "short" };

  return <time dateTime={date.toISOString()}>{date.toLocaleString("fr-FR", { ...LocalTime.Fields, ...zone })}</time>;
}
