import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const { HostTerminal } = await import("./host-terminal.tsx");
const { HostTerminalSetup } = await import("./host-terminal-setup.tsx");

describe("HostTerminalSetup", () => {
  it("gives the variables naming the host, and how Docker reaches it", () => {
    const html = renderToStaticMarkup(<HostTerminalSetup />);

    expect(html).toContain("HANGAR_SSH_HOST=host.docker.internal");
    expect(html).toContain("HANGAR_SSH_USER=");
    expect(html).toContain("host.docker.internal:host-gateway");
  });
});

describe("HostTerminal", () => {
  it("leaves xterm out of the server render, which has no window", () => {
    const html = renderToStaticMarkup(<HostTerminal />);

    expect(html).toContain('aria-label="Terminal du serveur"');
    expect(html).not.toContain("xterm");
  });
});
