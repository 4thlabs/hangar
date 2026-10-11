"use client";

import { useState } from "react";
import { useRouter } from "waku";

/** Re-renders the current route on demand, with whether it is still at it, for a refresh or retry button. */
export function useRouteRefresh() {
  const router = useRouter();
  const [isRefreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);

    try {
      await router.reload();
    } finally {
      setRefreshing(false);
    }
  }

  return { refresh, isRefreshing };
}
