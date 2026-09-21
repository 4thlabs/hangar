import { Children, Fragment, type ComponentProps, type ReactNode } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "#app/components/ui/card.tsx";
import { cn } from "cn";
import { formatRelativeTime } from "#libs/format";
import { integerFormatter } from "./format.ts";

export function WidgetCard({ className, ...props }: ComponentProps<typeof Card>) {
  return <Card className={cn("w-full gap-3 bg-background pt-0", className)} {...props} />;
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
      {title?.toString().toUpperCase()}
      {href && <ExternalLinkIcon aria-hidden="true" className="size-3.5" />}
    </>
  );

  return (
    <CardHeader
      className={cn("pt-3 [.border-b]:pb-3", description && "gap-0 border-b", bordered && "border-b", className)}
      {...props}
    >
      <CardTitle className="inline-flex items-center gap-1.5 text-sm tracking-wide">
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
  /** A number is formatted here, so no caller has to remember to — and none can forget. */
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
        {typeof value === "number" ? integerFormatter.format(value) : value}
      </dd>
      {detail && <dd className="truncate text-xs leading-tight text-muted-foreground">{detail}</dd>}
    </div>
  );
}

type WidgetListProps = ComponentProps<"ul"> & {
  /** What to say instead of an empty list. Absent renders the empty `<ul>`. */
  empty?: ReactNode;
};

export function WidgetList({ children, className, empty, ...props }: WidgetListProps) {
  if (empty !== undefined && Children.count(children) === 0) return <WidgetEmptyState>{empty}</WidgetEmptyState>;

  return (
    <ul className={cn("flex flex-col gap-3", className)} {...props}>
      {children}
    </ul>
  );
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

type WidgetTimeProps = {
  /** When it happened, or is due, in milliseconds. Future moments read as "in 22 hours". */
  at: number;
  /** Passed by a card that takes its own `now`, so a test can pin the clock. */
  now?: number;
};

/** A moment, as every widget's trailing column writes one. */
export function WidgetTime({ at, now = Date.now() }: WidgetTimeProps) {
  return (
    <time dateTime={new Date(at).toISOString()} className="shrink-0 text-xs text-muted-foreground">
      {formatRelativeTime(at, now)}
    </time>
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
