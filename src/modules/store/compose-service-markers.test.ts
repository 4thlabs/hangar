import { yaml } from "@codemirror/lang-yaml";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import type { ComposeContainer, ComposeProjectDetail, ComposeService } from "#libs/docker";
import { EMPTY_METRICS } from "#modules/apps/hooks/use-docker-stats.ts";
import { ComposeServiceMarkers } from "./compose-service-markers.ts";

const COMPOSE = `name: immich
services:
  server:
    image: ghcr.io/immich-app/immich-server
    environment:
      services: not-a-service
  "db":
    image: postgres:16
volumes:
  data:
`;

const parsed = (doc: string) => {
  const state = EditorState.create({ doc, extensions: [yaml()] });

  return { state, tree: ensureSyntaxTree(state, doc.length, 1_000)! };
};

const container = (id: string, state = "running"): ComposeContainer => ({
  id,
  name: `immich-${id}`,
  service: id,
  replica: 1,
  image: "image",
  state,
  health: "none",
  restartCount: 0,
  ports: [],
});

const service = (name: string, containers: ComposeContainer[]): ComposeService => {
  const runningCount = containers.filter(candidate => candidate.state === "running").length;

  return {
    name,
    status: runningCount === containers.length ? "running" : "stopped",
    runningCount,
    unhealthyCount: 0,
    containers,
  };
};

const detail = (services: ComposeService[]): ComposeProjectDetail => ({
  name: "immich",
  status: "running",
  serviceCount: services.length,
  runningCount: 0,
  unhealthyCount: 0,
  containerIds: services.flatMap(entry => entry.containers.map(candidate => candidate.id)),
  services,
});

describe("ComposeServiceMarkers.serviceKeys", () => {
  it("lists the top-level services in order, unquoted, and nothing nested", () => {
    const { state, tree } = parsed(COMPOSE);

    expect(ComposeServiceMarkers.serviceKeys(state, tree)).toEqual([
      { name: "server", from: COMPOSE.indexOf("server:") },
      { name: "db", from: COMPOSE.indexOf('"db"') },
    ]);
  });

  it("finds a service added by an edit", () => {
    const { state } = parsed(COMPOSE);

    const edited = state.update({
      changes: { from: COMPOSE.indexOf("volumes:"), insert: "  redis:\n    image: redis\n" },
    });

    const tree = ensureSyntaxTree(edited.state, edited.state.doc.length, 1_000)!;

    expect(ComposeServiceMarkers.serviceKeys(edited.state, tree).map(key => key.name)).toEqual([
      "server",
      "db",
      "redis",
    ]);
  });

  it("finds none in a file without services", () => {
    const { state, tree } = parsed("name: empty\n");

    expect(ComposeServiceMarkers.serviceKeys(state, tree)).toEqual([]);
  });
});

describe("ComposeServiceMarkers.create", () => {
  it("counts running containers and sums their CPU and memory", () => {
    const loaded = detail([service("server", [container("a"), container("b")])]);

    const stats = {
      a: { ...EMPTY_METRICS, cpuPercent: 1.5, memoryUsage: 1_024 },
      b: { ...EMPTY_METRICS, cpuPercent: 2.5, memoryUsage: 1_024 },
    };

    const markers = ComposeServiceMarkers.create({ state: "loaded", detail: loaded }, stats, "en");

    expect(markers?.byService.get("server")).toEqual({ tone: "running", label: "2/2 · 4.0% · 2 KiB" });
  });

  it("shows the count alone before the first stats frame and for a stopped service", () => {
    const loaded = detail([service("db", [container("c", "exited")])]);

    const markers = ComposeServiceMarkers.create({ state: "loaded", detail: loaded }, {}, "en");

    expect(markers?.byService.get("db")).toEqual({ tone: "stopped", label: "0/1" });
  });

  it("shows an unknown CPU as unknown, not as zero, as in a stream's first frame", () => {
    const loaded = detail([service("server", [container("a")])]);
    const stats = { a: { ...EMPTY_METRICS, memoryUsage: 1_024 } };

    const markers = ComposeServiceMarkers.create({ state: "loaded", detail: loaded }, stats, "en");

    expect(markers?.byService.get("server")?.label).toBe("1/1 · — · 1 KiB");
  });

  it("knows no service of an app without container, and nothing before Docker answers or while it cannot", () => {
    expect(ComposeServiceMarkers.create({ state: "absent" }, {}, "fr")).toEqual({
      byService: new Map(),
      missing: { tone: "missing", label: "non créé" },
    });

    expect(ComposeServiceMarkers.create({ state: "unavailable" }, {}, "en")).toBeNull();
    expect(ComposeServiceMarkers.create(null, {}, "en")).toBeNull();
  });
});
