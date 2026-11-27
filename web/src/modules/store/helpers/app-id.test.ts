import { describe, expect, it } from "vitest";
import { appIdError } from "./app-id.ts";

describe("appIdError", () => {
  it("takes a folder name of lowercase letters, digits, `.`, `_` and `-`", () => {
    expect(appIdError("my-app")).toBeUndefined();
    expect(appIdError("0x.app_2")).toBeUndefined();
  });

  it("refuses a name that climbs out of the store, is hidden, or holds a space or a capital", () => {
    for (const id of ["../escape", ".git", "-app", "New App", "My-app", ""]) {
      expect(appIdError(id)).toBe(
        `${id} is not an app id: lowercase letters, digits, \`.\`, \`_\` and \`-\`, starting with a letter or a digit.`,
      );
    }
  });
});
