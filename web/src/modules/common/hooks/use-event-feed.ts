import { useEffect, useEffectEvent, useState } from "react";
import { keepEvents } from "#libs/api";

/** What the reader of a feed is told. */
export type FeedHandlers<T> = {
  /** Each item of the feed. */
  onItem: (item: T) => void;
  /** The feed is open, at first or again: what changed before it is not in it. */
  onOpen?: () => void;
  /** The feed was lost: it is connected again, and `onOpen` told once it is. */
  onDown?: () => void;
  /** The feed was closed, as the tab is hidden, its URL changes or the component goes. */
  onClose?: () => void;
};

/**
 * Follows the `Events` feed at `url`, which does not end, with `keepEvents`: connected again however it is lost, after a
 * wait from a second doubled up to 30, and closed while the tab is hidden, as nobody reads it; none for a `null` url.
 * The handlers are the latest render's: changing them does not connect again.
 *
 * A feed about what the server holds writes the query cache, which it invalidates or sets, and keeps no copy of its
 * own (ADR 0002, decision 3).
 *
 * @returns Whether the feed is lost, so that what it keeps up to date may be stale until it is back.
 */
export function useEventFeed<T>(url: string | null, handlers: FeedHandlers<T>): { isDown: boolean } {
  const [isDown, setDown] = useState(false);

  const opened = useEffectEvent(() => {
    setDown(false);
    handlers.onOpen?.();
  });

  const lost = useEffectEvent(() => {
    setDown(true);
    handlers.onDown?.();
  });

  const closed = useEffectEvent(() => {
    setDown(false);
    handlers.onClose?.();
  });

  const received = useEffectEvent((item: T) => handlers.onItem(item));

  useEffect(() => {
    if (url === null) {
      return;
    }

    let stop: (() => void) | undefined;

    const open = () => {
      stop ??= keepEvents<T>(url, {
        onItem: item => received(item),
        onOpen: () => opened(),
        onDown: () => lost(),
      });
    };

    const close = () => {
      stop?.();
      stop = undefined;
      closed();
    };

    const sync = () => (document.hidden ? close() : open());

    sync();
    document.addEventListener("visibilitychange", sync);

    return () => {
      document.removeEventListener("visibilitychange", sync);
      close();
    };
  }, [url]);

  return { isDown };
}
