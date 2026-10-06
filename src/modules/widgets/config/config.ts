import * as z from "zod";

// The `widgets:` section of `hangar.yml`. No JSX: the CLI imports this; the components live in `registry.ts`.

/** Grid columns a widget can be placed in. */
export type DashboardColumn = 1 | 2 | 3;

const columnSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

/** `owner/repo` — the only form the GitHub releases API takes. */
const repositorySchema = z.string().regex(/^[\w.-]+\/[\w.-]+$/, "must be owner/repo");

/**
 * `url`: server-side address. `link`: what the browser opens. http(s) only: `frigate:5000` would otherwise parse as
 * scheme `frigate:`.
 */
const serviceUrl = z.url({ protocol: /^https?$/ });

const serviceUrlFields = { url: serviceUrl.optional(), link: serviceUrl.optional() };

/** Freshness in seconds; absent = widget default. Not offered to the clock and Docker widgets, which cache nothing. */
const ttlField = { ttl: z.int().positive().optional() };

export const widgetConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("clock"), column: columnSchema }),
  z.object({ type: z.literal("docker-general-stats"), column: columnSchema }),
  z.object({ type: z.literal("arcane-general-stats"), column: columnSchema, ...serviceUrlFields, ...ttlField }),
  z.object({ type: z.literal("backrest-summary"), column: columnSchema, ...serviceUrlFields, ...ttlField }),
  z.object({ type: z.literal("beszel-server-stats"), column: columnSchema, ...serviceUrlFields, ...ttlField }),
  z.object({ type: z.literal("frigate-events"), column: columnSchema, ...serviceUrlFields, ...ttlField }),
  z.object({ type: z.literal("gluetun-vpn-status"), column: columnSchema, ...serviceUrlFields, ...ttlField }),
  z.object({ type: z.literal("miniflux-entries"), column: columnSchema, ...serviceUrlFields, ...ttlField }),
  z.object({
    type: z.literal("jellyfin-latest"),
    column: columnSchema,
    ...serviceUrlFields,
    ...ttlField,
    /** Jellyfin scopes "latest" to a user, so there is no server-wide answer to ask for. */
    user: z.string().min(1),
  }),
  z.object({
    type: z.literal("github-releases"),
    column: columnSchema,
    ...ttlField,
    repositories: z.array(repositorySchema).min(1),
  }),
]);

export type WidgetConfig = z.infer<typeof widgetConfigSchema>;

/**
 * What resolving a widget's service needs to know, passed in rather than read here: reaching for
 * `#libs/hangar` would drag SQLite and Docker into the RSC graph the registry sits in.
 */
export type WidgetHost = {
  domain: string;
  /** The container a store app runs under, which names both its public host and its key. */
  containerName: (app: string) => string;
  /** The container's API key, as the store's global env spells it. */
  secret: (container: string) => Promise<string | undefined>;
};

/** Everything a widget needs to talk to its service, and to link to it. */
export class WidgetService {
  /** Where Hangar calls from the server. */
  readonly api: string;

  /** Where the visitor's browser goes. */
  readonly link: string;

  /** The service's key, if the operator set one. Looked up only by the widgets that need it. */
  readonly apiKey: () => Promise<string | undefined>;

  constructor({ api, link, apiKey }: Pick<WidgetService, "api" | "link" | "apiKey">) {
    this.api = api;
    this.link = link;
    this.apiKey = apiKey;
  }

  /**
   * `link` defaults to `https://<container>.<domain>`, `api` to `link`. The key is read lazily; an absent one means
   * the service takes none.
   */
  static resolve(
    config: { url?: string | undefined; link?: string | undefined },
    containerName: string,
    domain: string,
    secret: (container: string) => Promise<string | undefined>,
  ): WidgetService {
    const link = config.link ?? `https://${containerName}.${domain}`;

    return new WidgetService({ link, api: config.url ?? link, apiKey: () => secret(containerName) });
  }

  /** The service a declaration points at; a type without `url` (a clock) gets the defaults. */
  static of(config: WidgetConfig, host: WidgetHost): WidgetService {
    return WidgetService.resolve(
      "url" in config ? { url: config.url, link: config.link } : {},
      host.containerName(WidgetService.appOf(config.type)),
      host.domain,
      host.secret,
    );
  }

  /** `frigate-events` → the `frigate` app: a widget type is prefixed by the app it reads. */
  static appOf(type: string) {
    return type.split("-")[0]!;
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
