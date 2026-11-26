import { useEffect, useState } from "react";

/** How often the clock is read again: a relative time is written to the second under a minute, to the minute above. */
const readEvery = 15_000;

/**
 * The reader's clock, in milliseconds, read again every 15 seconds, for what a component writes relative to now: "2
 * minutes ago". It is state, not `Date.now()` in render: the React compiler would keep the first render's moment, and
 * every time written from it would drift as the page stays open.
 */
export function useNow() {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), readEvery);

    return () => window.clearInterval(interval);
  }, []);

  return now;
}
