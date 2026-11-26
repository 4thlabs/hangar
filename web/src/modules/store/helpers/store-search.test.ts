import { describe, expect, it } from "vitest";
import { validateStoreSearch } from "./store-search.ts";

describe("validateStoreSearch", () => {
  it("keeps the query and the known filters, in the menu's order", () => {
    expect(validateStoreSearch({ q: "jelly", filter: "available,installed" })).toEqual({
      q: "jelly",
      filter: "installed,available",
    });
  });

  it("drops an unknown filter, a value of another type and an empty query", () => {
    expect(validateStoreSearch({ q: "", filter: "shelved" })).toEqual({});
    expect(validateStoreSearch({ q: 3, filter: ["installed"] })).toEqual({});
    expect(validateStoreSearch({ filter: "installed,shelved" })).toEqual({ filter: "installed" });
  });
});
