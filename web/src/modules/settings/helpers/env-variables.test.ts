import { describe, expect, it } from "vitest";
import { envChanges, envFormValues, newVariableError, withVariable } from "./env-variables.ts";

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

describe("withVariable", () => {
  it("adds the variable, empty, in its place by name", () => {
    const variables = [
      { key: "A", value: "1" },
      { key: "C", value: "3" },
    ];

    expect(withVariable(variables, "B").map(variable => variable.key)).toEqual(["A", "B", "C"]);
  });
});

describe("the order of the variables", () => {
  it("is their names' code units, as the page always sorted them, the same in every locale", () => {
    const names = ["a_lower", "DB_HOST", "ZED", "A_", "DBX", "B", "A1"];
    const order = ["A1", "A_", "B", "DBX", "DB_HOST", "ZED", "a_lower"];

    expect(envFormValues(Object.fromEntries(names.map(name => [name, ""]))).variables.map(row => row.key)).toEqual(
      order,
    );

    expect(withVariable(envFormValues({ A1: "", B: "", ZED: "" }).variables, "A_").map(row => row.key)).toEqual([
      "A1",
      "A_",
      "B",
      "ZED",
    ]);
  });
});
