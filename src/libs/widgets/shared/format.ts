/** Counts, as the widget metrics render them. */
export const integerFormatter = new Intl.NumberFormat("en-US");

/** Bytes as gigabytes, the unit Docker disk usage is read in. */
export const formatGigabytes = (bytes: number) => `${(bytes / 1_073_741_824).toFixed(1)} GB`;
