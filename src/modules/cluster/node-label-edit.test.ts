import { describe, expect, it } from "vitest";
import { NodeLabelEdit, type NodeLabelRow } from "./node-label-edit.ts";

const labels = { zone: "home", disk: "hdd" };

const row = (id: number, key: string, value: string): NodeLabelRow => ({ id, key, value });

describe("NodeLabelEdit.rows", () => {
  it("lays the labels out by key, each line with its own id", () => {
    expect(NodeLabelEdit.rows(labels)).toEqual([row(0, "disk", "hdd"), row(1, "zone", "home")]);
  });
});

describe("NodeLabelEdit.changes", () => {
  it("sends only the labels whose value changed, the new ones, and the ones dropped", () => {
    const rows = [row(0, "disk", "ssd"), row(2, "gpu", "")];

    expect(NodeLabelEdit.changes(labels, rows)).toEqual({ set: { disk: "ssd", gpu: "" }, remove: ["zone"] });
  });

  it("sends nothing for lines left as they were, or left blank", () => {
    const changes = NodeLabelEdit.changes(labels, [...NodeLabelEdit.rows(labels), row(5, " ", "")]);

    expect(changes).toEqual({ set: {}, remove: [] });
    expect(NodeLabelEdit.isEmpty(changes)).toBe(true);
  });

  it("renames a label as dropping the old key and setting the new one, trimmed", () => {
    expect(NodeLabelEdit.changes(labels, [row(0, " storage ", " hdd "), row(1, "zone", "home")])).toEqual({
      set: { storage: "hdd" },
      remove: ["disk"],
    });
  });
});

describe("NodeLabelEdit.problem", () => {
  it("flags a key a constraint could not name, and a value over several lines", () => {
    const rows = [row(0, "my disk", "ssd"), row(1, "disk", "a\nb"), row(2, "", "")];

    expect(rows.map(line => NodeLabelEdit.problem(line, rows))).toEqual(["invalid", "invalid", null]);
  });

  it("keeps the first line of a key, and flags the ones repeating it", () => {
    const rows = [row(0, "disk", "ssd"), row(1, "zone", "home"), row(2, " disk", "hdd")];

    expect(rows.map(line => NodeLabelEdit.problem(line, rows))).toEqual([null, null, "duplicate"]);
  });
});

describe("NodeLabelEdit.constraint", () => {
  it("matches the first valid line with a value", () => {
    expect(NodeLabelEdit.constraint([row(0, "gpu", ""), row(1, "bad key", "x"), row(2, "disk", "ssd")])).toBe(
      "node.labels.disk == ssd",
    );
  });

  it("falls back to an example while no line has a value", () => {
    expect(NodeLabelEdit.constraint([row(0, "gpu", "")])).toBe("node.labels.disk == ssd");
  });
});
