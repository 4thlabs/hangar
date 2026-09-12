/** The Tag type */
export interface Tag {
  name: string;
  color: string;
  sources: string[];
}

/** The Project type */
export interface Project {
  id: string;
  name: string;
  dirName: string;
  isArchived: boolean;
  runningCount: number;
  tags: Tag[];
}

/** The Pagination type */
export interface Pagination {
  totalPages: number;
  totalItems: number;
  currentPage: number;
  itemsPerPage: number;
  grandTotalItems: number;
}

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

/**
 * The arcane result envelope.
 *
 * Discriminated on `success`: on a failure envelope `data` is absent, so a
 * non-optional `data` would let the compiler wave through `response.data`
 * on a path where it does not exist.
 */
export type ArcaneResult<T> =
  | { success: true; data: T; pagination?: Pagination; detail?: string }
  | { success: false; data?: undefined; pagination?: Pagination; detail?: string };
