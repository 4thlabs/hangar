import { describe, expect, it } from "vitest";
import { AppCommands } from "./app-operation.ts";

describe("AppCommands", () => {
  it("orders the flags as the command takes them, whatever order they were ticked in", () => {
    const command = AppCommands.create("up", ["forceRecreate", "pull"]);

    expect(command.flags).toEqual(["pull", "forceRecreate"]);
    expect(AppCommands.commandLine(command)).toBe("docker compose up -d --pull always --force-recreate");
  });

  it("reads back the query it writes", () => {
    const command = AppCommands.create("up", ["pull"]);
    const query = new URLSearchParams(AppCommands.query(command));

    expect(AppCommands.parse(query.get("operation") ?? "", query.get("flags") ?? "")).toEqual(command);
    expect(AppCommands.query(AppCommands.create("down"))).toBe("operation=down");
  });

  it.each([
    ["an unknown operation", "rm", ""],
    ["an unknown flag", "up", "build"],
    ["a repeated flag", "up", "pull,pull"],
    ["a flag on restart", "restart", "forceRecreate"],
  ])("refuses %s", (_case, operation, flags) => {
    expect(AppCommands.parse(operation, flags)).toBeNull();
  });

  it("runs a plain up straight away and confirms anything that takes the apps down", () => {
    expect(AppCommands.needsConfirmation(AppCommands.create("up"))).toBe(false);
    expect(AppCommands.needsConfirmation(AppCommands.create("up", ["pull"]))).toBe(true);
    expect(AppCommands.needsConfirmation(AppCommands.create("up", ["forceRecreate"]))).toBe(true);
    expect(AppCommands.needsConfirmation(AppCommands.create("restart"))).toBe(true);
    expect(AppCommands.needsConfirmation(AppCommands.create("down"))).toBe(true);
  });

  it("names a run after its flags, and says what it did", () => {
    const both = AppCommands.create("up", ["pull", "forceRecreate"]);

    expect(AppCommands.label(AppCommands.create("up"))).toBe("Up");
    expect(AppCommands.label(AppCommands.create("up", ["pull"]))).toBe("Mettre à jour");
    expect(AppCommands.label(both)).toBe("Mettre à jour et recréer");
    expect(AppCommands.outcome(both, "whoami")).toBe("whoami a été mise à jour depuis son registre et recréée.");
    expect(AppCommands.outcome(AppCommands.create("restart"), "whoami")).toBe("whoami a été redémarrée.");
  });
});
