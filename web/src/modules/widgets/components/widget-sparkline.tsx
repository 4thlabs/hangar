import { sparklinePolylines } from "#modules/widgets/sparkline.ts";

type WidgetSparklineProps = {
  /** The series, oldest first; a null is a gap in the curve. */
  prices: readonly (number | null)[];
  /** What the curve shows, for a screen reader. */
  label: string;
};

/** A price curve with no axes, stroked in the text's color so that it follows the theme. Nothing without a price. */
export function WidgetSparkline({ prices, label }: WidgetSparklineProps) {
  // The viewBox, stretched to its frame: only the proportions of the curve matter.
  const box = { width: 100, height: 24 };
  const polylines = sparklinePolylines(prices, box);

  if (polylines.length === 0) {
    return null;
  }

  // The stroke keeps its width however the box is stretched, and spills past it rather than being clipped.
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${box.width} ${box.height}`}
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
