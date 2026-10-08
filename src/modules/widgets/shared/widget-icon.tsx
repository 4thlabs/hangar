import { cn } from "cn";
import type { WidgetIcon } from "../config/config.ts";

// Contained: not every logo is square (Backrest, Miniflux), and a stretched one reads as a smudge.
const ICON_CLASSNAME = "size-6 object-contain";

/** A widget's icon, swapped for its dark variant on a dark theme when it has one. Decorative: the title names it. */
export function WidgetIconImage({ icon }: { icon: WidgetIcon }) {
  if (icon.dark === undefined) {
    return <img src={icon.src} alt="" className={ICON_CLASSNAME} />;
  }

  // Lazy: a hidden lazy image is never fetched, so each theme downloads only the variant it shows.
  return (
    <>
      <img src={icon.src} alt="" loading="lazy" className={cn(ICON_CLASSNAME, "dark:hidden")} />
      <img src={icon.dark} alt="" loading="lazy" className={cn(ICON_CLASSNAME, "hidden dark:block")} />
    </>
  );
}
