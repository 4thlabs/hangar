import { describe, expect, it } from "vitest";
import { storeSearchCodec } from "#modules/store/search-codec.ts";

describe("storeSearchCodec", () => {
  it("defaults to an empty query", () => {
    expect(storeSearchCodec.parse("")).toEqual({ q: "" });
  });

  it("parses the query, and drops the installed filter it no longer has", () => {
    expect(storeSearchCodec.parse("q=jelly&filter=installed")).toEqual({ q: "jelly" });
  });

  it("omits an empty query from the serialized params", () => {
    expect(storeSearchCodec.serialize({ q: "" })).toBe("");
  });

  it("round-trips", () => {
    const query = "q=home+assistant";

    expect(storeSearchCodec.serialize(storeSearchCodec.parse(query))).toBe(query);
  });
});
