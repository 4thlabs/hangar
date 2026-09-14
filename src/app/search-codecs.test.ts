import { describe, expect, it } from "vitest";
import { appsSearchCodec, storeSearchCodec } from "#app/search-codecs.ts";

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

describe("appsSearchCodec", () => {
  it("keeps only real statuses, deduped and in a stable order", () => {
    expect(appsSearchCodec.parse("status=unhealthy,garbage,running,running")).toEqual({
      q: "",
      status: ["running", "unhealthy"],
      sort: null,
    });
  });

  it("treats a missing or empty status as no filter", () => {
    expect(appsSearchCodec.parse("")).toEqual({ q: "", status: [], sort: null });
    expect(appsSearchCodec.parse("status=")).toEqual({ q: "", status: [], sort: null });
  });

  it("keeps the default state out of the URL", () => {
    expect(appsSearchCodec.serialize({ q: "", status: [], sort: null })).toBe("");
  });

  it("round-trips a query and a selection", () => {
    const query = "q=next&status=running%2Cstopped";
    expect(appsSearchCodec.serialize(appsSearchCodec.parse(query))).toBe(query);
  });
});
