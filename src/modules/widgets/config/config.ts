import * as z from "zod";
import type { WidgetBody } from "../shared/define-widget.tsx";

// What a widget descriptor is built from. No JSX: the CLI parses `hangar.yml` through the descriptors.

/** Grid columns a widget can be placed in. */
export type DashboardColumn = 1 | 2 | 3;

/** The column a declaration places its widget in. */
export const columnSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

/**
 * `url`: server-side address. `link`: what the browser opens. http(s) only: `frigate:5000` would otherwise parse as
 * scheme `frigate:`.
 */
const serviceUrl = z.url({ protocol: /^https?$/ });

const serviceUrlFields = { url: serviceUrl.optional(), link: serviceUrl.optional() };

/**
 * Freshness in seconds; absent = widget default. Not offered to the Docker widget, whose daemon keeps its data fresh,
 * nor to the clock, which ticks in the browser.
 */
export const ttlField = { ttl: z.int().positive().optional() };

/** The declarations a widget schema is built from. */
export class WidgetSchema {
  /** The declaration of a widget that reads nothing a store app serves: only where it sits. */
  static local<const Type extends string>(type: Type) {
    return z.object({ type: z.literal(type), column: columnSchema });
  }

  /** The declaration of a widget that reads a service: where it sits, where its service is, how fresh it stays. */
  static service<const Type extends string>(type: Type) {
    return z.object({ type: z.literal(type), column: columnSchema, ...serviceUrlFields, ...ttlField });
  }
}

/**
 * What every declaration may carry. A widget's schema picks the fields it offers; this is the shape the dashboard and
 * the image relay read without knowing which widget a declaration is for.
 */
export type WidgetDeclaration = {
  type: string;
  column: DashboardColumn;
  url?: string | undefined;
  link?: string | undefined;
  /** Freshness in seconds. */
  ttl?: number | undefined;
};

/** A widget's icon, as image URLs: a descriptor names it rather than renders it, so the CLI loads no JSX. */
export class WidgetIcon {
  /** Where Dashboard Icons serves its SVGs. */
  private static readonly DashboardIcons = "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg";

  readonly src: string;

  /** The variant drawn on a dark theme, for an icon the dark background would swallow. */
  readonly dark: string | undefined;

  constructor(src: string, dark?: string) {
    this.src = src;
    this.dark = dark;
  }

  /** An icon from Dashboard Icons by name, and the name of its dark-theme variant (`github-light`) if it needs one. */
  static dashboard(name: string, dark?: string): WidgetIcon {
    const url = (icon: string) => `${WidgetIcon.DashboardIcons}/${icon}.svg`;

    return new WidgetIcon(url(name), dark === undefined ? undefined : url(dark));
  }
}

/** What identifies a widget on its card, its skeleton and its error state. */
export type WidgetAppearance = {
  /** Display name, shown in the header, skeleton and error state. */
  title: string;
  icon: WidgetIcon;
  /** Size/layout classes for the card. */
  className?: string;
  /** Shown in the error state, after "<title> is unavailable". */
  errorDescription: string;
};

/**
 * One widget type, whole: what `hangar.yml` may declare, the app it reads, what its card looks like, and how to build
 * it. No JSX: `module` imports the components only when the dashboard first shows the widget, inside its own card.
 */
export type WidgetDescriptor<
  Schema extends z.ZodType<WidgetDeclaration> = z.ZodType<WidgetDeclaration>,
  Module = unknown,
> = {
  /** The declaration, discriminated by its literal `type`. */
  schema: Schema;
  /** The store app whose service the widget reads, which names its container and key. Absent when it reads none. */
  app?: string;
  /** What its card, skeleton and error state show, without its module loaded. */
  appearance: WidgetAppearance;
  // Methods rather than properties: their parameters are checked bivariantly, so every descriptor fits one list.
  /** The widget's code, imported on first use. */
  module(): Promise<Module>;
  /**
   * What one declaration loads and renders, from the imported module.
   * @param service The service the declaration points at, resolved when called; a widget that reads none never calls it
   */
  create(module: Module, config: z.infer<Schema>, service: () => WidgetService): WidgetBody;
  /** Fetches one image the widget shows but a browser cannot fetch itself. Absent for a widget that relays none. */
  relay?(service: WidgetService, id: string): Promise<Response>;
};

/** Types `create` against the descriptor's own schema and module. */
export const describeWidget = <Schema extends z.ZodType<WidgetDeclaration>, Module>(
  descriptor: WidgetDescriptor<Schema, Module>,
) => descriptor;

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
   * The service a declaration of `descriptor` points at. `link` defaults to `https://<container>.<domain>`, `api` to
   * `link`. The key is read lazily; an absent one means the service takes none.
   */
  static resolve(config: WidgetDeclaration, descriptor: WidgetDescriptor, host: WidgetHost): WidgetService {
    if (descriptor.app === undefined) {
      throw new Error(`The ${config.type} widget reads no service`);
    }

    const container = host.containerName(descriptor.app);
    const link = config.link ?? `https://${container}.${host.domain}`;

    return new WidgetService({ link, api: config.url ?? link, apiKey: () => host.secret(container) });
  }
}
