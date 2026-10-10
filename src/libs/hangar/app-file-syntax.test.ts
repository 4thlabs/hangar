import { describe, expect, it } from "vitest";
import { AppFileSyntax } from "./app-file-syntax.ts";
import { HangarError } from "./hangar-error.ts";

describe("AppFileSyntax", () => {
  describe("YAML", () => {
    it("accepts a file of several documents", () => {
      expect(() => AppFileSyntax.check("config/rules.yml", "a: 1\n---\nb: 2\n")).not.toThrow();
    });

    it("accepts local tags on scalars, sequences and mappings, as Home Assistant writes them", () => {
      const source =
        "password: !secret db_password\nautomation: !include automations.yaml\nhosts: !list [a, b]\nmqtt: !map { port: 1883 }\n";

      expect(() => AppFileSyntax.check("configuration.yaml", source)).not.toThrow();
    });

    it("accepts an empty file", () => {
      expect(() => AppFileSyntax.check("empty.yml", "")).not.toThrow();
    });

    it("refuses broken YAML with a HangarError naming the file", () => {
      expect(() => AppFileSyntax.check("config/settings.yml", "theme: [dark\n")).toThrow(HangarError);
      expect(() => AppFileSyntax.check("config/settings.yml", "theme: [dark\n")).toThrow(/settings\.yml/);
    });
  });

  describe("env", () => {
    it("accepts variables, comments, blank lines and a quoted multi-line value", () => {
      const source =
        '# Ports\nDELTA_PORT=9090\n\nDELTA_KEY="-----BEGIN KEY-----\nabc\n-----END KEY-----"\nDELTA_HOST=x\n';

      expect(() => AppFileSyntax.check("delta.env", source)).not.toThrow();
    });

    it("refuses a line dotenv would drop", () => {
      expect(() => AppFileSyntax.check("delta.env", "DELTA_PORT=9090\nDELTA HOST\n")).toThrow(/delta\.env, line 2/);
    });

    it("refuses a line after an unclosed quote, which dotenv reads as a single-line value", () => {
      expect(() => AppFileSyntax.check("delta.env", 'PASSWORD="abc\nDELTA HOST\n')).toThrow(/delta\.env, line 2/);
    });
  });

  it("accepts any other file as is", () => {
    expect(() => AppFileSyntax.check("site.conf", "server { listen 80 ")).not.toThrow();
  });
});
