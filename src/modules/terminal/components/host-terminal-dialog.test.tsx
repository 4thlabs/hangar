// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HostTerminalDialog } from "./host-terminal-dialog.tsx";

// Tells React the updates below are wrapped in `act`.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/** Stands in for the terminal: counts its mounts and unmounts, as the shell's lifetime follows them. */
const lifetime = { mounts: 0, unmounts: 0 };

function TerminalProbe() {
  useEffect(() => {
    lifetime.mounts += 1;

    return () => {
      lifetime.unmounts += 1;
    };
  }, []);

  return <p data-testid="terminal-probe">shell</p>;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  lifetime.mounts = 0;
  lifetime.unmounts = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root.render(
      <HostTerminalDialog description="Un shell sur server.lan" sshKey={null}>
        <TerminalProbe />
      </HostTerminalDialog>,
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const probe = () => document.querySelector('[data-testid="terminal-probe"]');

async function click(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) {
    throw new Error("Nothing to click");
  }

  await act(async () => element.click());
}

const openButton = () => document.querySelector('button[aria-label="Terminal"]');

const closeButton = () =>
  [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent === "Close");

describe("HostTerminalDialog", () => {
  it("renders the navbar's button, and no terminal before the first opening", () => {
    expect(openButton()).not.toBeNull();
    expect(probe()).toBeNull();
    expect(lifetime.mounts).toBe(0);
  });

  it("mounts the terminal at the first opening", async () => {
    await click(openButton());

    expect(probe()).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Un shell sur server.lan");
    expect(lifetime.mounts).toBe(1);
  });

  it("keeps the terminal mounted once closed, and finds the same one on reopening", async () => {
    await click(openButton());
    await click(closeButton());

    expect(document.querySelector('[role="dialog"]')?.hasAttribute("hidden")).toBe(true);
    expect(probe()).not.toBeNull();
    expect(lifetime.unmounts).toBe(0);

    await click(openButton());

    expect(document.querySelector('[role="dialog"]')?.hasAttribute("hidden")).toBe(false);
    expect(lifetime).toEqual({ mounts: 1, unmounts: 0 });
  });

  it("opens and closes on Ctrl+J, mounting the terminal once", async () => {
    const pressCtrlJ = () =>
      act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", code: "KeyJ", ctrlKey: true, cancelable: true }));
      });

    await pressCtrlJ();

    expect(document.querySelector('[role="dialog"]')?.hasAttribute("hidden")).toBe(false);
    expect(probe()).not.toBeNull();

    await pressCtrlJ();

    expect(document.querySelector('[role="dialog"]')?.hasAttribute("hidden")).toBe(true);
    expect(lifetime).toEqual({ mounts: 1, unmounts: 0 });
  });
});
