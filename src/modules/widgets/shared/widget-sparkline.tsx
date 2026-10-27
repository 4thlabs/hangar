import { Sparkline } from "./sparkline.ts";

/** The sparkline's `viewBox`, stretched to its frame: only the proportions of the curve matter. */
const SPARKLINE_BOX = { width: 100, height: 24 };

type WidgetSparklineProps = {
  /** The series, oldest first; a null is a gap in the curve. */
  prices: readonly (number | null)[];
  /** What the curve shows, for a screen reader. */
  label: string;
};

/** A price curve with no axes, stroked in the text color so it follows the theme. Nothing when it has no price. */
export function WidgetSparkline({ prices, label }: WidgetSparklineProps) {
  const polylines = Sparkline.polylines(prices, SPARKLINE_BOX);

  if (polylines.length === 0) {
    return null;
  }

  // The stroke keeps its width however the box is stretched, and spills past it rather than being clipped.
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${SPARKLINE_BOX.width} ${SPARKLINE_BOX.height}`}
      preserveAspectRatio="none"
      className="h-6 w-16 shrink-0 overflow-visible text-primary"
    >
      {polylines.map(points => (
        <polyline
          key={points}
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
