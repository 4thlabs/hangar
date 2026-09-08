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

/** The arcane result type */
export interface ArcaneResult<T> {
  success: boolean;
  data: T;
  pagination?: Pagination;
  detail?: string;
}
