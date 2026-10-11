import { readFile, writeFile } from "node:fs/promises";
import { load } from "js-yaml";
import * as z from "zod";
import { logger } from "#libs/logs";
import { defaultWidgets, widgetConfigSchema, type WidgetConfig } from "#modules/widgets/config/widgets.ts";
import { HangarError } from "./hangar-error.ts";

/** A `stacks` entry in its long form: the app, and what the CLI and the nightly job do with it */
const stackEntryObjectSchema = z.strictObject({
  id: z.string().min(1),
  /** Whether `store up` starts it with the others */
  run: z.boolean().default(true),
  /** Whether the nightly job updates it */
  update: z.boolean().default(true),
});

/** A `stacks` entry: an app id, short for `{ id }` with every default, or the long form. */
const stackEntrySchema = z.preprocess(
  entry => (typeof entry === "string" ? { id: entry } : entry),
  stackEntryObjectSchema,
);

/** A Stack category: how the Apps page groups the compose apps, and the order `store up` starts them in */
const categorySchema = z.object({
  name: z.string().min(1),
  color: z.string().min(1),
  stacks: z.array(stackEntrySchema),
});

const configSchema = z.object({
  categories: z.array(categorySchema),
  /** The apps `swarm deploy` runs in the swarm, in deploy order; independent of the categories */
  swarm: z.array(z.string().min(1)).default([]),
  /** No longer read: an app is a folder holding a compose file, so a shared fragment needs no listing */
  shared: z.array(z.string().min(1)).optional(),
  /** The dashboard: which widgets are shown, in which column */
  widgets: z.array(widgetConfigSchema).default([...defaultWidgets]),
  /** Pause between two registry calls in the image update check, in ms: Hub and ghcr rate-limit a burst */
  registryThrottling: z.int().nonnegative().default(100),
});

export type StackEntry = z.infer<typeof stackEntryObjectSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Config = z.infer<typeof configSchema>;

/**
 * The `hangar.yml` a store ships. Empty until the store is cloned (a fresh install, or the Waku
 * build, which has no data directory).
 */
export class HangarConfig {
  /** The config file */
  private readonly _configFile: string;

  /** The categories for the various stacks */
  private _categories: Category[] = [];

  /** The apps `swarm deploy` runs in the swarm, in deploy order */
  private _swarm: string[] = [];

  /** Whether the file still lists `shared:` files, which are no longer read */
  private _listsShared = false;

  /** The widgets the dashboard shows, in declaration order */
  private _widgets: WidgetConfig[] = [...defaultWidgets];

  /** The pause between two registry calls in the image update check, in ms */
  private _registryThrottling = 100;

  /** Returns the categories */
  public categories = () => this._categories;

  /** Returns the apps `swarm deploy` runs, in deploy order */
  public swarm = () => this._swarm;

  /** Whether the file still lists `shared:` files, which are no longer read */
  public listsShared = () => this._listsShared;

  /** Returns the dashboard widgets */
  public widgets = () => this._widgets;

  /** Returns the pause between two registry calls, in ms */
  public registryThrottling = () => this._registryThrottling;

  /**
   * The entries of every category, or of one, in start order. An app declared twice keeps its first
   * entry, as the Apps page files it under its first category.
   * @param category The category to cover, every one when absent
   */
  entries(category?: string): StackEntry[] {
    const covered = this._categories.filter(candidate => category === undefined || candidate.name === category);
    const firstEntries = new Map<string, StackEntry>();

    for (const entry of covered.flatMap(candidate => candidate.stacks)) {
      if (!firstEntries.has(entry.id)) {
        firstEntries.set(entry.id, entry);
      }
    }

    return [...firstEntries.values()];
  }

  /** The first entry declaring the app, `undefined` when no category lists it. */
  entry(id: string): StackEntry | undefined {
    return this.entries().find(entry => entry.id === id);
  }

  /**
   * Does not read the file: call `load()` once the store is on disk.
   * @param file The path to the configuration file
   */
  constructor(file: string) {
    this._configFile = file;
  }

  /**
   * Loads the configuration from the configuration file.
   * @returns HangarConfig instance with the loaded configuration
   */
  async load() {
    const source = await this.read();

    // A store without a hangar.yml is a store without categories, not a
    // failure: it still installs, its apps are just left ungrouped.
    if (source === undefined) {
      logger.warn(`No Hangar config at ${this._configFile}: the store declares no categories`);
    }

    this.apply(source === undefined ? configSchema.parse({ categories: [] }) : this.parse(source));

    return this;
  }

  /** The raw file, `""` when the store ships none. */
  async source() {
    return (await this.read()) ?? "";
  }

  /** The raw file, `undefined` when the store ships none. */
  private read() {
    return readFile(this._configFile, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return undefined;
      }

      // An unreadable config is an operator error, not a defect: report the
      // path, not a filesystem stack trace.
      throw new HangarError(`Cannot read the Hangar config at ${this._configFile}: ${error.code ?? error.message}`);
    });
  }

  /**
   * Validates then writes the configuration: an invalid source throws and leaves the file untouched.
   * @param source The YAML to write
   */
  async write(source: string) {
    const config = this.parse(source);

    await writeFile(this._configFile, source, "utf8");
    this.apply(config);
  }

  /**
   * Parses and validates a configuration, without applying it.
   * hangar.yml is user-authored: validate here, or a missing `categories`
   * surfaces much later as a crash inside HangarStore.
   */
  parse(source: string): Config {
    let yaml: unknown;

    try {
      yaml = load(source);
    } catch (error) {
      throw new HangarError(`Invalid YAML in the Hangar config at ${this._configFile}:\n${(error as Error).message}`);
    }

    const parsed = configSchema.safeParse(yaml);

    if (!parsed.success) {
      throw new HangarError(`Invalid Hangar config at ${this._configFile}:\n${z.prettifyError(parsed.error)}`);
    }

    return parsed.data;
  }

  private apply(config: Config) {
    this._categories = config.categories;
    this._swarm = config.swarm;
    this._listsShared = config.shared !== undefined;
    this._widgets = config.widgets;
    this._registryThrottling = config.registryThrottling;
  }
}
