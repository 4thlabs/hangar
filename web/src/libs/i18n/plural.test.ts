import { describe, expect, it } from "vitest";
import { Plural } from "./plural.ts";

const forms = { one: "app", other: "apps" };

describe("Plural", () => {
  it("reads 1 as singular and 0 as plural in English", () => {
    expect(Plural.select("en", 1, forms)).toBe("app");
    expect(Plural.select("en", 0, forms)).toBe("apps");
    expect(Plural.select("en", 2, forms)).toBe("apps");
  });

  it("reads 0 and 1 as singular in French", () => {
    expect(Plural.select("fr", 0, forms)).toBe("app");
    expect(Plural.select("fr", 1, forms)).toBe("app");
    expect(Plural.select("fr", 2, forms)).toBe("apps");
  });
});
