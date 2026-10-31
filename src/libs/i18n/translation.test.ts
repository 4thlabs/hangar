import { describe, expect, it } from "vitest";
import { Translation } from "./translation.ts";

class TestMessages {
  static readonly en = {
    title: "Settings",
    env: {
      generate: ({ key }: { key: string }) => `Generate a secret for ${key}`,
      states: { waiting: "Waiting" },
    },
  };

  static readonly fr: typeof TestMessages.en = {
    title: "Paramètres",
    env: {
      generate: ({ key }) => `Générer un secret pour ${key}`,
      states: { waiting: "En attente" },
    },
  };
}

describe("Translation", () => {
  it("reads words by their path, in the language asked for", () => {
    expect(Translation.create(TestMessages, "en")("title")).toBe("Settings");
    expect(Translation.create(TestMessages, "fr")("env.states.waiting")).toBe("En attente");
  });

  it("hands a message its parameters", () => {
    expect(Translation.create(TestMessages, "fr")("env.generate", { key: "SECRET" })).toBe(
      "Générer un secret pour SECRET",
    );
  });

  it("throws on a path the catalog lacks, which only an unchecked one can reach", () => {
    const unchecked = Translation.create(TestMessages, "en") as (path: string) => string;

    expect(() => unchecked("env.states")).toThrow('No message at "env.states"');
  });
});
