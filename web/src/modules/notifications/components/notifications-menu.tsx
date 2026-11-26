import { BellIcon } from "lucide-react";
import type { Notification } from "#libs/api";
import { RelativeTime } from "#libs/format";
import { Button } from "#modules/common/ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "#modules/common/ui/empty.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#modules/common/ui/popover.tsx";
import { ToastIcon } from "#modules/common/ui/toast.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "#modules/common/ui/tooltip.tsx";
import { useNotifications } from "#modules/notifications/hooks/use-notifications.ts";
import { NotificationText } from "#modules/notifications/notification-text.ts";

function NotificationItem({ notification }: { notification: Notification }) {
  const { title, description } = NotificationText.describe(notification.message);
  const createdAt = Date.parse(notification.createdAt);

  const body = (
    <>
      <ToastIcon type={notification.level} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
          {!notification.read && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
        </span>
        {description && <span className="text-muted-foreground">{description}</span>}
        <time className="text-xs text-muted-foreground" dateTime={notification.createdAt}>
          {RelativeTime.format(createdAt)}
        </time>
      </span>
    </>
  );

  const className = "flex w-full items-start gap-3 rounded-md p-2 text-left text-sm";

  // A plain anchor, not the router's `Link`: the target is a string from the server, which the typed route table
  // cannot vouch for, and a full load is the right thing after a background command.
  return notification.href ? (
    <a href={notification.href} className={`${className} hover:bg-accent`}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
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
                  aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
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
        <TooltipContent>Notifications</TooltipContent>
      </Tooltip>

      <PopoverContent align="end" sideOffset={6} className="w-80 gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unread > 0 && <span className="text-xs text-muted-foreground">{unread} unread</span>}
        </div>

        {notifications.length === 0 ? (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BellIcon />
              </EmptyMedia>
              <EmptyTitle>No notifications</EmptyTitle>
              <EmptyDescription>Commands run in the background will land here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex max-h-96 flex-col overflow-y-auto p-1">
            {notifications.map(item => (
              <NotificationItem key={item.id} notification={item} />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
