import { describe, expect, it } from "vitest";
import { IntlFormats } from "./intl-formats.ts";

describe("IntlFormats", () => {
  it("builds a formatter once per language and options", () => {
    expect(IntlFormats.number("fr", { maximumFractionDigits: 1 })).toBe(
      IntlFormats.number("fr", { maximumFractionDigits: 1 }),
    );

    expect(IntlFormats.number("fr")).not.toBe(IntlFormats.number("en"));
    expect(IntlFormats.number("fr")).not.toBe(IntlFormats.number("fr", { maximumFractionDigits: 1 }));
  });

  it("formats in the language asked for", () => {
    expect(IntlFormats.number("en").format(1234.5)).toBe("1,234.5");
    expect(IntlFormats.number("fr").format(1234.5)).toBe("1 234,5");
  });
});
