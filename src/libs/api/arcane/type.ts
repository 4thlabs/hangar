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

/** The arcane result type */
export interface ArcaneResult<T> {
    success: boolean;
    data: T;
    pagination?: Pagination;
    detail?: string
}