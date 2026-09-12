import { Children, Fragment, type ComponentProps, type ReactNode } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { Card } from "#app/components/card/accent-card.tsx";
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import { cn } from "#libs/utils";

export function WidgetCard({ className, ...props }: ComponentProps<typeof Card>) {
  return <Card className={cn("w-full bg-background pt-0", className)} {...props} />;
}

type WidgetHeaderProps = Omit<ComponentProps<typeof CardHeader>, "title"> & {
  bordered?: boolean;
  description?: ReactNode;
  href?: string;
  icon: ReactNode;
  title: ReactNode;
};

export function WidgetHeader({
  bordered = false,
  className,
  description,
  href,
  icon,
  title,
  ...props
}: WidgetHeaderProps) {
  const titleContent = (
    <>
      {icon}
      {title}
      {href && <ExternalLinkIcon aria-hidden="true" className="size-3.5" />}
    </>
  );

  return (
    <CardHeader
      className={cn("pt-(--card-spacing)", description && "gap-0 border-b", bordered && "border-b", className)}
      {...props}
    >
      <CardTitle className="inline-flex items-center gap-1.5">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:underline">
            {titleContent}
          </a>
        ) : (
          titleContent
        )}
      </CardTitle>
      {description && (
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">{description}</CardDescription>
      )}
    </CardHeader>
  );
}

export function WidgetMetadata({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);

  return items.map((item, index) => (
    <Fragment key={index}>
      {index > 0 && <span aria-hidden="true">·</span>}
      {item}
    </Fragment>
  ));
}

export function WidgetContent({ className, ...props }: ComponentProps<typeof CardContent>) {
  return <CardContent className={className} {...props} />;
}

export function WidgetMetricGrid({ className, ...props }: ComponentProps<"dl">) {
  return <dl className={cn("grid grid-cols-2 gap-4 @2xl:grid-cols-4", className)} {...props} />;
}

type WidgetMetricProps = Omit<ComponentProps<"div">, "title"> & {
  detail?: ReactNode;
  label: ReactNode;
  tone?: "default" | "destructive";
  value: ReactNode;
};

export function WidgetMetric({ className, detail, label, tone = "default", value, ...props }: WidgetMetricProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0", className)} {...props}>
      <dt className="text-xs font-medium uppercase leading-tight tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-2xl font-semibold leading-tight tabular-nums text-primary",
          tone === "destructive" && "text-destructive",
        )}
      >
        {value}
      </dd>
      {detail && <dd className="truncate text-xs leading-tight text-muted-foreground">{detail}</dd>}
    </div>
  );
}

export function WidgetList({ className, ...props }: ComponentProps<"ul">) {
  return <ul className={cn("flex flex-col gap-3", className)} {...props} />;
}

type WidgetListItemProps = ComponentProps<"li"> & {
  media?: ReactNode;
  trailing?: ReactNode;
};

export function WidgetListItem({ children, className, media, trailing, ...props }: WidgetListItemProps) {
  return (
    <li className={cn("flex min-w-0 items-center gap-2", className)} {...props}>
      {media}
      <div className="min-w-0 grow">{children}</div>
      {trailing}
    </li>
  );
}

export function WidgetEmptyState({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-muted-foreground", className)} {...props} />;
}

type WidgetFooterProps = Omit<ComponentProps<typeof CardFooter>, "title"> & {
  title?: ReactNode;
};

export function WidgetFooter({ children, className, title, ...props }: WidgetFooterProps) {
  return (
    <CardFooter className={cn("flex-col items-start gap-2", className)} {...props}>
      {typeof title === "string" ? (
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      ) : (
        title
      )}
      {children}
    </CardFooter>
  );
}
