import type { VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { FilePenIcon } from "lucide-react";
import { Link } from "waku";
import { AppsMessages } from "#modules/apps/messages.ts";
import { useTranslation } from "#modules/common/hooks/use-translation.ts";
import { buttonVariants } from "#modules/common/ui/button.tsx";

type EditAppLinkProps = {
  /** The store app's id */
  app: string;
  size?: VariantProps<typeof buttonVariants>["size"];
};

/** Opens the editor on a store app's files, from its page on Apps or its sheet on Cluster. */
export function EditAppLink({ app, size }: EditAppLinkProps) {
  const { t } = useTranslation(AppsMessages);

  return (
    // Merged, as `Button` does: the base classes' `border-transparent` would otherwise hide the outline.
    <Link
      to={{ to: "/store/[id]/edit", params: { id: app } }}
      className={cn(buttonVariants({ variant: "outline", size }))}
    >
      <FilePenIcon data-icon="inline-start" />
      {t("edit")}
    </Link>
  );
}
