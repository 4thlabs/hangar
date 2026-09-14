import type { ContainerMetrics } from "./types.ts";

/** Fallback metrics for a container that has no live stats sample (e.g. it isn't running). */
export const EMPTY_CONTAINER_METRICS: ContainerMetrics = {
  cpuPercent: null,
  memoryUsage: null,
  memoryLimit: null,
  memoryPercent: null,
  networkRx: null,
  networkTx: null,
  blockRead: null,
  blockWrite: null,
};

/** One line of `docker stats --no-stream --format '{{json .}}'`, every field pre-formatted as text. */
export type DockerStatsLine = {
  ID: string;
  CPUPerc: string;
  MemUsage: string;
  MemPerc: string;
  NetIO: string;
  BlockIO: string;
};

// Docker mixes unit families in the same line: memory is binary (MiB/GiB), network and
// block I/O are decimal (kB/MB). Both spellings have to parse to the right number of bytes.
const UNITS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
};

/**
 * Parses one Docker-formatted byte size, e.g. `"2.87GiB"`, `"19.7MB"` or `"126B"`.
 * @param value The size as Docker printed it
 * @returns The size in bytes, or `null` when it is absent or unparseable (Docker prints `"--"`)
 */
export function parseBytes(value: string | undefined): number | null {
  const match = /^([\d.]+)\s*([a-z]*)$/i.exec(value?.trim() ?? "");
  if (!match) return null;

  const [, amountText = "", unitText = ""] = match;
  const amount = Number.parseFloat(amountText);
  const unit = UNITS[unitText.toLowerCase() || "b"];

  return Number.isFinite(amount) && unit ? amount * unit : null;
}

/** Parses a Docker-formatted percentage, e.g. `"22.38%"`. */
export function parsePercent(value: string | undefined): number | null {
  const amount = Number.parseFloat(value?.replace("%", "").trim() ?? "");

  return Number.isFinite(amount) ? amount : null;
}

/** Splits a Docker `"<read> / <write>"` pair (used by `NetIO` and `BlockIO`) into bytes. */
const parsePair = (value: string | undefined) => {
  const [left, right] = (value ?? "").split("/");

  return { left: parseBytes(left), right: parseBytes(right) };
};

/**
 * Derives the full {@link ContainerMetrics} shape from one `docker stats` line.
 * Docker already computes the CPU and memory percentages, so nothing is recomputed here.
 * @param stats One parsed line of `docker stats --no-stream --format '{{json .}}'`
 */
export function containerMetrics(stats: DockerStatsLine): ContainerMetrics {
  const memory = parsePair(stats.MemUsage);
  const network = parsePair(stats.NetIO);
  const block = parsePair(stats.BlockIO);

  return {
    cpuPercent: parsePercent(stats.CPUPerc),
    memoryUsage: memory.left,
    memoryLimit: memory.right,
    memoryPercent: parsePercent(stats.MemPerc),
    networkRx: network.left,
    networkTx: network.right,
    blockRead: block.left,
    blockWrite: block.right,
  };
}
