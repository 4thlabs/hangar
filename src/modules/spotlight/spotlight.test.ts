import { describe, expect, it, vi } from "vitest";
import { Spotlight, type SpotlightItem, type SpotlightSource } from "./spotlight.ts";

const source = (id: string, prefix: string): SpotlightSource => ({
  id,
  label: () => id,
  prefix,
  shortcut: { key: id[0]!, alt: true },
  load: async () => [],
});

const item = (label: string, keywords?: string[]): SpotlightItem => ({
  id: label,
  label,
  ...(keywords && { keywords }),
  actions: { enter: { kind: "navigate", label: "Voir", to: `/apps/${label}` } },
});

const keyEvent = (key: string, modifiers: Partial<KeyboardEvent> = {}) => ({
  key,
  code: `Key${key.toUpperCase()}`,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

describe("Spotlight.parse", () => {
  const sources = [source("apps", "@"), source("pages", "/")];

  it("narrows to the source whose prefix starts the input, and drops the prefix", () => {
    const { scope, query } = Spotlight.parse("@ jelly", sources);

    expect(scope?.id).toBe("apps");
    expect(query).toBe("jelly");
  });

  it("searches every source when no prefix leads", () => {
    expect(Spotlight.parse("jelly@", sources)).toEqual({ scope: null, query: "jelly@" });
  });
});

describe("Spotlight.matches", () => {
  it("reads mod as ⌘ on Apple devices and as Ctrl elsewhere", () => {
    expect(Spotlight.matches(Spotlight.Shortcut, keyEvent("k", { metaKey: true }), "apple", null)).toBe(true);
    expect(Spotlight.matches(Spotlight.Shortcut, keyEvent("k", { ctrlKey: true }), "apple", null)).toBe(false);
    expect(Spotlight.matches(Spotlight.Shortcut, keyEvent("k", { ctrlKey: true }), "other", null)).toBe(true);
  });

  it("refuses an extra modifier", () => {
    expect(Spotlight.matches(Spotlight.Shortcut, keyEvent("k", { ctrlKey: true, shiftKey: true }), "other", null)).toBe(
      false,
    );
  });

  it("accepts the physical key when ⌥ changed the character on an Apple keyboard", () => {
    const optionA = { ...keyEvent("å", { altKey: true }), code: "KeyA" };

    expect(Spotlight.matches({ key: "a", alt: true }, optionA, "apple", null)).toBe(true);
  });

  it("reads the physical key through the layout: on an AZERTY Mac, ⌥ and the A key is ⌥A", () => {
    const azerty = new Map([
      ["KeyQ", "a"],
      ["KeyA", "q"],
    ]);

    const optionA = { ...keyEvent("æ", { altKey: true }), code: "KeyQ" };
    const optionQ = { ...keyEvent("‡", { altKey: true }), code: "KeyA" };

    expect(Spotlight.matches({ key: "a", alt: true }, optionA, "apple", azerty)).toBe(true);
    expect(Spotlight.matches({ key: "a", alt: true }, optionQ, "apple", azerty)).toBe(false);
  });

  it("reads the character, not the physical key, elsewhere: Alt+Q on AZERTY is not Alt+A", () => {
    const azertyAltQ = { ...keyEvent("q", { altKey: true }), code: "KeyA" };
    const azertyAltA = { ...keyEvent("a", { altKey: true }), code: "KeyQ" };

    expect(Spotlight.matches({ key: "a", alt: true }, azertyAltQ, "other", null)).toBe(false);
    expect(Spotlight.matches({ key: "a", alt: true }, azertyAltA, "other", null)).toBe(true);
  });
});

describe("Spotlight.typesText", () => {
  it("flags ⌥ and a letter on an Apple keyboard, which types a character", () => {
    expect(Spotlight.typesText({ key: "a", alt: true }, "apple")).toBe(true);
    expect(Spotlight.typesText({ key: "a", alt: true }, "other")).toBe(false);
    expect(Spotlight.typesText(Spotlight.Shortcut, "apple")).toBe(false);
  });
});

describe("Spotlight.label", () => {
  it("spells a shortcut the way the platform does", () => {
    expect(Spotlight.label({ key: "a", mod: true, shift: true }, "apple")).toBe("⌘⇧A");
    expect(Spotlight.label({ key: "a", mod: true, shift: true }, "other")).toBe("Ctrl+Shift+A");
  });
});

describe("Spotlight.filter", () => {
  const items = [item("Jellyfin"), item("Vaultwarden", ["bitwarden"]), item("Immich")];

  it("keeps every item, in order, for an empty query", () => {
    expect(Spotlight.filter("", items).map(result => result.label)).toEqual(["Jellyfin", "Vaultwarden", "Immich"]);
  });

  it("matches on keywords as well as on the label", () => {
    expect(Spotlight.filter("bitw", items).map(result => result.label)).toEqual(["Vaultwarden"]);
  });
});

describe("Spotlight.actionKey", () => {
  it("reads ⌘ as mod on Apple devices, with Shift as modShift, and Shift alone as plain Enter", () => {
    expect(Spotlight.actionKey(keyEvent("Enter"), "apple")).toBe("enter");
    expect(Spotlight.actionKey(keyEvent("Enter", { shiftKey: true }), "apple")).toBe("enter");
    expect(Spotlight.actionKey(keyEvent("Enter", { metaKey: true }), "apple")).toBe("mod");
    expect(Spotlight.actionKey(keyEvent("Enter", { metaKey: true, shiftKey: true }), "apple")).toBe("modShift");
  });

  it("leaves Ctrl alone on Apple devices, and reads it as mod elsewhere", () => {
    expect(Spotlight.actionKey(keyEvent("Enter", { ctrlKey: true, shiftKey: true }), "apple")).toBe("enter");
    expect(Spotlight.actionKey(keyEvent("Enter", { ctrlKey: true, shiftKey: true }), "other")).toBe("modShift");
    expect(Spotlight.actionKey(keyEvent("Enter", { metaKey: true }), "other")).toBe("enter");
  });
});

describe("Spotlight.action", () => {
  const page = { kind: "navigate", label: "Voir la page", to: "/apps/jellyfin" } as const;
  const open = { kind: "open", label: "Ouvrir", url: "https://jellyfin.example.com" } as const;
  const edit = { kind: "navigate", label: "Modifier", to: "/store/jellyfin/edit" } as const;

  it("picks the action of the key", () => {
    const routed: SpotlightItem = { id: "a", label: "A", actions: { enter: open, mod: page, modShift: edit } };

    expect(Spotlight.action(routed, "enter")).toBe(open);
    expect(Spotlight.action(routed, "mod")).toBe(page);
    expect(Spotlight.action(routed, "modShift")).toBe(edit);
  });

  it("falls back to Enter's action for a key the item leaves out", () => {
    const unrouted: SpotlightItem = { id: "b", label: "B", actions: { enter: page, modShift: edit } };

    expect(Spotlight.action(unrouted, "mod")).toBe(page);
    expect(Spotlight.action(item("Pages"), "modShift")).toEqual(item("Pages").actions.enter);
  });
});

describe("Spotlight.perform", () => {
  it("navigates inside Hangar, or opens a URL", () => {
    const navigator = { push: vi.fn(), open: vi.fn() };

    Spotlight.perform({ kind: "navigate", label: "Voir", to: "/apps/jellyfin" }, navigator);
    Spotlight.perform({ kind: "open", label: "Ouvrir", url: "https://jellyfin.example.com" }, navigator);

    expect(navigator.push).toHaveBeenCalledWith("/apps/jellyfin");
    expect(navigator.open).toHaveBeenCalledWith("https://jellyfin.example.com");
  });
});
