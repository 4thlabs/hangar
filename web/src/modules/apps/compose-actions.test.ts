import { describe, expect, it } from "vitest";
import { ComposeActions } from "./compose-actions.ts";

describe("ComposeActions", () => {
  it("names a command by its options and writes its line in their order, whatever order they were ticked in", () => {
    const both = ComposeActions.up(["forceRecreate", "pull"]);

    expect(ComposeActions.label(ComposeActions.up())).toBe("Up");
    expect(ComposeActions.label(both)).toBe("Update and recreate");
    expect(ComposeActions.commandLine(both)).toBe("docker compose up -d --pull always --force-recreate");
    expect(ComposeActions.commandLine({ operation: "down" })).toBe("docker compose down");
  });

  it("asks before anything but a plain up, which only adds what is missing", () => {
    expect(ComposeActions.needsConfirmation(ComposeActions.up())).toBe(false);
    expect(ComposeActions.needsConfirmation(ComposeActions.up(["pull"]))).toBe(true);
    expect(ComposeActions.needsConfirmation({ operation: "restart" })).toBe(true);
    expect(ComposeActions.needsConfirmation({ operation: "down" })).toBe(true);
  });

  it("words a confirmation by how many apps it is about", () => {
    expect(ComposeActions.confirmationTitle({ operation: "down" }, "alpha")).toBe("Stop alpha?");
    expect(ComposeActions.confirmationTitle(ComposeActions.up(["pull"]), "3 apps")).toBe("Update 3 apps?");
    expect(ComposeActions.confirmationDescription({ operation: "down" }, 3)).toBe(
      "Docker Compose will remove the containers and networks of these apps. They stay listed, stopped.",
    );

    expect(ComposeActions.subject(["alpha"])).toBe("alpha");
    expect(ComposeActions.subject(["alpha", "beta"])).toBe("2 apps");
  });
});
