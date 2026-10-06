import { describe, expect, it } from "vitest";
import { storeSearchCodec } from "#modules/store/search-codec.ts";

describe("storeSearchCodec", () => {
  it("defaults to an empty query and no filter", () => {
    expect(storeSearchCodec.parse("")).toEqual({ q: "", filter: [] });
  });

  it("parses both params", () => {
    expect(storeSearchCodec.parse("q=jelly&filter=installed")).toEqual({ q: "jelly", filter: ["installed"] });
  });

  it("drops an unknown filter instead of rejecting it", () => {
    expect(storeSearchCodec.parse("filter=nope").filter).toEqual([]);
  });

  it("keeps both filters, deduped and in a stable order", () => {
    expect(storeSearchCodec.parse("filter=available,installed,available").filter).toEqual(["installed", "available"]);
  });

  it("omits empty values from the serialized query", () => {
    expect(storeSearchCodec.serialize({ q: "", filter: [] })).toBe("");
  });

  it("round-trips", () => {
    const query = "q=home+assistant&filter=available";

    expect(storeSearchCodec.serialize(storeSearchCodec.parse(query))).toBe(query);
  });
});
