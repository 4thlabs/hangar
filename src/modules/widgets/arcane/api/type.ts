/** An action item reported by the Arcane dashboard. */
export interface DashboardActionItem {
  severity: string;
  count: number;
  kind: string;
}

/** The subset of Arcane dashboard data displayed by Hangar. */
export interface Dashboard {
  versionInfo: {
    updateAvailable: boolean;
    releaseUrl: string;
    displayVersion: string;
    newestVersion: string;
  };
  containers: {
    counts: {
      totalContainers: number;
      runningContainers: number;
      stoppedContainers: number;
    };
  };
  imageUsageCounts: {
    totalImages: number;
    imagesUnused: number;
    totalImageSize: number;
  };
  volumeUsageCounts: {
    total: number;
    inuse: number;
    unused: number;
  };
  actionItems: {
    items: DashboardActionItem[];
  };
}

/** The Arcane result envelope, discriminated on `success`: a failure still answers 200, with no `data`. */
export type ArcaneResult<T> =
  { success: true; data: T; detail?: string } | { success: false; data?: undefined; detail?: string };
