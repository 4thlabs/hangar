import { cn } from "cn";
import { PlusIcon } from "lucide-react";
import { Link } from "waku";
import { buttonVariants } from "#modules/common/ui/button.tsx";

/** Opens the editor on a new store app, from Apps and Cluster alike. */
export function NewAppLink() {
  return (
    // Merged, as `Button` does: the base classes' `border-transparent` would otherwise hide the outline.
    <Link to="/apps/new" className={cn(buttonVariants({ variant: "outline" }))}>
      <PlusIcon data-icon="inline-start" />
      Nouvelle app
    </Link>
  );
}
