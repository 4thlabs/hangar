import "#libs/env";
import { readFile } from "node:fs/promises";
import { load } from "js-yaml";

/** The config category */
export type Category = {
  name: string;
  color: string;
  stacks: string[];
};

/** The config file type */
export type Config = {
  store: string;
  categories: Category[];
};

/**
 * Reads the homelab config from a file
 * @param filePath The config file path
 */
export const getConfig = async (filePath: string) => {
  const handle = await readFile(filePath, "utf8");
  const config = load(handle) as Config;

  if (config.categories) {
    return config;
  } else {
    throw new Error(`Failed to parse file: ${filePath}`);
  }
};

export const config = await getConfig(process.env.HANGAR_CONFIG_FILE);

export class HangarConfig {

};