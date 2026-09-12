import { load } from "js-yaml";
import { readFile } from "node:fs/promises";
import * as z from "zod";
import { HangarError } from "./hangar-error.ts";

/** A Stack category */
const categorySchema = z.object({
  name: z.string().min(1),
  color: z.string().min(1),
  stacks: z.array(z.string().min(1)),
});

const configSchema = z.object({
  store: z.string().min(1),
  categories: z.array(categorySchema),
});

export type Category = z.infer<typeof categorySchema>;
export type Config = z.infer<typeof configSchema>;

/**
 * HangarConfig interface
 */
export interface ConfigurationProvider {
  storeUrl: () => string;
  categories: () => Category[];
}

/**
 * The configuration for Hangar
 */
export class HangarConfig implements ConfigurationProvider {
  /** The config file */
  private readonly _configFile: string;

  /** The URL of the hangar store */
  private _storeUrl: string = "";

  /** The categories for the various stacks */
  private _categories: Category[] = [];

  /** Returns the store URL */
  public storeUrl = () => this._storeUrl;

  /** Returns the categories */
  public categories = () => this._categories;

  /**
   * Constructs a new HangarConfig instance with the given configuration file.
   * @param file The path to the configuration file
   */
  private constructor(file: string) {
    this._configFile = file;
  }

  /**
   * Static async constructor
   * @param file
   */
  static async create(file: string) {
    const config = new HangarConfig(file);
    await config.load();
    return config;
  }

  /**
   * Loads the configuration from the configuration file.
   * @returns HangarConfig instance with the loaded configuration
   */
  async load() {
    const handle = await readFile(this._configFile, "utf8").catch((error: NodeJS.ErrnoException) => {
      // An unreadable config is an operator error, not a defect: report the
      // path, not a filesystem stack trace.
      throw new HangarError(`Cannot read the Hangar config at ${this._configFile}: ${error.code ?? error.message}`);
    });

    // hangar.yml is user-authored: validate here, or a missing `categories`
    // surfaces much later as a crash inside HangarStore.resolve().
    const parsed = configSchema.safeParse(load(handle));

    if (!parsed.success) {
      const issues = parsed.error.issues.map(issue => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
      throw new HangarError(`Invalid Hangar config at ${this._configFile}:\n${issues.join("\n")}`);
    }

    this._storeUrl = parsed.data.store;
    this._categories = parsed.data.categories;

    return this;
  }
}
