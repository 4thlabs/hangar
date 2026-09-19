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

export const widgetConfigSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("clock"), column: columnSchema }),
  z.object({ type: z.literal("docker-general-stats"), column: columnSchema }),
  z.object({ type: z.literal("arcane-general-stats"), column: columnSchema, ...serviceUrlFields }),
  z.object({ type: z.literal("frigate-events"), column: columnSchema, ...serviceUrlFields }),
  z.object({
    type: z.literal("github-releases"),
    column: columnSchema,
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
 * The dashboard a store gets when its `hangar.yml` declares no `widgets:`.
 * An existing install keeps the dashboard it had before the section existed.
 */
export const defaultWidgets: readonly WidgetConfig[] = [
  { type: "clock", column: 1 },
  { type: "docker-general-stats", column: 1 },
  { type: "frigate-events", column: 3 },
];
