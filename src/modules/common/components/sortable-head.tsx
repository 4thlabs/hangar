"use client";

import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react";
import { TableSort, type SortState } from "#modules/common/table-sort.ts";
import { TableHead } from "#modules/common/ui/table.tsx";

type SortableHeadProps<Column extends string> = {
  column: Column;
  label: string;
  sort: SortState<Column>;
  onSort: ((column: Column) => void) | undefined;
  className?: string;
};

/** A column header that toggles the table's sort, announcing its state to screen readers. */
export function SortableHead<Column extends string>({
  column,
  label,
  sort,
  onSort,
  className,
}: SortableHeadProps<Column>) {
  const direction = TableSort.direction(sort, column);
  const isActive = direction !== "none";
  const Icon = { ascending: ArrowUpIcon, descending: ArrowDownIcon, none: ChevronsUpDownIcon }[direction];

  return (
    <TableHead className={className} aria-sort={direction}>
      <button
        type="button"
        className="-mx-1 flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 hover:text-foreground/80"
        onClick={() => onSort?.(column)}
      >
        {label}
        <Icon aria-hidden="true" className={isActive ? "size-3.5" : "size-3.5 text-muted-foreground"} />
      </button>
    </TableHead>
  );
}
