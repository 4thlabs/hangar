import type { SwarmNodeLabelChanges } from "#libs/docker";
import { SwarmRules } from "#libs/docker/swarm-rules";

/** One line of the labels dialog. `id` keeps the line's React key while lines come and go. */
export type NodeLabelRow = { id: number; key: string; value: string };

/** Why a line of the labels dialog cannot be saved. */
export type NodeLabelProblem = "invalid" | "duplicate";

/** The lines of a node's labels dialog, and what saving them changes. */
export class NodeLabelEdit {
  /** The constraint the dialog shows while no line has a value to show it with. */
  private static readonly ExampleConstraint = "node.labels.disk == ssd";

  /** The node's labels as lines, by key. */
  static rows(labels: Record<string, string>): NodeLabelRow[] {
    return Object.keys(labels)
      .sort((a, b) => a.localeCompare(b))
      .map((key, index) => ({ id: index, key, value: labels[key] ?? "" }));
  }

  /** A line with neither key nor value, as **Ajouter un label** adds it: saving skips it. */
  static isBlank(row: NodeLabelRow) {
    return row.key.trim() === "" && row.value.trim() === "";
  }

  /**
   * What keeps a line from being saved, or `null`. Of the lines sharing a key, the first one is valid
   * and the others are duplicates.
   */
  static problem(row: NodeLabelRow, rows: readonly NodeLabelRow[]): NodeLabelProblem | null {
    if (NodeLabelEdit.isBlank(row)) {
      return null;
    }

    const key = row.key.trim();

    if (!SwarmRules.isLabelKey(key) || !SwarmRules.isLabelValue(row.value.trim())) {
      return "invalid";
    }

    const first = rows.find(other => other.key.trim() === key);

    return first?.id === row.id ? null : "duplicate";
  }

  /**
   * What saving the lines changes on the node: the labels whose value differs, and the ones no line
   * keeps. A label the lines leave as it was is not sent, so a change made elsewhere since stands.
   * @param labels The node's labels when the dialog opened
   */
  static changes(labels: Record<string, string>, rows: readonly NodeLabelRow[]): SwarmNodeLabelChanges {
    const target = new Map(
      rows.filter(row => !NodeLabelEdit.isBlank(row)).map(row => [row.key.trim(), row.value.trim()]),
    );

    return {
      set: Object.fromEntries([...target].filter(([key, value]) => labels[key] !== value)),
      remove: Object.keys(labels).filter(key => !target.has(key)),
    };
  }

  static isEmpty(changes: SwarmNodeLabelChanges) {
    return Object.keys(changes.set).length === 0 && changes.remove.length === 0;
  }

  /**
   * A placement constraint matching the first valid line with a value, to show where a label goes: an
   * empty value cannot be matched with `==`.
   */
  static constraint(rows: readonly NodeLabelRow[]) {
    const example = rows.find(row => row.value.trim() !== "" && NodeLabelEdit.problem(row, rows) === null);

    if (!example) {
      return NodeLabelEdit.ExampleConstraint;
    }

    return `node.labels.${example.key.trim()} == ${example.value.trim()}`;
  }
}
