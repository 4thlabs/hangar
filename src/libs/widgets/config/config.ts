import * as z from "zod";

/**
 * The dashboard, as the store declares it in `hangar.yml`.
 *
 * Kept free of JSX on purpose: `HangarConfig` validates the `widgets:` section
 * at load, and that module is also imported by the CLI, which must not pull
 * React in to parse a YAML file. The components live in `registry.ts`.
 */

/** Grid columns a widget can be placed in. */
export type DashboardColumn = 1 | 2 | 3;

const columnSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

/** `owner/repo` — the only form the GitHub releases API takes. */
const repositorySchema = z.string().regex(/^[\w.-]+\/[\w.-]+$/, "must be owner/repo");

/**
 * The two addresses a widget backed by a self-hosted service has.
 *
 * `url` is where Hangar reaches it from the server — a container-network address,
 * so the dashboard does not leave the host to render. `link` is what the visitor
 * clicks, and is only needed for the rare stack whose Traefik router does not
 * follow the default `<container>.<DOMAIN>` rule.
 *
 * Both are pinned to http(s): `frigate:5000` parses as a perfectly valid URL —
 * scheme `frigate:`, path `5000` — and would sail through to ky as a base URL
 * nothing can be fetched from.
 */
const serviceUrl = z.url({ protocol: /^https?$/ });

const serviceUrlFields = { url: serviceUrl.optional(), link: serviceUrl.optional() };

/**
 * How long this widget's data stays fresh, in seconds.
 *
 * Seconds because that is what an operator writes; the widget layer works in milliseconds and
 * converts once, in `registry.ts`. Absent means the widget layer's own default. Not offered to the
 * clock, which loads nothing, so there is nothing for a TTL to hold.
 */
const ttlField = { ttl: z.int().positive().optional() };

export const widgetConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("clock"), column: columnSchema }),
  z.object({ type: z.literal("docker-general-stats"), column: columnSchema, ...ttlField }),
  z.object({ type: z.literal("arcane-general-stats"), column: columnSchema, ...serviceUrlFields, ...ttlField }),
  z.object({ type: z.literal("backrest-summary"), column: columnSchema, ...serviceUrlFields, ...ttlField }),
  z.object({ type: z.literal("frigate-events"), column: columnSchema, ...serviceUrlFields, ...ttlField }),
  z.object({ type: z.literal("gluetun-vpn-status"), column: columnSchema, ...serviceUrlFields, ...ttlField }),
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

/** Everything a widget needs to talk to its service, and to link to it. */
export type WidgetService = {
  /** Where Hangar calls from the server. */
  api: string;
  /** Where the visitor's browser goes. */
  link: string;
  /** The service's key, if the operator set one. Looked up only by the widgets that need it. */
  apiKey: () => Promise<string | undefined>;
};

/**
 * How a service widget reaches its service.
 *
 * The link is the rule Traefik applies to a stack that only says
 * `traefik.enable=true` — `<container>.<DOMAIN>` — unless `hangar.yml` overrides
 * it. The API calls the container directly when `url:` is declared, and otherwise
 * goes back out through the public host, which is what every widget did before
 * the two were told apart.
 *
 * The key is whatever `.env.global` holds under the container's name, and is
 * read lazily: it is the operator's to provide, so an absent one is a service
 * that takes no key, not a misconfiguration to report.
 */
export function widgetService(
  config: { url?: string | undefined; link?: string | undefined },
  containerName: string,
  domain: string,
  secret: (container: string) => Promise<string | undefined>,
): WidgetService {
  const link = config.link ?? `https://${containerName}.${domain}`;

  return { link, api: config.url ?? link, apiKey: () => secret(containerName) };
}

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

/** `frigate-events` → the `frigate` app: a widget type is prefixed by the app it reads. */
export const appOf = (type: string) => type.split("-")[0]!;

/**
 * The service a widget declaration points at, resolved against the host.
 *
 * Only some members of the union carry URLs — a clock addresses nothing — so the narrowing is
 * what keeps `widgetService` honest about the two it may be handed.
 */
export const serviceOf = (config: WidgetConfig, host: WidgetHost): WidgetService =>
  widgetService(
    "url" in config ? { url: config.url, link: config.link } : {},
    host.containerName(appOf(config.type)),
    host.domain,
    host.secret,
  );

/**
 * The dashboard a store gets when its `hangar.yml` declares no `widgets:`.
 * An existing install keeps the dashboard it had before the section existed.
 */
export const defaultWidgets: readonly WidgetConfig[] = [
  { type: "clock", column: 1 },
  { type: "docker-general-stats", column: 1 },
  { type: "frigate-events", column: 3 },
];
