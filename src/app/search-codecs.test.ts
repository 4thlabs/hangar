import { describe, expect, it } from "vitest";
import { storeSearchCodec } from "#app/search-codecs.ts";

describe("storeSearchCodec", () => {
  it("defaults to an empty query and no filter", () => {
    expect(storeSearchCodec.parse("")).toEqual({ q: "", filter: "all" });
  });

  it("parses both params", () => {
    expect(storeSearchCodec.parse("q=jelly&filter=installed")).toEqual({ q: "jelly", filter: "installed" });
  });

  it("falls back to all on an unknown filter", () => {
    expect(storeSearchCodec.parse("filter=nope").filter).toBe("all");
  });

  it("omits empty values from the serialized query", () => {
    expect(storeSearchCodec.serialize({ q: "", filter: "all" })).toBe("");
  });

  it("round-trips", () => {
    const query = "q=home+assistant&filter=available";
    expect(storeSearchCodec.serialize(storeSearchCodec.parse(query))).toBe(query);
  });
});
