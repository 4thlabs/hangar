import { describe, expect, it } from "vitest";
import { StoreSearchParams } from "./store-search.ts";

describe("StoreSearchParams.validate", () => {
  it("keeps the query and the known filters, in the menu's order", () => {
    expect(StoreSearchParams.validate({ q: "jelly", filter: "available,installed" })).toEqual({
      q: "jelly",
      filter: "installed,available",
    });
  });

  it("drops an unknown filter, a value of another type and an empty query", () => {
    expect(StoreSearchParams.validate({ q: "", filter: "shelved" })).toEqual({});
    expect(StoreSearchParams.validate({ q: 3, filter: ["installed"] })).toEqual({});
    expect(StoreSearchParams.validate({ filter: "installed,shelved" })).toEqual({ filter: "installed" });
  });
});
