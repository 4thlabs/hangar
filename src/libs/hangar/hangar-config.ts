import { readFile, writeFile } from "node:fs/promises";
import { load } from "js-yaml";
import * as z from "zod";
import { logger } from "#libs/logs";
import { defaultWidgets, widgetConfigSchema, type WidgetConfig } from "#modules/widgets/config/config.ts";
import { HangarError } from "./hangar-error.ts";

/** A Stack category */
const categorySchema = z.object({
  name: z.string().min(1),
  color: z.string().min(1),
  stacks: z.array(z.string().min(1)),
});

const configSchema = z.object({
  categories: z.array(categorySchema),
  /** Files the store ships next to its stacks and every stack may reference (networks, common env) */
  shared: z.array(z.string().min(1)).default([]),
  /** The dashboard: which widgets are shown, in which column */
  widgets: z.array(widgetConfigSchema).default([...defaultWidgets]),
  /** Pause between two registry calls in the image update check, in ms: Hub and ghcr rate-limit a burst */
  registryThrottling: z.int().nonnegative().default(100),
});

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

  /** The files shared by every stack, linked next to them at install */
  private _shared: string[] = [];

  /** The widgets the dashboard shows, in declaration order */
  private _widgets: WidgetConfig[] = [...defaultWidgets];

  /** The pause between two registry calls in the image update check, in ms */
  private _registryThrottling = 100;

  /** Returns the categories */
  public categories = () => this._categories;

  /** Returns the shared files */
  public shared = () => this._shared;

  /** Returns the dashboard widgets */
  public widgets = () => this._widgets;

  /** Returns the pause between two registry calls, in ms */
  public registryThrottling = () => this._registryThrottling;

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
   * Parses and validates a configuration.
   * hangar.yml is user-authored: validate here, or a missing `categories`
   * surfaces much later as a crash inside HangarStore.resolve().
   */
  private parse(source: string): Config {
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
    this._shared = config.shared;
    this._widgets = config.widgets;
    this._registryThrottling = config.registryThrottling;
  }
}
