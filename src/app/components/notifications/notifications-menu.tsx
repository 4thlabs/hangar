"use client";

import { useEffect, useRef, useState } from "react";
import { BellIcon } from "lucide-react";
import { useRouter } from "waku";
import { markNotificationsRead, markNotificationsSeen } from "#app/actions/notifications/manage-notifications.ts";
import { Button } from "#app/components/ui/button.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "#app/components/ui/empty.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#app/components/ui/popover.tsx";
import { toast, ToastIcon } from "#app/components/ui/toast.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "#app/components/ui/tooltip.tsx";
import { formatRelativeTime } from "#libs/format";
import type { NotificationPayload } from "#libs/notifications";

/**
 * How many unseen notifications may toast at once. A batch of ten finished apps is worth one
 * glance, not a wall of panels; the rest are waiting in the bell.
 */
const TOAST_LIMIT = 3;

function NotificationItem({ notification }: { notification: NotificationPayload }) {
  const body = (
    <>
      <ToastIcon type={notification.level} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate font-medium">{notification.title}</span>
          {!notification.read && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="Non lue" />}
        </span>
        {notification.description && <span className="text-muted-foreground">{notification.description}</span>}
        <time className="text-xs text-muted-foreground" dateTime={new Date(notification.createdAt).toISOString()}>
          {formatRelativeTime(notification.createdAt, Date.now(), "fr")}
        </time>
      </span>
    </>
  );

  const className = "flex w-full items-start gap-3 rounded-md p-2 text-left text-sm";

  // A plain anchor, not waku's `Link`: the target is a string from the database, which the typed
  // route table cannot vouch for, and a full load is the right thing after a background command.
  return notification.href ? (
    <a href={notification.href} className={`${className} hover:bg-accent`}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * The bell, its panel, and the stream that fills them.
 *
 * It owns the stream because the navbar mounts it exactly once — one grid for both layouts. A
 * second mounted copy would open a second stream and toast everything twice.
 *
 * @param initial The list rendered server-side, newest first
 */
export function NotificationsMenu({ initial }: { initial: NotificationPayload[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);

  // The stream's cursor is inclusive to the millisecond, so the same notification can come back
  // on the frame after it arrived; this is what makes an arrival idempotent.
  const known = useRef(new Set(initial.map(item => item.id)));

  // Ids already toasted in this tab. `seen` covers coming back to the site; this covers the
  // renders in between, where the flag has not made the round trip yet.
  const toasted = useRef(new Set<string>());

  useEffect(() => {
    const since = initial[0]?.createdAt ?? Date.now();
    const source = new EventSource(`/api/notifications/stream?since=${since}`);

    source.onmessage = event => {
      const fresh = (JSON.parse(event.data as string) as NotificationPayload[]).filter(
        item => !known.current.has(item.id),
      );

      if (fresh.length === 0) return;

      for (const item of fresh) known.current.add(item.id);
      setItems(current => [...fresh.reverse(), ...current]);

      // Something finished server-side, so whatever the page is showing about it is stale. Once
      // per arrival, and never from inside the state updater — React may run that twice, and two
      // overlapping reloads abort each other's render.
      void router.reload();
    };

    return () => source.close();
    // Mounted once: the stream carries its own cursor from there on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const pending = items.filter(item => !item.seen && !toasted.current.has(item.id));
    if (pending.length === 0) return;

    for (const item of pending) toasted.current.add(item.id);

    for (const item of pending.slice(0, TOAST_LIMIT)) {
      toast.add({ title: item.title, description: item.description ?? undefined, type: item.level });
    }

    // Every one of them, not just the toasted three: the others were deliberately withheld, and
    // showing them at the next page load would be stale news.
    void markNotificationsSeen(pending.map(item => item.id));
  }, [items]);

  const unread = items.filter(item => !item.read).length;

  // On close, not on open: the list is worth reading with its unread marks still on, and closing
  // it is the moment the user is done with them. It also means no "mark everything read" button —
  // there is nothing left for one to do.
  function onOpenChange(open: boolean) {
    if (open || unread === 0) return;

    setItems(current => current.map(item => ({ ...item, read: true })));
    void markNotificationsRead();
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
                  aria-label={unread > 0 ? `Notifications, ${unread} non lues` : "Notifications"}
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
          {unread > 0 && <span className="text-xs text-muted-foreground">{unread} non lues</span>}
        </div>

        {items.length === 0 ? (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BellIcon />
              </EmptyMedia>
              <EmptyTitle>Aucune notification</EmptyTitle>
              <EmptyDescription>Les commandes lancées en arrière-plan viendront se ranger ici.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="flex max-h-96 flex-col overflow-y-auto p-1">
            {items.map(item => (
              <NotificationItem key={item.id} notification={item} />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
