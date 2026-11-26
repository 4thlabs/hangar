/** A table's order: a column and its direction, or `null` for the default order. */
export type SortState<Column extends string> = { column: Column; descending: boolean } | null;

/** How a sortable header shows its column's state. */
export type SortDirection = "ascending" | "descending" | "none";

/** The sort cycle of a table's headers, shared by /apps and /cluster. */
export class TableSort {
  /** The sort a header click moves to: ascending, descending, then back to the default order. */
  static next<Column extends string>(current: SortState<Column>, column: Column): SortState<Column> {
    if (current?.column !== column) {
      return { column, descending: false };
    }

    return current.descending ? null : { column, descending: true };
  }

  /** Whether the table is sorted on `column`, and which way. */
  static direction<Column extends string>(sort: SortState<Column>, column: Column): SortDirection {
    if (sort?.column !== column) {
      return "none";
    }

    return sort.descending ? "descending" : "ascending";
  }

  /**
   * Orders `rows` by `value`, always breaking ties on the name: without a tie-break, rows with equal
   * values could swap places on every reload.
   */
  static apply<Row extends { name: string }>(
    rows: readonly Row[],
    { descending }: NonNullable<SortState<string>>,
    value: (row: Row) => number | string,
  ): Row[] {
    return [...rows].sort((left, right) => {
      const [a, b] = [value(left), value(right)];
      const order = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));

      return (descending ? -order : order) || left.name.localeCompare(right.name);
    });
  }

  /** Reads `name` or `-name` from a search param, keeping only a known column. */
  static parse<Column extends string>(param: string, columns: readonly Column[]): SortState<Column> {
    const descending = param.startsWith("-");
    const column = descending ? param.slice(1) : param;

    return columns.includes(column as Column) ? { column: column as Column, descending } : null;
  }

  /** The search param for a sort, `-` marking it descending. */
  static serialize(sort: NonNullable<SortState<string>>) {
    return `${sort.descending ? "-" : ""}${sort.column}`;
  }
}
