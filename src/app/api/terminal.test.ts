import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalMessages } from "#modules/terminal/messages.ts";

// Lives here rather than beside the routes: waku turns every file under `src/app/pages/` into a route,
// test files included, which breaks the build.
const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  containerShells: { open: vi.fn() },
  hostShells: { address: "server.lan:22", open: vi.fn() } as { address: string; open: ReturnType<typeof vi.fn> } | null,
  terminals: { open: vi.fn(), attach: vi.fn(), write: vi.fn(), resize: vi.fn(), close: vi.fn() },
  logger: { error: vi.fn() },
}));

vi.mock("server-only", () => ({}));
vi.mock("#libs/auth/server", () => ({ sessions: { get: mocks.getSession } }));
vi.mock("#libs/docker/server", () => ({ containerShells: mocks.containerShells }));
vi.mock("#libs/terminals/server", () => ({ terminals: mocks.terminals }));
vi.mock("#libs/ssh/server", () => ({
  get hostShells() {
    return mocks.hostShells;
  },
}));

vi.mock("#libs/logs", () => ({ logger: mocks.logger }));

const { DockerNotFoundError } = await import("#libs/docker");
const { TerminalNotFoundError } = await import("#libs/terminals");
const { POST: openHost } = await import("#app/pages/_api/api/host/terminal.ts");
const { POST: open } = await import("#app/pages/_api/api/docker/apps/[project]/containers/[container]/terminal.ts");
const { POST: send, DELETE: close } = await import("#app/pages/_api/api/terminals/[terminal].ts");

const CONTAINER_ID = "a".repeat(64);

/** What `ContainerShells.open` hands the sessions; the test only checks it gets there. */
const SHELL = { target: { container: CONTAINER_ID } };

/** A JSON `POST`, as the terminal sends them. */
const post = (body: unknown) =>
  new Request("http://localhost/terminal", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "user-1" } });
});

describe("POST a container terminal", () => {
  const context = { params: { project: "alpha", container: CONTAINER_ID } };

  beforeEach(() => {
    mocks.containerShells.open.mockResolvedValue(SHELL);
    mocks.terminals.open.mockReturnValue({
      id: "session-1",
      output: Readable.from([Buffer.from("/ # ")]),
      replayedBytes: 0,
    });
  });

  it("returns 401 before opening a shell", async () => {
    mocks.getSession.mockResolvedValue(null);

    const response = await open(post({ cols: 80, rows: 24 }), context);

    expect(response.status).toBe(401);
    expect(mocks.containerShells.open).not.toHaveBeenCalled();
  });

  it("streams the shell with its session id, handing the request signal down", async () => {
    const request = post({ cols: 80, rows: 24 });

    const response = await open(request, context);

    expect(response.headers.get("x-terminal-id")).toBe("session-1");
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(await response.text()).toBe("/ # ");
    expect(mocks.containerShells.open).toHaveBeenCalledWith(
      { project: "alpha", containerId: CONTAINER_ID },
      { cols: 80, rows: 24 },
    );

    // The signal is what closes the session when the client disconnects.
    expect(mocks.terminals.open).toHaveBeenCalledWith("user-1", SHELL, request.signal);
  });

  it("returns 400 for a size out of bounds", async () => {
    await expect(open(post({ cols: 0, rows: 24 }), context)).resolves.toMatchObject({ status: 400 });
    expect(mocks.containerShells.open).not.toHaveBeenCalled();
  });

  it("returns 404 when the container is absent or belongs to another project", async () => {
    mocks.containerShells.open.mockRejectedValue(new DockerNotFoundError("test subject"));

    await expect(open(post({ cols: 80, rows: 24 }), context)).resolves.toMatchObject({ status: 404 });
  });
});

