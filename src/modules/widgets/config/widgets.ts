import * as z from "zod";
import { arcaneGeneralStatsDescriptor } from "../arcane/descriptor.ts";
import { backrestSummaryDescriptor } from "../backrest/descriptor.ts";
import { beszelServerStatsDescriptor } from "../beszel/descriptor.ts";
import { clockDescriptor } from "../clock/descriptor.ts";
import { dockerGeneralStatsDescriptor } from "../docker/descriptor.ts";
import { frigateEventsDescriptor } from "../frigate/descriptor.ts";
import { githubReleasesDescriptor } from "../github/descriptor.ts";
import { gluetunVpnStatusDescriptor } from "../gluetun/descriptor.ts";
import { jellyfinLatestDescriptor } from "../jellyfin/descriptor.ts";
import { minifluxEntriesDescriptor } from "../miniflux/descriptor.ts";
import type { WidgetDescriptor } from "./config.ts";

// The `widgets:` section of `hangar.yml`, derived from the descriptors. No JSX: the CLI imports this. Adding a widget
// means writing its `descriptor.ts` and listing it here.

/** Every widget type a store can place. */
const descriptors = [
  clockDescriptor,
  dockerGeneralStatsDescriptor,
  arcaneGeneralStatsDescriptor,
  backrestSummaryDescriptor,
  beszelServerStatsDescriptor,
  frigateEventsDescriptor,
  gluetunVpnStatusDescriptor,
  minifluxEntriesDescriptor,
  jellyfinLatestDescriptor,
  githubReleasesDescriptor,
] as const;

/** The schema of each descriptor, kept a tuple: `discriminatedUnion` wants one. */
type SchemasOf<Descriptors extends readonly WidgetDescriptor[]> = {
  -readonly [Index in keyof Descriptors]: Descriptors[Index]["schema"];
};

export const widgetConfigSchema = z.discriminatedUnion(
  "type",
  // `map` loses the tuple type, not the order.
  descriptors.map(descriptor => descriptor.schema) as SchemasOf<typeof descriptors>,
);

export type WidgetConfig = z.infer<typeof widgetConfigSchema>;

/** Finds the descriptor of a declaration. */
export class WidgetDescriptors {
  /** The descriptors, by the type their schema declares. */
  private static readonly ByType: ReadonlyMap<string, WidgetDescriptor> = new Map(
    descriptors.map(descriptor => [descriptor.schema.shape.type.value, descriptor]),
  );

  /** The descriptor of a parsed declaration's type, which the schema has already checked. */
  static get(type: WidgetConfig["type"]): WidgetDescriptor {
    return WidgetDescriptors.ByType.get(type)!;
  }
}

/**
 * Identifies a placed widget (cache entry, React key, image relay path). `<type>-<hash>` over everything but `column`,
 * so moving a card keeps its cached data; duplicates get `-2`, `-3`.
 */
export class WidgetKey {
  /** The key of every declaration, in the same order. */
  static all(configs: readonly WidgetConfig[]): string[] {
    const seen = new Map<string, number>();

    return configs.map(config => {
      const key = `${config.type}-${WidgetKey.hash(config)}`;
      const count = (seen.get(key) ?? 0) + 1;

      seen.set(key, count);

      return count === 1 ? key : `${key}-${count}`;
    });
  }

  /** The declaration a key names, or `undefined` when the store places nothing under it. */
  static find(configs: readonly WidgetConfig[], key: string): WidgetConfig | undefined {
    const index = WidgetKey.all(configs).indexOf(key);

    return index === -1 ? undefined : configs[index];
  }

  /**
   * FNV-1a over the declaration without its column, in base 36. Keys are sorted first, so the order
   * the operator wrote the fields in does not matter; array order does, as it does on the card.
   */
  private static hash({ column: _column, ...declaration }: WidgetConfig) {
    const text = JSON.stringify(declaration, (_key, value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
        : value,
    );

    let hash = 0x811c9dc5;

    for (const char of text) {
      hash ^= char.codePointAt(0)!;
      hash = Math.imul(hash, 0x01000193);
    }

    return (hash >>> 0).toString(36);
  }
}

/** The dashboard of a store whose `hangar.yml` declares no `widgets:`. */
export const defaultWidgets: readonly WidgetConfig[] = [
  { type: "clock", column: 1 },
  { type: "docker-general-stats", column: 1 },
  { type: "frigate-events", column: 3 },
];
