import { describe, expect, it } from "vitest";
import { containerMetrics, parseBytes, parsePercent, type DockerStatsLine } from "./stats.ts";

describe("parseBytes", () => {
  it("parses decimal units, as used by network and block I/O", () => {
    expect(parseBytes("126B")).toBe(126);
    expect(parseBytes("4.69kB")).toBe(4_690);
    expect(parseBytes("19.7MB")).toBe(19_700_000);
  });

  it("parses binary units, as used by memory", () => {
    expect(parseBytes("37.93MiB")).toBeCloseTo(37.93 * 1024 ** 2);
    expect(parseBytes("2.87GiB")).toBeCloseTo(2.87 * 1024 ** 3);
  });

  it("returns null for the placeholders Docker prints when a value is unavailable", () => {
    expect(parseBytes("--")).toBeNull();
    expect(parseBytes("")).toBeNull();
    expect(parseBytes(undefined)).toBeNull();
  });
});

describe("parsePercent", () => {
  it("strips the percent sign", () => {
    expect(parsePercent("22.38%")).toBe(22.38);
    expect(parsePercent("0.00%")).toBe(0);
  });

  it("returns null when unavailable", () => {
    expect(parsePercent("--")).toBeNull();
    expect(parsePercent(undefined)).toBeNull();
  });
});

describe("containerMetrics", () => {
  // A real line of `docker stats --no-stream --format '{{json .}}'`.
  const line: DockerStatsLine = {
    ID: "c2d660a4c3fb",
    CPUPerc: "22.38%",
    MemUsage: "2.87GiB / 15.62GiB",
    MemPerc: "18.37%",
    NetIO: "4.69kB / 126B",
    BlockIO: "210MB / 19.7MB",
  };

  it("splits every pair into its two sides", () => {
    const metrics = containerMetrics(line);

    expect(metrics.cpuPercent).toBe(22.38);
    expect(metrics.memoryPercent).toBe(18.37);
    expect(metrics.memoryUsage).toBeCloseTo(2.87 * 1024 ** 3);
    expect(metrics.memoryLimit).toBeCloseTo(15.62 * 1024 ** 3);
    expect(metrics.networkRx).toBe(4_690);
    expect(metrics.networkTx).toBe(126);
    expect(metrics.blockRead).toBe(210_000_000);
    expect(metrics.blockWrite).toBe(19_700_000);
  });

  it("degrades to null per field rather than throwing when Docker reports no value", () => {
    const metrics = containerMetrics({ ...line, CPUPerc: "--", BlockIO: "-- / --" });

    expect(metrics.cpuPercent).toBeNull();
    expect(metrics.blockRead).toBeNull();
    expect(metrics.blockWrite).toBeNull();
    // Unaffected fields still parse.
    expect(metrics.memoryPercent).toBe(18.37);
  });
});
