import { describe, expect, it } from "vitest";
import {
  composeCommandLine,
  composeLabel,
  composeSubject,
  confirmationDescription,
  confirmationTitle,
  needsConfirmation,
  upAction,
} from "./compose-actions.ts";

describe("the compose actions", () => {
  it("names a command by its options and writes its line in their order, whatever order they were ticked in", () => {
    const both = upAction(["forceRecreate", "pull"]);

    expect(composeLabel(upAction())).toBe("Up");
    expect(composeLabel(both)).toBe("Update and recreate");
    expect(composeCommandLine(both)).toBe("docker compose up -d --pull always --force-recreate");
    expect(composeCommandLine({ operation: "down" })).toBe("docker compose down");
  });

  it("asks before anything but a plain up, which only adds what is missing", () => {
    expect(needsConfirmation(upAction())).toBe(false);
    expect(needsConfirmation(upAction(["pull"]))).toBe(true);
    expect(needsConfirmation({ operation: "restart" })).toBe(true);
    expect(needsConfirmation({ operation: "down" })).toBe(true);
  });

  it("words a confirmation by how many apps it is about", () => {
    expect(confirmationTitle({ operation: "down" }, "alpha")).toBe("Stop alpha?");
    expect(confirmationTitle(upAction(["pull"]), "3 apps")).toBe("Update 3 apps?");
    expect(confirmationDescription({ operation: "down" }, 3)).toBe(
      "Docker Compose will remove the containers and networks of these apps. They stay listed, stopped.",
    );

    expect(composeSubject(["alpha"])).toBe("alpha");
    expect(composeSubject(["alpha", "beta"])).toBe("2 apps");
  });
});
