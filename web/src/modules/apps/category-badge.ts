/**
 * The badge classes of each color of `hangar.yml`, written out whole: Tailwind cannot see a `bg-${color}-500/10`
 * template. Another color keeps the bare `secondary` badge.
 */
export const categoryBadgeClasses: Readonly<Record<string, string>> = {
  blue: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  green: "bg-green-500/10 text-green-700 dark:text-green-300",
  orange: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  purple: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  red: "bg-red-500/10 text-red-700 dark:text-red-300",
};
