import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ComposeContainer, ComposeProjectDetail } from "#libs/docker";
import type { ProjectServices } from "#modules/apps/project-services.ts";
import { ServiceList } from "./service-list.tsx";

const container = (id: string, state: string): ComposeContainer => ({
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

const DETAIL: ComposeProjectDetail = {
  name: "immich",
  status: "partial",
  serviceCount: 2,
  runningCount: 1,
  unhealthyCount: 0,
  containerIds: ["server", "db"],
  services: [
    {
      name: "server",
      status: "running",
      runningCount: 1,
      unhealthyCount: 0,
      containers: [container("server", "running")],
    },
    { name: "db", status: "stopped", runningCount: 0, unhealthyCount: 0, containers: [container("db", "exited")] },
  ],
};

const renderList = (services: ProjectServices | null, expandedService: string | null = null) =>
  renderToStaticMarkup(
    <ServiceList
      project="immich"
      services={services}
      stats={{}}
      expandedService={expandedService}
      onSelect={() => {}}
    />,
  );

describe("ServiceList", () => {
  it("lists each service with its running containers, folded", () => {
    const html = renderList({ state: "loaded", detail: DETAIL });

    expect(html).toContain("server");
    expect(html).toContain("1/1");
    expect(html).toContain("0/1");
    expect(html).not.toContain("immich-server");
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(2);
  });

  it("unfolds a service into its containers, with the console of a running one", () => {
    const html = renderList({ state: "loaded", detail: DETAIL }, "server");

    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("immich-server");
    expect(html).toContain("Open the console of immich-server");
    expect(html).not.toContain("immich-db");
  });

  it("says Docker is being read until its first answer", () => {
    expect(renderList(null)).toContain("Reading Docker…");
  });

  it("says why there is nothing to list", () => {
    expect(renderList({ state: "absent" })).toContain("the app is not started");
    expect(renderList({ state: "unavailable" })).toContain("Docker unavailable");
  });
});
