import type Docker from "dockerode";
import { vi } from "vitest";
import type { ComposeContainerSource } from "./projects.ts";

/**
 * The Engine API calls the docker modules make, as vitest mocks. A test file swaps the real
 * client for {@link docker} with `vi.mock("./client.ts", ...)` and drives these.
 */
export const dockerMock = {
  listContainers: vi.fn(),
  inspect: vi.fn(),
  logs: vi.fn(),
  stats: vi.fn(),
  demuxStream: vi.fn(),
};

/** A stand-in for the `docker` singleton, routing every container call through {@link dockerMock}. */
export const docker = {
  listContainers: dockerMock.listContainers,
  getContainer: (id: string) => ({
    inspect: () => dockerMock.inspect(id),
    logs: (options: unknown) => dockerMock.logs(id, options),
    stats: (options: unknown) => dockerMock.stats(id, options),
  }),
  modem: { demuxStream: dockerMock.demuxStream },
};

type Overrides = {
  Id?: string;
  name?: string;
  labels?: Record<string, string>;
  state?: string;
  health?: string;
  ports?: Docker.Port[];
  tty?: boolean;
};

/**
 * One Compose container in both API views, with only the fields the modules read filled in.
 * Cast once here so the tests themselves stay free of `as unknown as` noise.
 */
export function containerSource({
  Id = "container-1",
  name = "/alpha-web-1",
  labels = {
    "com.docker.compose.project": "alpha",
    "com.docker.compose.service": "web",
    "com.docker.compose.container-number": "1",
  },
  state = "running",
  health,
  ports = [{ IP: "127.0.0.1", PrivatePort: 80, PublicPort: 8080, Type: "tcp" }],
  tty = false,
}: Overrides = {}): ComposeContainerSource {
  return {
    info: { Id, Names: [name], Image: "nginx:alpine", Labels: labels, State: state, Ports: ports },
    detail: {
      Id,
      Name: name,
      RestartCount: 2,
      State: { Status: state, ...(health ? { Health: { Status: health } } : {}) },
      Config: { Image: "nginx:alpine", Labels: labels, Tty: tty },
    },
  } as unknown as ComposeContainerSource;
}

/**
 * Wires `listContainers` and `inspect` to the given containers, the way the daemon would: the
 * list is filtered by the label the caller asked for, and each id inspects to its full record.
 */
export function givenContainers(containers: ComposeContainerSource[]) {
  dockerMock.listContainers.mockImplementation((options: { filters?: { label?: string[] } } = {}) => {
    const [label = ""] = options.filters?.label ?? [];
    const [key = "", value] = label.split("=");
    const matches = containers.filter(
      entry => entry.info.Labels[key] !== undefined && (value === undefined || entry.info.Labels[key] === value),
    );

    return Promise.resolve(matches.map(entry => entry.info));
  });

  dockerMock.inspect.mockImplementation((id: string) =>
    Promise.resolve(containers.find(entry => entry.info.Id === id)?.detail),
  );
}
