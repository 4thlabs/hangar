import { cn } from "cn";
import type { WidgetIcon } from "#modules/widgets/widget-appearance.ts";

/** A widget's icon, its dark variant on a dark theme when it has one. Decorative: the title names it. */
export function WidgetIconImage({ icon }: { icon: WidgetIcon }) {
  // Contained: not every logo is square (Backrest, Miniflux), and a stretched one reads as a smudge.
  const className = "size-6 object-contain";

  if (icon.dark === undefined) {
    return <img src={icon.src} alt="" className={className} />;
  }

  // Lazy: a hidden lazy image is never fetched, so each theme downloads only the variant it shows.
  return (
    <>
      <img src={icon.src} alt="" loading="lazy" className={cn(className, "dark:hidden")} />
      <img src={icon.dark} alt="" loading="lazy" className={cn(className, "hidden dark:block")} />
    </>
  );
}
