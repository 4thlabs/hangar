import { describe, expect, it } from "vitest";
import { ApiError } from "#libs/api";
import { errorText, formErrorsOf, type FieldsByCode } from "./form-errors.ts";

/** An error the server answered with the problem of `code`, whose members are `params`. */
function coded(code: string, params: Record<string, unknown>) {
  return new ApiError(400, { type: `/problems/${code}`, status: 400, detail: `the message of ${code}`, ...params });
}

/** The env form's table: a variable's code goes under the value of its row, one of `names`. */
function envFields(names: readonly string[]): FieldsByCode<`variables[${number}].value`> {
  const valueOf = (name: string) => {
    const index = names.indexOf(name);

    return index === -1 ? undefined : (`variables[${index}].value` as const);
  };

  return {
    "env.invalid_name": ({ name }) => valueOf(name),
    "env.line_break": ({ name }) => valueOf(name),
  };
}

describe("formErrorsOf", () => {
  it("puts a code under the field its params name, in the words of its code", () => {
    expect(formErrorsOf(coded("env.line_break", { name: "KEPT" }), envFields(["SAME", "KEPT"]))).toEqual({
      fields: { "variables[1].value": "The value of KEPT cannot contain a line break." },
    });
  });

  it("puts a code under a field named __proto__, as an own property", () => {
    const byName: FieldsByCode<string> = { "env.line_break": ({ name }) => name };
    const { fields } = formErrorsOf(coded("env.line_break", { name: "__proto__" }), byName);

    expect(Object.getPrototypeOf(fields)).toBe(Object.prototype);
    expect(Object.entries(fields)).toEqual([["__proto__", "The value of __proto__ cannot contain a line break."]]);
  });

  it("gives the whole form a code whose field it cannot find, or that its table leaves out", () => {
    expect(formErrorsOf(coded("env.line_break", { name: "GONE" }), envFields(["KEPT"]))).toEqual({
      form: "The value of GONE cannot contain a line break.",
      fields: {},
    });

    expect(formErrorsOf(coded("env.save_failed", {}), envFields(["KEPT"]))).toEqual({
      form: ".env.global could not be saved. See the server's log.",
      fields: {},
    });
  });

  it("gives the whole form a problem of no code, and a call that got no answer", () => {
    const quolls = new ApiError(413, { type: "about:blank", status: 413, detail: "the body is too large" });

    expect(formErrorsOf(quolls, envFields([]))).toEqual({ form: "The body is too large.", fields: {} });
    expect(formErrorsOf(new TypeError("Failed to fetch"), envFields([])).form).toBeDefined();
  });
});

describe("errorText", () => {
  it("joins the words among a field's errors, and gives none when there are none", () => {
    expect(errorText(["Invalid variable name: 1BAD.", undefined, { issue: "not words" }])).toBe(
      "Invalid variable name: 1BAD.",
    );

    expect(errorText([undefined])).toBeUndefined();
  });
});
