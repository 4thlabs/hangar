import fuzzysort from "fuzzysort";
import type { LucideIcon } from "lucide-react";
import type { Unstable_RouteHref } from "waku/router/client";

/**
 * What picking a result does. Data rather than a callback, so a source can send it from a server
 * action as it is; only the palette carries it out, in {@link Spotlight.perform}.
 */
export type SpotlightAction =
  { kind: "navigate"; label: string; to: Unstable_RouteHref } | { kind: "open"; label: string; url: string };

/** The keys that pick an item's action: Enter alone, with Ctrl/⌘, with Ctrl/⌘ and Shift. */
export type SpotlightActionKey = "enter" | "mod" | "modShift";

/** What each key does on an item. A key with no action of its own does what Enter does. */
export type SpotlightItemActions = { enter: SpotlightAction } & Partial<Record<SpotlightActionKey, SpotlightAction>>;

/** One result of a source. */
export type SpotlightItem = {
  id: string;
  label: string;
  /** Matched along with the label, e.g. an app's id when its display name differs. */
  keywords?: string[];
  /** An image URL, or a lucide icon for a source that runs in the browser. */
  icon?: string | LucideIcon | undefined;
  actions: SpotlightItemActions;
};

/** A key combination. `mod` is ⌘ on Apple devices and Ctrl elsewhere. */
export type SpotlightShortcut = {
  /** `KeyboardEvent.key`, lowercase. */
  key: string;
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
};

/** Where results come from. Each one can be searched alone, by its shortcut or its prefix. */
export type SpotlightSource = {
  id: string;
  /** The heading of its group of results. */
  label: string;
  /** Typed first in the field, it narrows the search to this source. */
  prefix: string;
  /** Opens the palette narrowed to this source. */
  shortcut: SpotlightShortcut;
  /** Called each time the palette opens. */
  load: () => Promise<SpotlightItem[]>;
};

/** The keys a shortcut is spelled with, and the one `mod` stands for. */
export type SpotlightPlatform = "apple" | "other";

/**
 * The character each physical key types on the active layout, by `KeyboardEvent.code`: what
 * `navigator.keyboard.getLayoutMap()` resolves to. Chromium only, and absent from TypeScript's DOM types.
 */
export type SpotlightKeyboardLayout = { get: (code: string) => string | undefined };

type SpotlightKeyEvent = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

/** A key press or a click, as far as picking an action goes. */
type SpotlightPickEvent = Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "shiftKey">;

declare global {
  interface Navigator {
    /** The Keyboard API: no `@types` package carries it, and TypeScript's DOM types only hold what two engines ship. */
    readonly keyboard?: { getLayoutMap: () => Promise<SpotlightKeyboardLayout> };
  }
}

type SpotlightNavigator = {
  push: (to: Unstable_RouteHref) => void;
  open: (url: string) => void;
};

/** The palette's rules, kept apart from its component so they can be tested without a DOM. */
export class Spotlight {
  /** Opens the palette on every source. */
  static readonly Shortcut: SpotlightShortcut = { key: "k", mod: true };

  /** The keys that pick an action, in the order the footer lists them, each as the platform spells it. */
  static readonly ActionKeys: readonly { name: SpotlightActionKey; shortcut: SpotlightShortcut }[] = [
    { name: "enter", shortcut: { key: "↵" } },
    { name: "mod", shortcut: { key: "↵", mod: true } },
    { name: "modShift", shortcut: { key: "↵", mod: true, shift: true } },
  ];

  private static readonly AppleUserAgent = /Mac|iPhone|iPad|iPod/;

  private static readonly TextFields = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

  private static readonly Symbols: Record<SpotlightPlatform, { mod: string; shift: string; alt: string }> = {
    apple: { mod: "⌘", shift: "⇧", alt: "⌥" },
    other: { mod: "Ctrl+", shift: "Shift+", alt: "Alt+" },
  };

  static platform(userAgent: string): SpotlightPlatform {
    return Spotlight.AppleUserAgent.test(userAgent) ? "apple" : "other";
  }

