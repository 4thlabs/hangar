import { describe, expect, it } from "vitest";
import { appsSearchCodec } from "#modules/apps/search-codec.ts";

describe("appsSearchCodec", () => {
  it("keeps only real statuses, deduped and in a stable order", () => {
    expect(appsSearchCodec.parse("status=unhealthy,garbage,running,running")).toEqual({
      q: "",
      status: ["running", "unhealthy"],
      category: [],
      update: [],
      sort: null,
    });
  });

  it("keeps categories as written, there being no closed list to check them against", () => {
    expect(appsSearchCodec.parse("category=media,unknown")).toEqual({
      q: "",
      status: [],
      category: ["media", "unknown"],
      update: [],
      sort: null,
    });
  });

  it("treats a missing or empty category as no filter", () => {
    expect(appsSearchCodec.parse("category=")).toEqual({ q: "", status: [], category: [], update: [], sort: null });
    expect(appsSearchCodec.parse("category=,,")).toEqual({ q: "", status: [], category: [], update: [], sort: null });
  });

  it("treats a missing or empty status as no filter", () => {
    expect(appsSearchCodec.parse("")).toEqual({ q: "", status: [], category: [], update: [], sort: null });
    expect(appsSearchCodec.parse("status=")).toEqual({ q: "", status: [], category: [], update: [], sort: null });
  });

  it("keeps the default state out of the URL", () => {
    expect(appsSearchCodec.serialize({ q: "", status: [], category: [], update: [], sort: null })).toBe("");
  });

  it("keeps only real update states", () => {
    expect(appsSearchCodec.parse("update=current,garbage")).toEqual({
      q: "",
      status: [],
      category: [],
      update: ["current"],
      sort: null,
    });
  });

  it("round-trips a query and a selection", () => {
    const query = "q=next&status=running%2Cstopped&category=media%2Cinfra&update=available";

    expect(appsSearchCodec.serialize(appsSearchCodec.parse(query))).toBe(query);
  });
});
