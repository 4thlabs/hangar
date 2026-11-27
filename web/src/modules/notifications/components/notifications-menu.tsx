import { BellIcon } from "lucide-react";
import type { Notification } from "#libs/api";
import { relativeTime } from "#libs/format";
import { useNow } from "#modules/common/hooks/use-now.ts";
import { Button } from "#modules/common/ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "#modules/common/ui/empty.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#modules/common/ui/popover.tsx";
import { ToastIcon } from "#modules/common/ui/toast.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "#modules/common/ui/tooltip.tsx";
import { describeNotification } from "#modules/notifications/helpers/notification-text.ts";
import { useNotifications } from "#modules/notifications/hooks/use-notifications.ts";
import { notificationsMessages } from "#modules/notifications/messages.ts";

const words = notificationsMessages.menu;

type NotificationItemProps = {
  notification: Notification;
  /** The moment its time is written from, the list's `useNow()`. */
  now: number;
  onFollow: () => void;
};

/** A notification of the list; following its link reads the list, as the bell is not closed then. */
function NotificationItem({ notification, now, onFollow }: NotificationItemProps) {
  const { title, description } = describeNotification(notification.message);
  const createdAt = Date.parse(notification.createdAt);

  const body = (
    <>
      <ToastIcon type={notification.level} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
          {!notification.read && (
            <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label={words.unreadMark} />
          )}
        </span>
        {description && <span className="text-muted-foreground">{description}</span>}
        <time className="text-xs text-muted-foreground" dateTime={notification.createdAt}>
          {relativeTime(createdAt, now)}
        </time>
      </span>
    </>
  );

  const className = "flex w-full items-start gap-3 rounded-md p-2 text-left text-sm";

  // A plain anchor, not the router's `Link`: the target is a string from the server, which the typed route table
  // cannot vouch for, and a full load is the right thing after a background command.
  return notification.href ? (
    <a href={notification.href} className={`${className} hover:bg-accent`} onClick={onFollow}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * The notifications the open panel lists, their times written from one clock, which runs only while the panel is open.
 */
function NotificationList({
  notifications,
  onFollow,
}: {
  notifications: readonly Notification[];
  onFollow: () => void;
}) {
  const now = useNow();

  return (
    <div className="flex max-h-96 flex-col overflow-y-auto p-1">
      {notifications.map(item => (
        <NotificationItem key={item.id} notification={item} now={now} onFollow={onFollow} />
      ))}
    </div>
  );
}

/**
 * The bell and its panel. It holds the notifications' stream, and the navbar mounts it once: a second copy would toast
 * everything twice.
 */
export function NotificationsMenu() {
  const { notifications, unread, readAll } = useNotifications();

  // Marked read on close, not on open: the list is worth reading with its unread marks still on.
  function onOpenChange(open: boolean) {
    if (!open) {
      readAll();
    }
  }

  return (
    <Popover onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative"
                  aria-label={unread > 0 ? words.unreadLabel({ count: unread }) : words.title}
                >
                  <BellIcon />
                  {unread > 0 && (
                    <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[0.625rem] font-medium text-primary-foreground tabular-nums">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </Button>
              }
            />
          }
        />
        <TooltipContent>{words.title}</TooltipContent>
      </Tooltip>

      <PopoverContent align="end" sideOffset={6} className="w-80 gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <span className="text-sm font-medium">{words.title}</span>
          {unread > 0 && <span className="text-xs text-muted-foreground">{words.unread({ count: unread })}</span>}
        </div>

        {notifications.length === 0 ? (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BellIcon />
              </EmptyMedia>
              <EmptyTitle>{words.empty}</EmptyTitle>
              <EmptyDescription>{words.emptyDescription}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <NotificationList notifications={notifications} onFollow={readAll} />
        )}
      </PopoverContent>
    </Popover>
  );
}
