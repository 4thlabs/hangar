import { describe, expect, it } from "vitest";
import { envChanges, envFormValues, newVariableError, newVariableIndex } from "./env-variables.ts";

describe("envChanges", () => {
  it("sends what changed since the read, the new variables, and the ones of the read no row holds", () => {
    const read = { KEPT: "1", SAME: "2", OLD: "3" };

    const variables = [
      { key: "KEPT", value: "one" },
      { key: "NEW", value: "" },
      { key: "SAME", value: "2" },
    ];

    expect(envChanges(read, variables)).toEqual({ updates: { KEPT: "one", NEW: "" }, remove: ["OLD"] });
  });
});

describe("envFormValues", () => {
  it("gives a row per variable read, by name, and no new name", () => {
    expect(envFormValues({ B: "2", A: "1" })).toEqual({
      variables: [
        { key: "A", value: "1" },
        { key: "B", value: "2" },
      ],
      newKey: "",
    });
  });
});

describe("newVariableError", () => {
  const variables = [{ key: "KEPT", value: "1" }];

  it("refuses a name compose does not take", () => {
    expect(newVariableError("1BAD", variables)).toBe("Invalid variable name: 1BAD.");
    expect(newVariableError("A-B", variables)).toBe("Invalid variable name: A-B.");
  });

  it("refuses a name a row holds already", () => {
    expect(newVariableError("KEPT", variables)).toBe("KEPT is set already.");
  });

  it("takes a new name compose takes", () => {
    expect(newVariableError("_NEW_1", variables)).toBeUndefined();
  });
});

describe("newVariableIndex", () => {
  it("gives the place of a new name among the variables, by name", () => {
    const variables = [
      { key: "A", value: "1" },
      { key: "C", value: "3" },
    ];

    expect(newVariableIndex(variables, "B")).toBe(1);
    expect(newVariableIndex(variables, "D")).toBe(2);
    expect(newVariableIndex([], "A")).toBe(0);
  });
});