  /** The source a leading prefix in `input` names, and what is left to search for. */
  static parse(input: string, sources: readonly SpotlightSource[]) {
    const scope = sources.find(source => input.startsWith(source.prefix)) ?? null;
    const query = scope ? input.slice(scope.prefix.length) : input;

    return { scope, query: query.trim() };
  }

  /** The active keyboard layout, or `null` in a browser that does not tell it. */
  static async layout(navigator: Navigator): Promise<SpotlightKeyboardLayout | null> {
    return (await navigator.keyboard?.getLayoutMap()) ?? null;
  }

  /** Whether `event` is `shortcut`. */
  static matches(
    shortcut: SpotlightShortcut,
    event: SpotlightKeyEvent,
    platform: SpotlightPlatform,
    layout: SpotlightKeyboardLayout | null,
  ) {
    const mod = platform === "apple" ? event.metaKey : event.ctrlKey;
    const other = platform === "apple" ? event.ctrlKey : event.metaKey;

    const sameModifiers =
      mod === Boolean(shortcut.mod) &&
      !other &&
      event.shiftKey === Boolean(shortcut.shift) &&
      event.altKey === Boolean(shortcut.alt);

    const sameCharacter = event.key.toLowerCase() === shortcut.key;

    // On an Apple keyboard ⌥ turns a letter into another character (⌥A types `å`), so there the physical key stands
    // in for it, read through the layout. Without one, `code` names the key after its QWERTY letter.
    const physicalCharacter = layout ? layout.get(event.code) : event.code.replace(/^Key/, "").toLowerCase();
    const samePhysicalKey = platform === "apple" && event.altKey && physicalCharacter === shortcut.key;

    return sameModifiers && (sameCharacter || samePhysicalKey);
  }

  /**
   * Whether `shortcut` is also how the platform types a character: ⌥ and a letter, on an Apple keyboard. In a text
   * field such a shortcut leaves the key to the field, or `å` and `π` could not be typed anywhere in Hangar.
   */
  static typesText(shortcut: SpotlightShortcut, platform: SpotlightPlatform) {
    return platform === "apple" && Boolean(shortcut.alt) && !shortcut.mod;
  }

  /** Whether `target` takes typed text: a field, or a contenteditable such as the compose editor. */
  static isTextField(target: EventTarget | null) {
    return target instanceof Element && target.closest(Spotlight.TextFields) !== null;
  }

  /** `shortcut` as the platform writes it: `⌘⇧K`, `Ctrl+Shift+K`. */
  static label(shortcut: SpotlightShortcut, platform: SpotlightPlatform) {
    const symbols = Spotlight.Symbols[platform];

    const modifiers = [
      shortcut.mod ? symbols.mod : "",
      shortcut.shift ? symbols.shift : "",
      shortcut.alt ? symbols.alt : "",
    ];

    return `${modifiers.join("")}${shortcut.key.toUpperCase()}`;
  }

  /** `items` by relevance to `query`, on the label and the keywords; all of them, in order, for no query. */
  static filter(query: string, items: readonly SpotlightItem[]): SpotlightItem[] {
    if (!query) {
      return [...items];
    }

    const keys = ["label", (item: SpotlightItem) => item.keywords?.join(" ") ?? ""];

    return fuzzysort.go(query, items, { keys, limit: 0, threshold: 0 }).map(result => result.obj);
  }

  /**
   * The key a press or a click stands for: `mod` is ⌘ on Apple devices and Ctrl elsewhere, as for the shortcuts (on
   * a Mac, Ctrl+click is a right click). Shift counts only with it; any other combination is plain Enter.
   */
  static actionKey(event: SpotlightPickEvent, platform: SpotlightPlatform): SpotlightActionKey {
    const mod = platform === "apple" ? event.metaKey : event.ctrlKey;

    if (!mod) {
      return "enter";
    }

    return event.shiftKey ? "modShift" : "mod";
  }

  /** What `key` picks on `item`: its own action, or Enter's. */
  static action(item: SpotlightItem, key: SpotlightActionKey) {
    return item.actions[key] ?? item.actions.enter;
  }

  /** Carries out `action`. */
  static perform(action: SpotlightAction, navigator: SpotlightNavigator) {
    if (action.kind === "navigate") {
      navigator.push(action.to);

      return;
    }

    navigator.open(action.url);
  }
}