describe("POST the host terminal", () => {
  const hostShells = mocks.hostShells;

  beforeEach(() => {
    mocks.hostShells = hostShells;
    mocks.hostShells?.open.mockResolvedValue(SHELL);
    mocks.terminals.attach.mockResolvedValue({
      id: "session-1",
      output: Readable.from([Buffer.from("Connexion…")]),
      replayedBytes: 12,
    });
  });

  it("returns 401 before reaching the host", async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(openHost(post({ cols: 80, rows: 24 }))).resolves.toMatchObject({ status: 401 });
    expect(mocks.hostShells?.open).not.toHaveBeenCalled();
  });

  it("streams the user's session on the host, kept under the host's address", async () => {
    const request = post({ cols: 80, rows: 24 });

    const response = await openHost(request);

    expect(response.headers.get("x-terminal-id")).toBe("session-1");
    expect(response.headers.get("x-terminal-replay")).toBe("12");
    expect(await response.text()).toBe("Connexion…");
    expect(mocks.terminals.open).not.toHaveBeenCalled();
    expect(mocks.terminals.attach).toHaveBeenCalledWith(
      "user-1",
      "server.lan:22",
      { cols: 80, rows: 24 },
      expect.any(Function),
      request.signal,
      "Session taken over in another tab.",
    );
  });

  it("starts the shell the session needs at the client's size", async () => {
    await openHost(post({ cols: 80, rows: 24 }));

    const start = mocks.terminals.attach.mock.calls[0]![3] as () => Promise<unknown>;

    await expect(start()).resolves.toBe(SHELL);
    expect(mocks.hostShells?.open).toHaveBeenCalledWith({ cols: 80, rows: 24 }, TerminalMessages.en.shell);
  });

  it("returns 404 while no host is configured", async () => {
    mocks.hostShells = null;

    const response = await openHost(post({ cols: 80, rows: 24 }));

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { message: expect.stringContaining("HANGAR_SSH_HOST") } });
  });
});

describe("POST to a terminal session", () => {
  const context = { params: { terminal: "session-1" } };

  it("returns 401 before reaching the session", async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(send(post({ input: "ls\r" }), context)).resolves.toMatchObject({ status: 401 });
    expect(mocks.terminals.write).not.toHaveBeenCalled();
  });

  it("types the input as the signed-in user", async () => {
    const response = await send(post({ input: "ls\r" }), context);

    expect(response.status).toBe(204);
    expect(mocks.terminals.write).toHaveBeenCalledWith("session-1", "user-1", "ls\r");
  });

  it("resizes the session", async () => {
    await send(post({ cols: 120, rows: 40 }), context);

    expect(mocks.terminals.resize).toHaveBeenCalledWith("session-1", "user-1", { cols: 120, rows: 40 });
  });

  it("returns 400 for a message that is neither input nor size", async () => {
    await expect(send(post({ input: "" }), context)).resolves.toMatchObject({ status: 400 });
    await expect(send(post({ command: "ls" }), context)).resolves.toMatchObject({ status: 400 });
  });

  it("returns 404 once the session is gone", async () => {
    mocks.terminals.write.mockImplementation(() => {
      throw new TerminalNotFoundError("session-1");
    });

    await expect(send(post({ input: "ls\r" }), context)).resolves.toMatchObject({ status: 404 });
  });
});

describe("DELETE a terminal session", () => {
  const context = { params: { terminal: "session-1" } };
  const remove = () => new Request("http://localhost/terminal", { method: "DELETE" });

  it("returns 401 before reaching the session", async () => {
    mocks.getSession.mockResolvedValue(null);

    await expect(close(remove(), context)).resolves.toMatchObject({ status: 401 });
    expect(mocks.terminals.close).not.toHaveBeenCalled();
  });

  it("ends the session as the signed-in user", async () => {
    const response = await close(remove(), context);

    expect(response.status).toBe(204);
    expect(mocks.terminals.close).toHaveBeenCalledWith("session-1", "user-1");
  });

  it("returns 404 once the session is gone", async () => {
    mocks.terminals.close.mockRejectedValue(new TerminalNotFoundError("session-1"));

    await expect(close(remove(), context)).resolves.toMatchObject({ status: 404 });
  });
});
