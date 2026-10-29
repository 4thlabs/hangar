import { cn } from "cn";
import { FilePenIcon } from "lucide-react";
import { Link } from "waku";
import { buttonVariants } from "#modules/common/ui/button.tsx";

/** Opens the editor on a store app's files, from its own page. */
export function EditAppLink({ app }: { app: string }) {
  return (
    // Merged, as `Button` does: the base classes' `border-transparent` would otherwise hide the outline.
    <Link
      to={{ to: "/apps/[project]/edit", params: { project: app } }}
      className={cn(buttonVariants({ variant: "outline" }))}
    >
      <FilePenIcon data-icon="inline-start" />
      Modifier
    </Link>
  );
}
