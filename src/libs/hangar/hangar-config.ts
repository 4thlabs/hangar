import { load } from "js-yaml";
import { readFile } from "node:fs/promises";
import { logger } from "#libs/logs";
import * as z from "zod";
import { defaultWidgets, widgetConfigSchema, type WidgetConfig } from "#libs/widgets/config.ts";
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
});

export type Category = z.infer<typeof categorySchema>;
export type Config = z.infer<typeof configSchema>;

/**
 * The configuration of a store, read from the `hangar.yml` it ships.
 *
 * Owned by the HangarStore: it describes how that store's stacks are grouped,
 * so it only exists once the store has been cloned. Until then — a fresh
 * install, or the Waku build, which evaluates the server modules with no data
 * directory — the configuration is simply empty.
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

  /** Returns the categories */
  public categories = () => this._categories;

  /** Returns the shared files */
  public shared = () => this._shared;

  /** Returns the dashboard widgets */
  public widgets = () => this._widgets;

  /**
   * Constructs the configuration for the given file. Does not read it:
   * call `load()` once the store is on disk.
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
    const handle = await readFile(this._configFile, "utf8").catch((error: NodeJS.ErrnoException) => {
      // A store without a hangar.yml is a store without categories, not a
      // failure: it still installs, its apps are just left ungrouped.
      if (error.code === "ENOENT") return undefined;

      // An unreadable config is an operator error, not a defect: report the
      // path, not a filesystem stack trace.
      throw new HangarError(`Cannot read the Hangar config at ${this._configFile}: ${error.code ?? error.message}`);
    });

    if (handle === undefined) {
      logger.warn(`No Hangar config at ${this._configFile}: the store declares no categories`);
      this._categories = [];
      this._shared = [];
      this._widgets = [...defaultWidgets];
      return this;
    }

    // hangar.yml is user-authored: validate here, or a missing `categories`
    // surfaces much later as a crash inside HangarStore.resolve().
    const parsed = configSchema.safeParse(load(handle));

    if (!parsed.success) {
      const issues = parsed.error.issues.map(issue => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
      throw new HangarError(`Invalid Hangar config at ${this._configFile}:\n${issues.join("\n")}`);
    }

    this._categories = parsed.data.categories;
    this._shared = parsed.data.shared;
    this._widgets = parsed.data.widgets;

    return this;
  }
}
