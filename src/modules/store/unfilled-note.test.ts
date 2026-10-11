import { describe, expect, it } from "vitest";
import { UnfilledNote } from "./unfilled-note.ts";

describe("UnfilledNote.describe", () => {
  it("says nothing when every variable is filled", () => {
    expect(UnfilledNote.describe([])).toBe("");
  });

  it("names the empty variables and where to fill them", () => {
    const note = UnfilledNote.describe(["MINIFLUX_DB_PASSWORD", "MINIFLUX_ADMIN"]);

    expect(note).toContain("MINIFLUX_DB_PASSWORD, MINIFLUX_ADMIN");
    expect(note).toContain("Paramètres → Environnement");
  });
});
