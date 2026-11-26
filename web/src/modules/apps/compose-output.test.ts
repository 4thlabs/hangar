import { describe, expect, it } from "vitest";
import type { ComposeEvent } from "#libs/api";
import { ComposeOutput } from "./compose-output.ts";

const failure = {
  code: "compose.failed",
  params: { app: "beta", command: "docker compose up -d" },
  message: "x",
} as const;

describe("ComposeOutput.apply", () => {
  it("files each app's lines and outcome under it, in the order the batch runs them", () => {
    const events: ComposeEvent[] = [
      { kind: "started", app: "alpha" },
      { kind: "line", app: "alpha", line: "pulling" },
      { kind: "finished", app: "alpha", status: "succeeded", error: null },
      { kind: "started", app: "beta" },
      { kind: "line", app: "beta", line: "no such image" },
    ];

    const output = ComposeOutput.apply(ComposeOutput.create(["alpha", "beta", "gamma"]), events);

    expect(output.apps).toEqual([
      { app: "alpha", status: "succeeded", lines: ["pulling"], error: null },
      { app: "beta", status: "running", lines: ["no such image"], error: null },
      { app: "gamma", status: "waiting", lines: [], error: null },
    ]);

    expect(output.report).toBeNull();
  });

  it("takes from the report how each app ended, those whose end it missed included", () => {
    const outcomes = [
      { app: "alpha", status: "succeeded", error: null },
      { app: "beta", status: "failed", error: failure },
    ] as const;

    const events: ComposeEvent[] = [
      { kind: "skipped", events: 12 },
      { kind: "end", apps: [...outcomes] },
    ];

    const output = ComposeOutput.apply(ComposeOutput.create(["alpha", "beta"]), events);

    expect(output.skipped).toBe(12);
    expect(output.apps.map(run => [run.status, run.error])).toEqual([
      ["succeeded", null],
      ["failed", failure],
    ]);

    expect(output.report && ComposeOutput.failures(output.report)).toBe(1);
  });

  it("keeps the last lines of an app that prints too many", () => {
    const lines: ComposeEvent[] = Array.from({ length: ComposeOutput.MaxLines + 5 }, (_, index) => ({
      kind: "line",
      app: "alpha",
      line: `${index}`,
    }));

    const [alpha] = ComposeOutput.apply(ComposeOutput.create(["alpha"]), lines).apps;

    expect(alpha?.lines).toHaveLength(ComposeOutput.MaxLines);
    expect(alpha?.lines[0]).toBe("5");
  });
});
