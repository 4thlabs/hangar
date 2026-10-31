import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The setup is a server component: it reads the request's language through `#libs/i18n/server`.
vi.mock("server-only", () => ({}));

const { HostTerminal } = await import("./host-terminal.tsx");
const { HostTerminalSetup } = await import("./host-terminal-setup.tsx");

describe("HostTerminalSetup", () => {
  it("gives the variables naming the host, and how Docker reaches it", () => {
    const html = renderToStaticMarkup(<HostTerminalSetup />);

    expect(html).toContain("HANGAR_SSH_HOST=host.docker.internal");
    expect(html).toContain("HANGAR_SSH_USER=your-user");
    expect(html).toContain("host.docker.internal:host-gateway");
  });
});

describe("HostTerminal", () => {
  it("leaves xterm out of the server render, which has no window", () => {
    const html = renderToStaticMarkup(<HostTerminal />);

    expect(html).toContain('aria-label="The server&#x27;s terminal"');
    expect(html).not.toContain("xterm");
  });
});
